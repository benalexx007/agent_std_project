import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import { clone, now, requireThat, writeJSON, id, hash } from './util.mjs';
import { resourceDefaults, initialPools } from './resources.mjs';
import { installUnits, workKey } from './work.mjs';

export class Store {
  constructor(workspace, create = false) {
    this.directory = path.join(workspace, '.agentic');
    this.writeGuards = new AsyncLocalStorage();
    this.file = path.join(this.directory, 'state.sqlite');
    requireThat(create || fs.existsSync(this.file), 'Project is not initialized; run init');
    if (create) fs.mkdirSync(this.directory, { recursive: true });
    this.db = new DatabaseSync(this.file);
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    this.db.function('harness_writer_version', () => 5);
    this.db.exec('CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)');
  }
  installWriterGuard() {
    this.db.exec(`DROP TRIGGER IF EXISTS writer_generation_guard; CREATE TRIGGER writer_generation_guard BEFORE UPDATE ON state
      WHEN json_extract(OLD.payload, '$.schema_version') >= 3
      BEGIN SELECT CASE WHEN harness_writer_version() < 4 OR json_extract(NEW.payload, '$.schema_version') < 4
        OR (json_extract(OLD.payload, '$.schema_version') >= 5 AND (harness_writer_version() != 5 OR json_extract(NEW.payload, '$.schema_version') < 5))
        THEN RAISE(ABORT, 'State requires a compatible v4 writer') END; END`);
  }
  initialize(loaded, owner = 'local') {
    requireThat(!this.db.prepare('SELECT id FROM state WHERE id=1').get(), 'Already initialized');
    const state = { schema_version: 4, project: loaded.config.project, config: loaded.config,
      config_hash: loaded.config_hash, owner: { id: owner, epoch: 1 }, created_at: now(),
      desired_state: 'running', tasks: {}, attempts: {}, events: {}, decisions: {}, runs: {}, claims: {},
      usage: { known_tokens: 0, estimated_tokens: 0, known_cost_usd: 0, estimated_cost_usd: 0 } };
    Object.assign(state, { work_units: {}, assignments: {}, checkpoints: {}, recoveries: {}, publications: {}, publication: null, extension_calls: {}, extension_usage: {}, pools: initialPools(loaded.config) });
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO state(id,payload) VALUES(1,?)').run(JSON.stringify(state));
      this.installWriterGuard(); this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return state;
  }
  read() {
    const row = this.db.prepare('SELECT payload FROM state WHERE id=1').get();
    requireThat(row, 'Empty state database');
    return JSON.parse(row.payload);
  }
  enableLegacyControl() {
    const state = this.read();
    requireThat(state.schema_version === 3 && !Object.keys(state.extension_calls || {}).length, 'Legacy control only supports unextended state v3');
    const backup = path.join(this.directory, 'pre-migration-control-' + id('backup') + '.json');
    writeJSON(backup, state);
    this.legacyControl = true;
    this.db.function('harness_writer_version', () => 3);
    return { backup, limitation: 'Control/reconciliation only; no v3 task execution or extension activation.' };
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const state = this.read();
      this.writeGuards.getStore()?.(state);
      requireThat([4, 5].includes(state.schema_version) || this.migrating || this.legacyControl && state.schema_version === 3, 'State requires explicit v4 migration before writes; GUI services additionally require upgrade-gui');
      const priorConfig = state.config_hash;
      const result = fn(state);
      requireThat(!result || typeof result.then !== 'function', 'State transactions must be synchronous');
      if (this.legacyControl) requireThat(state.schema_version === 3 && state.config_hash === priorConfig && !Object.keys(state.extension_calls || {}).length,
        'Legacy control cannot migrate, change configuration or introduce extensions');
      this.db.prepare('UPDATE state SET payload=? WHERE id=1').run(JSON.stringify(state));
      this.db.exec('COMMIT');
      return clone(result === undefined ? state : result);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  withWriteGuard(guard, fn) { return this.writeGuards.run(guard, fn); }
  assertConfig(loaded) {
    requireThat([4, 5].includes(this.read().schema_version) || this.legacyControl && this.read().schema_version === 3, 'State requires explicit migrate-state before execution');
    requireThat(this.read().config_hash === loaded.config_hash, 'Config changed: use sync-config with no active attempts');
  }
  close() { this.db.close(); }
  migrate() {
    const original = this.read();
    if ([4, 5].includes(original.schema_version)) return { migrated: false, schema_version: original.schema_version };
    requireThat([1, 2, 3].includes(original.schema_version), 'Unsupported state schema version');
    requireThat(!Object.values(original.attempts).some((a) => !a.settled || a.job_refs?.some((j) => !['completed', 'failed', 'cancelled', 'stopped'].includes(j.observed_state))), 'Resolve active/unknown attempts and jobs before v4 migration');
    requireThat(!original.publication, 'Recover pending publication before migration');
    this.migrating = true;
    try { return this.migrateLegacy(original); } finally { this.migrating = false; }
  }
  migrateLegacy(original) {
    if (original.schema_version === 3) {
      const backup = path.join(this.directory, 'migration-v3-' + id('backup') + '.json');
      writeJSON(backup, original);
      return this.transaction((s) => {
        requireThat(hash(JSON.stringify(s)) === hash(JSON.stringify(original)), 'State changed while preparing migration backup');
        this.installWriterGuard();
        Object.assign(s, { schema_version: 4, extension_calls: {}, extension_usage: {} });
        s.migration = { from: 3, at: now(), backup };
        return { migrated: true, schema_version: 4, backup };
      });
    }
    if (original.schema_version === 2) {
      requireThat(!Object.values(original.attempts).some((a) => !a.settled), 'Resolve active/unknown attempts before v2 migration');
      const backup = path.join(this.directory, 'migration-v2-' + id('backup') + '.json');
      writeJSON(backup, original);
      const result = this.transaction((s) => {
        this.installWriterGuard();
        requireThat(hash(JSON.stringify(s)) === hash(JSON.stringify(original)), 'State changed while preparing migration backup; retry migration');
        Object.assign(s, { schema_version: 4, extension_calls: {}, extension_usage: {}, publications: {}, publication: null });
        s.migration = { from: 2, at: now(), backup };
        this.installWriterGuard();
        return { migrated: true, schema_version: 4, backup };
      });
      return result;
    }
    requireThat(original.schema_version === 1, 'Unsupported state schema version');
    const backup = path.join(this.directory, 'migration-v1-' + id('backup') + '.json');
    writeJSON(backup, original);
    return this.transaction((state) => {
      this.installWriterGuard();
      requireThat(hash(JSON.stringify(state)) === hash(JSON.stringify(original)), 'State changed while preparing migration backup; retry migration');
      resourceDefaults(state.config);
      Object.assign(state, { schema_version: 4, publications: {}, publication: null, work_units: {}, assignments: {}, checkpoints: {}, recoveries: {}, pools: initialPools(state.config) });
      state.config_hash = hash(JSON.stringify(state.config));
      for (const task of Object.values(state.tasks)) {
        installUnits(state, task.spec);
        const unit = state.work_units[workKey(task.spec.task_id, 'main')];
        unit.attempts = task.attempts.slice(); unit.status = task.status;
        for (const aid of task.attempts) {
          const a = state.attempts[aid], assignmentId = id('assignment');
          Object.assign(a, { work_unit_id: 'main', assignment_id: assignmentId, assignment_generation: ++unit.generation,
            quota_pool_ids: [], resumed_from_checkpoint: null, supersedes_attempt_id: null, recovery_id: null });
          unit.assignment_id = assignmentId;
          state.assignments[assignmentId] = { assignment_id: assignmentId, task_id: a.task_id, work_unit_id: 'main',
            generation: a.assignment_generation, backend: a.backend, attempt_id: aid, owner_epoch: a.owner_epoch,
            lease_expires_at: now(), heartbeat_at: now(), status: a.settled ? 'ended' : 'unknown' };
          if (!a.settled) { a.observed_state = 'unknown'; task.status = 'unknown'; unit.status = 'unknown'; }
          if (a.result?.validity === 'current') unit.result = clone(a.result);
        }
      }
      state.migration = { from: 1, at: now(), backup };
      this.installWriterGuard();
      return { migrated: true, schema_version: 4, backup };
    });
  }
}
