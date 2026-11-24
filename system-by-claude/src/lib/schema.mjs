// TaskSpec (dau vao thong nhat) va ResultEnvelope (dau ra thong nhat) + kiem tra + sua output + schema strict cho Codex.
// Co y tu viet validator nho (khong phu thuoc npm); ban that nen dung Ajv + JSON Schema 2020-12.

export const BACKENDS = ['claude', 'codex', 'antigravity'];

/** Truong ma MAT TIEN (MCP/CLI) duoc phep nhan tu orchestrator (B19). backend_options/limits/policy chi di qua policy/cau hinh. */
export const PUBLIC_SPEC_FIELDS = ['prompt', 'title', 'backend', 'failover', 'cwd', 'output_schema', 'summary_max_chars', 'model', 'run_id', 'idempotency_key', 'access'];

export function pickPublicSpec(input) {
  const out = {};
  for (const k of PUBLIC_SPEC_FIELDS) if (input?.[k] !== undefined) out[k] = input[k];
  return out;
}

function allowedBackend(b) {
  return b === 'auto' || BACKENDS.includes(b) || (process.env.ORCH_ENABLE_FAKE === '1' && /^fake\d*$/.test(b));
}

/** Gia tri mac dinh cua TaskSpec. Moi truong policy (budget, quyen) chi la "cho trong" - xem docs muc Hook point. */
export function normalizeSpec(input, { requireCwd = false } = {}) {
  if (!input || typeof input !== 'object') throw new TypeError('spec phai la object');
  if (typeof input.prompt !== 'string' || !input.prompt.trim()) throw new TypeError('spec.prompt bat buoc');
  const backend = input.backend ?? 'auto';
  if (!allowedBackend(backend)) throw new TypeError(`backend khong hop le: ${backend}`);
  for (const b of input.failover ?? []) if (!allowedBackend(b) || b === 'auto') throw new TypeError(`failover khong hop le: ${b}`);
  if (requireCwd && !input.cwd) throw new TypeError('spec.cwd bat buoc (duong dan tuyet doi toi project) - MCP server khong biet project cua ban');
  const access = input.access ?? 'read';
  if (!['read', 'write'].includes(access)) throw new TypeError(`access khong hop le: ${access}`);
  return {
    prompt: input.prompt,
    title: input.title ?? input.prompt.slice(0, 60),
    backend,
    failover: Array.isArray(input.failover) ? input.failover : [],
    cwd: input.cwd ?? process.cwd(),
    access, // read (mac dinh) | write  - write ma policy khong cap quyen -> fail-fast (B18)
    output_schema: input.output_schema ?? null,
    summary_max_chars: input.summary_max_chars ?? 6000,
    model: input.model ?? null,
    run_id: input.run_id ?? null,
    parent_task_id: input.parent_task_id ?? null,
    idempotency_key: input.idempotency_key ?? null,
    limits: {
      max_attempts: input.limits?.max_attempts ?? 3,
      max_repairs: input.limits?.max_repairs ?? 1,
      max_interruptions: input.limits?.max_interruptions ?? 3,
      idle_timeout_ms: input.limits?.idle_timeout_ms ?? 10 * 60_000,
      tool_idle_timeout_ms: input.limits?.tool_idle_timeout_ms ?? 60 * 60_000, // khi co tool dang chay (B15)
      wall_timeout_ms: input.limits?.wall_timeout_ms ?? 2 * 60 * 60_000, // moi attempt
      total_timeout_ms: input.limits?.total_timeout_ms ?? 6 * 60 * 60_000, // ca turn (B24)
    },
    policy: input.policy ?? {},
    backend_options: input.backend_options ?? {},
  };
}

