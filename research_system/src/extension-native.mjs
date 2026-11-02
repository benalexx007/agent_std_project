import path from 'node:path';
import { requireThat, now } from './util.mjs';

export async function checkExtensionStartupScope(rpc, cwd) {
  const config = await rpc.request('config/read', { includeLayers: false, cwd });
  requireThat(config.config && typeof config.config === 'object', 'Missing backend startup configuration');
  const servers = config.config.mcp_servers || {};
  requireThat(Object.values(servers).every((s) => s && s.enabled === false), 'Ambient MCP configuration must be disabled before thread startup');
  const hooks = await rpc.request('hooks/list', { cwds: [cwd] });
  requireThat(Array.isArray(hooks.data) && hooks.data.length === 1 &&
    !hooks.data[0].errors?.length && hooks.data[0].hooks?.every((h) => h.enabled === false),
    'Ambient hooks must be disabled before thread startup');
  return { checked_at: now(), ambient_mcp_enabled: false, ambient_hooks_enabled: false };
}

export function verifyExtensionNativeScope(binding, inventory, cwd) {
  requireThat(binding && inventory.skills && inventory.hooks && inventory.mcp, 'Missing effective extension inventory');
  const policy = binding.native_policy;
  const skills = inventory.skills.data?.filter((e) => path.resolve(e.cwd) === path.resolve(cwd));
  const hooks = inventory.hooks.data?.filter((e) => path.resolve(e.cwd) === path.resolve(cwd));
  requireThat(skills?.length === 1 && hooks?.length === 1 && Array.isArray(inventory.mcp.data), 'Malformed or incomplete native inventory');
  requireThat(!skills[0].errors?.length && !hooks[0].errors?.length, 'Native discovery contains errors');
  const enabledSkills = skills[0].skills.filter((s) => s.enabled !== false).map((s) => s.name);
  const enabledHooks = hooks[0].hooks.filter((h) => h.enabled !== false).map((h) => h.name || h.path || h.id || 'unknown_hook');
  const servers = inventory.mcp.data.filter((s) => s.runtimeStatus !== 'disabled').map((s) => s.name);
  requireThat(enabledSkills.every((n) => policy.skills.includes(n)), 'Inherited native skill outside the approved profile');
  requireThat(enabledHooks.every((n) => policy.hooks.includes(n)), 'Inherited native hook outside the approved profile');
  requireThat(servers.every((n) => policy.mcp_servers.includes(n)), 'Inherited MCP server outside the approved profile');
  // Baseline uses controlled helpers and paged resources; no external MCP execution is enabled.
  requireThat(!servers.length && !enabledHooks.length, 'External MCP/hooks require a separately implemented execution contract');
  return { checked_at: now(), skills: enabledSkills, hooks: enabledHooks, mcp_servers: servers,
    binding_sha256: binding.fingerprint, disclosure: binding.disclosure, verification: 'observed_catalog_before_turn',
    limitation: 'Inventory is checked on the exact backend connection; discovery does not prove arbitrary shell egress isolation.' };
}

export async function inspectExtensionNativeScope(rpc, binding, cwd, threadId) {
  const skills = await rpc.request('skills/list', { cwds: [cwd], forceReload: true });
  const hooks = await rpc.request('hooks/list', { cwds: [cwd] });
  const data = []; let cursor = null;
  const seen = new Set();
  do {
    const page = await rpc.request('mcpServerStatus/list', { threadId, detail: 'full', limit: 100, ...(cursor ? { cursor } : {}) });
    requireThat(Array.isArray(page.data), 'Malformed MCP inventory'); data.push(...page.data);
    requireThat(data.length <= 1000, 'MCP inventory too large');
    cursor = page.nextCursor;
    if (cursor) { requireThat(!seen.has(cursor), 'Repeated MCP cursor'); seen.add(cursor); }
  } while (cursor);
  return verifyExtensionNativeScope(binding, { skills, hooks, mcp: { data } }, cwd);
}
