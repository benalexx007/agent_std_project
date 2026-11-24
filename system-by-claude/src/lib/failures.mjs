// Phan loai loi va quyet dinh phuc hoi. Adapter dua tin hieu tho; ham nay chuan hoa thanh lop loi.
//
// Lop loi (r2):
//   transient     loi mang/5xx/overloaded            -> retry backoff + jitter (resume phien neu co)
//   rate_limited  429/quota/usage limit               -> cho den reset neu ngan; dai -> failover (neu duoc phep) hoac park
//   auth          het phien dang nhap/401/thieu key   -> KHONG retry; failover (opt-in) hoac park needs_attention
//   permission    backend dung lai cho duyet quyen    -> park needs_attention (agy WAITING)                       [r2, B21]
//   hang          khong co su kien qua idle_timeout   -> kill cay tien trinh, resume phien
//   crash         thoat != 0 khong co ket qua         -> resume phien 1 lan; resume do that bai -> chay moi        [r2, B20.3]
//   no_output     thoat 0 nhung khong co tin nhan cuoi -> thu lai DUNG 1 lan; lan 2 -> failed                       [r2, B5]
//   bad_output    sai RESULT CONTRACT                 -> repair turn (runner xu ly), het luot -> degraded/failed
//   agent_failed  agent tu bao that bai               -> khong retry; tra ket qua failed cho orchestrator quyet
//   cancelled     nguoi dung huy / backend CANCELED   -> ket thuc status=cancelled                                [r2, B20.2]
//   config        thieu binary/sai co/schema bi tu choi -> khong retry; needs_attention
//   poison        runner bi gian doan qua nhieu lan   -> needs_attention (khong chay lai vo han)                   [r2, B12]

const PATTERNS = [
  ['auth', /(not logged in|please (log ?in|login|run .*login)|unauthori[sz]ed|unauthenticated|\b401\b|invalid api key|(missing|no) (anthropic_)?api[_ ]key|ANTHROPIC_API_KEY|token (has )?expired|re-?authenticat|authentication (failed|expired|required)|oauth.*expired)/i],
  ['rate_limited', /(rate.?limit|\b429\b|quota|usage limit|too many requests|limit reached|resource.?exhausted)/i],
  ['transient', /(ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|\b50[0234]\b|\b529\b|overloaded|temporar(il)?y unavailable|\bUNAVAILABLE\b|network error|stream (error|disconnected))/i],
  ['config', /(ENOENT|is not recognized as an internal or external command|command not found|unknown (option|flag|argument)|unexpected argument|invalid_json_schema|invalid schema|response_format)/i],
];

export function classifyText(text) {
  if (!text) return null;
  for (const [cls, re] of PATTERNS) if (re.test(text)) return cls;
  return null;
}

/**
 * Tim thoi diem reset trong thong bao rate limit:
 *  "try again in 37s" | "retry-after: 7" | "resets at 2026-11-16T10:00:00Z" | "...usage limit reached|1763290000" (epoch s/ms)
 *  | "try again at 3:45 PM" (gio dia phuong; neu da qua thi la ngay mai).
 */