export function resultContract(spec) {
  const outputs = spec.output_schema
    ? `"outputs": <object dung JSON Schema sau: ${JSON.stringify(spec.output_schema)}>,`
    : '"outputs": {},';
  return [
    '',
    '---',
    'RESULT CONTRACT (bat buoc): Khi xong viec, tin nhan CUOI CUNG cua ban chi gom MOT khoi JSON trong ```json ... ```:',
    '{',
    '  "status": "succeeded" | "failed" | "needs_input",',
    `  "summary": "<tom tat cho orchestrator, <= ${spec.summary_max_chars} ky tu: da lam gi, ket qua, rui ro, viec con lai>",`,
    `  ${outputs}`,
    '  "artifacts": [{"path": "<duong dan tuong doi>", "description": "<mo ta>"}],',
    '  "changed_files": ["<duong dan>"],',
    '  "questions": ["<cau hoi neu status=needs_input>"]',
    '}',
    'Khong chen noi dung lon (log, file) vao summary; ghi ra file va liet ke trong artifacts.',
    // r3.1 (M7): job KILL_ON_JOB_CLOSE, cam breakaway -> moi tien trinh nen chet khi luot ket thuc
    'Luu y: moi tien trinh nen ban khoi dong (server dev, watcher, `start /b`, ...) se bi dung khi ban ket thuc luot nay; dung de lai viec chay nen.',
  ].join('\n');
}

/** Tim object JSON can bang ma hieu chuoi (dau ngoac trong chuoi khong tinh) bat dau tai `start`. */
function balancedEnd(text, start) {
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Lay khoi JSON cuoi cung trong text (```json fence``` uu tien; neu khong co thi object can bang cuoi cung). */
export function extractJsonBlock(text) {
  if (typeof text !== 'string') return null;
  const fences = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)];
  for (let i = fences.length - 1; i >= 0; i--) {
    try { return JSON.parse(fences[i][1]); } catch {}
  }
  let last = null;
  for (let i = text.indexOf('{'); i >= 0 && i < text.length; i = text.indexOf('{', i + 1)) {
    const end = balancedEnd(text, i);
    if (end < 0) continue;
    try { const v = JSON.parse(text.slice(i, end + 1)); if (v && typeof v === 'object') { last = v; i = end; } } catch {}
  }
  return last;
}

