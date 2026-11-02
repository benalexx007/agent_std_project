import { requireThat } from './util.mjs';
import * as research from './research.mjs';

// Built-in domains only. A project cannot load executable domain code from config.
const registry = Object.freeze({
  research: Object.freeze({
    id: 'research', contract_version: 1, enabled: true,
    config_schema: 'config', task_schema: 'task',
    required_roles: Object.freeze(['researcher', 'implementer', 'evaluator']),
    record: research.recordResearch, entry: research.researchEntry,
    validity: research.researchValidity, review: research.researchReview,
    render: research.renderResearch, packet: research.researchPacket,
    snapshot: research.researchSnapshot, checkSnapshot: research.checkResearchSnapshot
  }),
  application: Object.freeze({ id: 'application', contract_version: 1, enabled: false })
});

export function domainFor(id) {
  requireThat(typeof id === 'string' && Object.hasOwn(registry, id), 'Unknown project domain: ' + id);
  return registry[id];
}
export function activeDomain(id) {
  const domain = domainFor(id);
  requireThat(domain.enabled, 'Domain is not implemented yet: ' + id);
  return domain;
}
export function projectDomain(state) {
  requireThat(state?.project?.domain === state?.config?.project?.domain, 'Project/config domain mismatch');
  return activeDomain(state.project.domain);
}
export const availableDomains = () => Object.values(registry).map(({ id, contract_version, enabled }) => ({ id, contract_version, enabled }));
