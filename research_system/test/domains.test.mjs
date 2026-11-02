import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, spec } from './helpers.mjs';
import { activeDomain, availableDomains } from '../src/domains.mjs';
import { normalizeConfig, resolveTask } from '../src/config.mjs';
import { registerTask } from '../src/engine.mjs';
import { clone } from '../src/util.mjs';

test('domain registry exposes Research and refuses unfinished Application', () => {
  assert.equal(activeDomain('research').id, 'research');
  assert.equal(availableDomains().find((d) => d.id === 'application').enabled, false);
  assert.throws(() => activeDomain('application'), /not implemented/);
  assert.throws(() => activeDomain('toString'), /Unknown project domain/);
});

test('cross-domain config and tasks cannot enter Research state', (t) => {
  const { store, loaded, configFile } = fixture(t);
  const before = store.read();
  const raw = clone(before.config);
  delete raw.extension_fingerprint;
  raw.project.domain = 'application';
  assert.throws(() => normalizeConfig(raw, configFile), /not implemented/);
  assert.throws(() => resolveTask(loaded.config, spec({ domain: 'application' })), /Task domain differs/);
  assert.throws(() => registerTask(store, spec({ domain: 'application' })), /Task domain differs/);
  assert.deepEqual(store.read(), before);
});

test('transaction cannot change domain after validation', (t) => {
  const { store } = fixture(t);
  const before = store.read();
  assert.throws(() => store.transaction((s) => { s.project.domain = 'application'; }), /domain mismatch/);
  assert.deepEqual(store.read(), before);
});