/** Validator JSON Schema toi gian (type, required, properties, additionalProperties:false, enum, items, maxLength, anyOf). */
export function validate(schema, value, at = '$') {
  const errs = [];
  if (!schema || typeof schema !== 'object') return errs;
  if (Array.isArray(schema.anyOf)) {
    const ok = schema.anyOf.some((s) => validate(s, value, at).length === 0);
    if (!ok) errs.push(`${at}: khong khop anyOf`);
    return errs;
  }
  const t = schema.type;
  const typeOf = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v === 'number' && Number.isInteger(v) ? 'integer' : typeof v);
  if (t) {
    const types = Array.isArray(t) ? t : [t];
    const vt = typeOf(value);
    const ok = types.some((x) => x === vt || (x === 'number' && vt === 'integer'));
    if (!ok) { errs.push(`${at}: can kieu ${types.join('|')}, nhan ${vt}`); return errs; }
  }
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${at}: phai thuoc ${JSON.stringify(schema.enum)}`);
  if (typeof value === 'string' && schema.maxLength && value.length > schema.maxLength) errs.push(`${at}: dai ${value.length} > ${schema.maxLength}`);
  if (typeof value === 'string' && schema.minLength && value.trim().length < schema.minLength) errs.push(`${at}: rong/ngan hon ${schema.minLength}`);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const k of schema.required ?? []) if (!(k in value)) errs.push(`${at}.${k}: thieu truong bat buoc`);
    for (const [k, sub] of Object.entries(schema.properties ?? {})) if (k in value) errs.push(...validate(sub, value[k], `${at}.${k}`));
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(value)) if (!(k in (schema.properties ?? {}))) errs.push(`${at}.${k}: truong khong duoc phep`);
    }
  }
  if (Array.isArray(value) && schema.items) value.forEach((v, i) => errs.push(...validate(schema.items, v, `${at}[${i}]`)));
  return errs;
}

/** Schema hop dong cho validator cua hub (khoan dung: cho phep truong thua o cap ngoai, outputs tu do neu khong co schema). */
export function finalMessageSchema(spec) {
  return {
    type: 'object',
    required: ['status', 'summary'],
    properties: {
      status: { type: 'string', enum: ['succeeded', 'failed', 'needs_input'] },
      summary: { type: 'string', minLength: 1 }, // qua dai -> clampSummary cat kem con tro, khong ton mot repair turn
      outputs: spec.output_schema ?? { type: 'object' },
      artifacts: { type: 'array', items: { type: 'object', required: ['path'], properties: { path: { type: 'string' }, description: { type: 'string' } } } },
      changed_files: { type: 'array', items: { type: 'string' } },
      questions: { type: 'array', items: { type: 'string' } },
    },
  };
}

// ---------------- schema strict (OpenAI Structured Outputs / codex --output-schema) - B2 ----------------
// Quy tac strict [DKC: notebook - Developers Digest "Strict Mode" 2026]: moi object additionalProperties:false;
// moi property nam trong required; truong tuy chon bieu dien bang union voi null.

function isObjectSchema(s) {
  return s && (s.type === 'object' || (Array.isArray(s.type) && s.type.includes('object')) || (!s.type && s.properties));
}

/** Schema co bieu dien duoc o strict mode ma KHONG doi nghia? (object khong co properties = "object bat ky" -> khong) */
// N9 (r3): cac tu khoa strictify KHONG viet lai (oneOf/allOf/$ref/$defs/... hoac tuple) -> Q7: schema ra khong strict,
// Codex tu choi truoc khi suy luan. Gap chung -> khong dung schema native (hub validate + repair nhu backend khac).
const NON_STRICTABLE_KEYS = ['oneOf', 'allOf', 'not', 'if', 'then', 'else', '$ref', '$defs', 'definitions', 'patternProperties', 'prefixItems', 'dependentSchemas', 'unevaluatedProperties'];
export function isStrictable(s) {
  if (!s || typeof s !== 'object') return true;
  if (NON_STRICTABLE_KEYS.some((k) => s[k] !== undefined)) return false;
  if (Array.isArray(s.items)) return false;
  if (isObjectSchema(s)) {
    if (!s.properties) return false;
    if (s.additionalProperties !== undefined && s.additionalProperties !== false) return false;
    if (s.patternProperties) return false;
    if (!Object.values(s.properties).every(isStrictable)) return false;
  }
  if (s.items && !isStrictable(s.items)) return false;
  if (Array.isArray(s.anyOf) && !s.anyOf.every(isStrictable)) return false;
  return true;
}

function nullable(s) {
  if (Array.isArray(s.anyOf)) return s.anyOf.some((x) => x.type === 'null') ? s : { ...s, anyOf: [...s.anyOf, { type: 'null' }] };
  if (s.type) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    const out = { ...s, type: types.includes('null') ? types : [...types, 'null'] };
    if (out.enum && !out.enum.includes(null)) out.enum = [...out.enum, null];
    return out;
  }
  return { anyOf: [s, { type: 'null' }] };
}

/** Bien schema thuong thanh strict, DE QUY cho moi object; truong khong required -> union null (giu nghia "tuy chon"). */
export function strictify(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const s = { ...schema };
  if (s.enum && !s.type) s.type = s.enum.every((v) => typeof v === 'number') ? 'number' : 'string';
  delete s.maxLength; delete s.minLength; delete s.default; // khong ho tro o strict; validator cua hub van kiem
  if (isObjectSchema(s)) {
    s.type = s.type ?? 'object';
    const props = s.properties ?? {};
    const req = new Set(s.required ?? []);
    s.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, req.has(k) ? strictify(v) : nullable(strictify(v))]));
    s.required = Object.keys(s.properties);
    s.additionalProperties = false;
  }
  if (s.items) s.items = strictify(s.items);
  if (Array.isArray(s.anyOf)) s.anyOf = s.anyOf.map(strictify);
  return s;
}

/**
 * Schema strict cho tin nhan cuoi (Codex). Tra null neu output_schema cua nguoi goi khong bieu dien duoc o strict
 * (khi do adapter tat schema native cho task nay; hub van validate + repair).
 */
export function strictFinalSchema(spec) {
  if (spec.output_schema && !isStrictable(spec.output_schema)) return null;
  const base = finalMessageSchema(spec);
  base.properties.outputs = spec.output_schema ?? { type: 'object', properties: {}, additionalProperties: false };
  return strictify(base);
}

/** Bo cac gia tri null ma schema strict ep ra o truong KHONG bat buoc (nguoc cua nullable) truoc khi validate. */
export function dropOptionalNulls(schema, value) {
  if (!schema || !value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return schema.items ? value.map((v) => dropOptionalNulls(schema.items, v)) : value;
  const req = new Set(schema.required ?? []);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === null && !req.has(k)) continue;
    out[k] = schema.properties?.[k] ? dropOptionalNulls(schema.properties[k], v) : v;
  }
  return out;
}

/**
 * Phan tich tin nhan cuoi cua backend theo hop dong.
 * @returns {{ok: true, value: object} | {ok: false, errors: string[], raw: string}}
 */
export function parseFinalMessage(spec, text) {
  const obj = extractJsonBlock(text);
  if (!obj) return { ok: false, errors: ['khong tim thay khoi JSON'], raw: text ?? '' };
  const schema = finalMessageSchema(spec);
  const value = dropOptionalNulls(schema, obj);
  const errors = validate(schema, value);
  return errors.length ? { ok: false, errors, raw: text, partial: value } : { ok: true, value };
}

export function repairPrompt(spec, errors) {
  return [
    'Tin nhan cuoi cua ban KHONG dung RESULT CONTRACT. Loi:',
    ...errors.map((e) => `- ${e}`),
    'Khong lam lai cong viec. Chi tra loi bang DUY NHAT khoi JSON dung hop dong.',
    resultContract(spec),
  ].join('\n');
}

export function clampSummary(text, max, fullRef) {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max - 120) + `\n...[da cat; ban day du: ${fullRef}]`;
}

/**
 * ResultEnvelope v1 (r2) - dinh dang tra ve thong nhat cho MOI backend.
 * Bat bien (B5): status==='succeeded' => error===null && summary!==''.
 */
export function makeEnvelope(fields) {
  const env = {
    schema: 'subagent-result/v1',
    task_id: fields.task_id,
    run_id: fields.run_id ?? null,
    turn: fields.turn ?? 1,
    backend: fields.backend,
    status: fields.status, // succeeded | failed | cancelled | needs_input
    summary: fields.summary ?? '',
    outputs: fields.outputs ?? {},
    artifacts: fields.artifacts ?? [],
    changed_files: fields.changed_files ?? [],
    questions: fields.questions ?? [],
    format: fields.format ?? 'contract', // contract | degraded (co text nhung sai hop dong; da boc lai)
    warnings: fields.warnings ?? [], // unverified_format | no_changes | permission_denied ...
    denials: fields.denials ?? [], // hanh dong bi tu choi quyen (Claude permission_denials, ...)
    session: { backend_session_id: fields.session_id ?? null, resumable: !!fields.session_id },
    usage: fields.usage ?? {},
    attempts: fields.attempts ?? 1,
    failovers: fields.failovers ?? [],
    error: fields.error ?? null, // {class, message, retriable}
    refs: fields.refs ?? {},
    finished_at: new Date().toISOString(),
  };
  if (env.status === 'succeeded' && (env.error !== null || !env.summary)) {
    throw new Error('vi pham bat bien envelope: succeeded phai co summary va error=null');
  }
  return env;
}