export function parseRetryAfterMs(text, now = Date.now()) {
  if (!text) return null;
  let m = text.match(/retry[- ]after[":\s]+(\d+)/i) || text.match(/(?:try again|retry) in (\d+(?:\.\d+)?)\s*(ms|s|sec|seconds?|m|min|minutes?|h|hours?)\b/i);
  if (m) {
    const n = parseFloat(m[1]);
    const unit = (m[2] || 's').toLowerCase();
    const mult = unit === 'ms' ? 1 : unit.startsWith('m') ? 60_000 : unit.startsWith('h') ? 3_600_000 : 1000;
    return Math.round(n * mult);
  }
  m = text.match(/resets? (?:at|on) ([0-9T:\-+.Z ]{10,})/i);
  if (m) {
    const t = Date.parse(m[1].trim());
    if (!Number.isNaN(t)) return Math.max(0, t - now);
  }
  m = text.match(/limit[^|\n]{0,40}\|\s*(\d{10,13})\b/i);
  if (m) {
    const v = Number(m[1]);
    const t = m[1].length >= 13 ? v : v * 1000;
    return Math.max(0, t - now);
  }
  m = text.match(/(?:try again|resets?|available again)\s+(?:at|after)\s+(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (m) {
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const ap = m[3]?.toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    const d = new Date(now);
    d.setHours(h, min, 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime() - now;
  }
  return null;
}

export function backoffMs(attempt, { base = 2000, cap = 120_000, rand = Math.random } = {}) {
  const exp = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + rand() * (exp / 2)); // "equal jitter"
}

/**
 * Quyet dinh buoc tiep theo sau mot lan chay that bai.
 * @param {object} f   {class, message, retryAfterMs}
 * @param {object} ctx {attempt, maxAttempts, hasSession, failoverCandidates[], rateLimitWaitCapMs, lastMode, classCount}
 *   lastMode: 'resume'|'fresh' cua lan vua that bai; classCount: so lan lop loi nay da xay ra trong turn (tinh ca lan nay)
 * @returns {{action: 'retry'|'resume'|'failover'|'park'|'fail'|'cancel', delayMs?: number, to?: string, reason: string}}
 */
export function decide(f, ctx) {
  const left = ctx.attempt < ctx.maxAttempts;
  const fo = ctx.failoverCandidates?.[0];
  switch (f.class) {
    case 'cancelled': return { action: 'cancel', reason: 'cancelled' };
    case 'agent_failed': return { action: 'fail', reason: 'agent bao that bai - de orchestrator quyet' };
    case 'config': return { action: 'park', reason: 'loi cau hinh/thieu binary - can nguoi xu ly' };
    case 'permission': return { action: 'park', reason: 'backend dang cho duyet quyen - can policy/nguoi' };
    case 'poison': return { action: 'park', reason: 'runner bi gian doan qua nhieu lan' };
    case 'auth':
      if (fo) return { action: 'failover', to: fo, reason: 'auth het han; chuyen backend khac trong khi cho dang nhap lai' };
      return { action: 'park', reason: 'auth het han - can nguoi dung dang nhap lai' };
    case 'no_output':
      if ((ctx.classCount ?? 1) <= 1 && left) return { action: ctx.hasSession ? 'resume' : 'retry', delayMs: 0, reason: 'thoat 0 khong co ket qua - thu lai 1 lan' };
      return { action: 'fail', reason: 'backend thoat 0 nhung khong tra ket qua (lap lai)' };
    case 'rate_limited': {
      const wait = f.retryAfterMs ?? null;
      const cap = ctx.rateLimitWaitCapMs ?? 5 * 60_000;
      if (wait !== null && wait <= cap && left) return { action: ctx.hasSession ? 'resume' : 'retry', delayMs: wait + 1000, reason: 'cho reset rate limit' };
      if (fo) return { action: 'failover', to: fo, reason: 'quota/rate limit dai - failover' };
      if (left) return { action: ctx.hasSession ? 'resume' : 'retry', delayMs: Math.max(wait ?? 0, backoffMs(ctx.attempt, { base: 30_000, cap: 15 * 60_000 })), reason: 'rate limit - backoff dai' };
      return { action: 'park', reason: 'rate limit, het luot thu' };
    }
    case 'bad_output':
      return { action: 'fail', reason: 'output sai dinh dang sau khi da sua' };
    case 'crash':
      if (left) {
        // resume mot lan; neu chinh lan resume do crash -> chay moi (phien co the hong)
        const resume = ctx.hasSession && ctx.lastMode !== 'resume';
        return { action: resume ? 'resume' : 'retry', delayMs: backoffMs(ctx.attempt), reason: resume ? 'crash - resume phien' : 'crash sau resume - chay moi' };
      }
      if (fo) return { action: 'failover', to: fo, reason: 'crash lap lai - failover' };
      return { action: 'fail', reason: 'crash - het luot thu' };
    case 'transient':
    case 'hang':
    default:
      if (left) return { action: ctx.hasSession ? 'resume' : 'retry', delayMs: backoffMs(ctx.attempt), reason: `${f.class} - thu lai` };
      if (fo) return { action: 'failover', to: fo, reason: `${f.class} lap lai - failover` };
      return { action: 'fail', reason: `${f.class} - het luot thu` };
  }
}
