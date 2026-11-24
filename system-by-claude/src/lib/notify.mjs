// Thong bao cho NGUOI (B7): khi task xong / bi park, nguoi dung biet de quay lai GUI - ke ca voi GUI khong co kenh
// danh thuc phien idle (Codex, Antigravity). Khong phu thuoc npm. Tat bang ORCH_TOAST=0.
// Windows: WinRT ToastNotificationManager qua PowerShell 5.1; title/body truyen qua ENV (khong noi chuoi vao script -> khong chen lenh).
import { spawn } from 'node:child_process';

// Do dac r2: powershell.exe 5.1 khoi dong DETACHED (DETACHED_PROCESS) thoat 0 ngay ma KHONG chay script (khong co console host).
// Vi vay toast chay powershell KHONG detached va runner phai doi flushToasts() truoc khi thoat
// (con khong detached nam trong job KILL_ON_JOB_CLOSE cua libuv -> chet cung runner neu khong doi).
const PENDING = new Set();
export function flushToasts(timeoutMs = 8000) {
  if (!PENDING.size) return Promise.resolve();
  return Promise.race([Promise.allSettled([...PENDING]), new Promise((r) => setTimeout(r, timeoutMs).unref())]);
}
function track(c) {
  const p = new Promise((r) => { c.on('close', r); c.on('error', r); });
  PENDING.add(p);
  p.then(() => PENDING.delete(p));
}

const PS_TOAST = [
  "$ErrorActionPreference='SilentlyContinue'",
  '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null',
  '$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
  "$n = $x.GetElementsByTagName('text')",
  '$n.Item(0).AppendChild($x.CreateTextNode($env:ORCH_TOAST_TITLE)) > $null',
  '$n.Item(1).AppendChild($x.CreateTextNode($env:ORCH_TOAST_BODY)) > $null',
  "$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
  '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($x))',
].join('; ');

export function toastText(n) {
  const icon = n.status === 'succeeded' ? 'xong' : n.status === 'needs_attention' ? 'can xu ly' : n.status;
  const title = `subagent ${icon}: ${(n.title ?? n.task_id ?? '').slice(0, 60)}`;
  const body = (n.status === 'needs_attention' ? `${n.reason ?? ''} -> subagent_resume ${n.task_id}` : (n.summary_head ?? '')).replace(/\s+/g, ' ').slice(0, 180);
  return { title, body };
}

export function toast(n) {
  if (process.env.ORCH_TOAST === '0') return false;
  const { title, body } = toastText(n);
  try {
    if (process.platform === 'win32') {
      const c = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(PS_TOAST, 'utf16le').toString('base64')], {
        stdio: 'ignore', windowsHide: true, env: { ...process.env, ORCH_TOAST_TITLE: title, ORCH_TOAST_BODY: body },
      });
      c.on('error', () => {});
      track(c);
      return true;
    }
    if (process.platform === 'linux') {
      const c = spawn('notify-send', [title, body], { stdio: 'ignore' });
      c.on('error', () => {});
      track(c);
      return true;
    }
  } catch {}
  return false;
}
