// Diem moc cho POLICY (chi cho trong - policy chi tiet thiet ke sau). Moi hook mac dinh la no-op/cho phep.
// Hook duoc nap tu module do bien moi truong ORCH_POLICY chi toi (export default { pre_spawn, ... }).
//
//   route(spec)                         -> backend   ('auto' -> backend cu the)
//   pre_spawn(spec)                     -> {allow, spec?, reason?}   (quyen giao viec, ngan sach, do sau de quy)
//   pre_attempt({spec, backend, attempt, mode}) -> {extraArgs?, env?, deny?, grants?: {write?: boolean}}
//        access=write ma KHONG co grants.write -> fail-fast config (B18): khong chay backend roi "thanh cong ma khong lam gi".
//   finalize_argv({spec, backend, command, args}) -> args   (r2, B19) - policy la ben CUOI CUNG quyet dinh argv
//   on_event({task_id, event})          -> void
//   pre_failover({spec, from, to, failure}) -> {allow}
//   pre_resume({spec, backend, reason}) -> {allow}
//   on_result({spec, envelope})         -> envelope   (loc prompt-injection, gan nhan untrusted, cat kich thuoc)
//   on_park({spec, failure})            -> void
//   on_notify({task_id, status, title, summary_head}) -> void  (r2, B7) mac dinh: Windows toast neu ORCH_TOAST != 0
//   budget_check({task_id, usage_total}) -> {stop?: boolean, reason?}
import { pathToFileURL } from 'node:url';
import { toast } from './notify.mjs';

export const DEFAULT_HOOKS = {
  route: (spec) => (spec.backend === 'auto' ? 'claude' : spec.backend),
  pre_spawn: () => ({ allow: true }),
  pre_attempt: () => ({}),
  finalize_argv: ({ args }) => args,
  on_event: () => {},
  pre_failover: () => ({ allow: true }),
  pre_resume: () => ({ allow: true }),
  on_result: ({ envelope }) => envelope,
  on_park: () => {},
  on_notify: (n) => toast(n),
  budget_check: () => ({ stop: false }),
};

export async function loadHooks(modPath = process.env.ORCH_POLICY) {
  if (!modPath) return { ...DEFAULT_HOOKS };
  const mod = await import(pathToFileURL(modPath).href);
  return { ...DEFAULT_HOOKS, ...(mod.default ?? mod) };
}
