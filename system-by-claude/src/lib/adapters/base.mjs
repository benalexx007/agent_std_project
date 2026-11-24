// Giao dien Adapter: moi backend chi can khai bao cach GOI va cach DOC luong su kien.
// Moi logic vong doi (retry, resume, failover, journal, timeout, huy) nam o runner, dung chung cho ca 3 backend.
//
// @typedef {Object} Invocation
// @property {string}   command   ten lenh hoac duong dan (vd 'claude', 'codex', process.execPath)
// @property {string[]} args
// @property {string=}  stdin     prompt dua qua stdin (tranh gioi han 32K ky tu cua command line Windows va loi quoting)
// @property {Object=}  env       bien moi truong bo sung
// @property {string}   cwd
//
// @typedef {Object} NormEvent  (su kien chuan hoa sau khi parse 1 dong stdout)
//   {kind:'session',  session_id}
//   {kind:'progress', text}
//   {kind:'tool',     name, detail?}
//   {kind:'final',    text, is_error?, usage?}
//   {kind:'error',    text}
//
// @typedef {Object} Adapter
// @property {string} id
// @property {{stream:boolean, resume:boolean, nativeSchema:boolean, nativeSubagents:boolean}} capabilities
// @property {(ctx:{spec, prompt:string, sessionId:?string, attemptDir:string}) => Invocation} buildInvocation
// @property {(line:string, acc:object) => NormEvent[]} parseLine     acc: bo nho tam cua lan chay (do runner cap)
// @property {(info:{code:?number, stderrTail:string, acc:object}) => (null|{class:string, message:string})} [classifyExit]
// @property {(acc:object) => (null|{text:string})} [finalize]       goi khi tien trinh thoat ma chua co su kien final

/** Chuan: mot dong JSON hop le hay khong. */
export function tryJson(line) {
  const s = line.trim();
  if (!s.startsWith('{')) return null;
  try { return JSON.parse(s); } catch { return null; }
}

/** Kiem tra adapter co du ham bat buoc. */
export function assertAdapter(a) {
  for (const k of ['id', 'capabilities', 'buildInvocation', 'parseLine']) {
    if (!(k in a)) throw new TypeError(`adapter thieu '${k}'`);
  }
  return a;
}
