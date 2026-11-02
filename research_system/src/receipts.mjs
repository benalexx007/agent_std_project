import fs from 'node:fs';
import path from 'node:path';
import { artifactCheck, confined, requireThat, fileHash, id } from './util.mjs';
import { copyFileDurable } from './blobs.mjs';

// Immutable bytes for a unit's published outputs. Public paths may be updated by later units.
export function pinOutputs(state, attempt, result) {
  attempt.output_snapshots = pinRefs(state.project.workspace, state.project.workspace, result.artifacts);
}
export function pinRefs(root, sourceRoot, refs, maxBytes = Infinity) {
  const snapshots = [];
  let bytes = 0;
  for (const ref of refs) {
    const checked = artifactCheck(sourceRoot, ref);
    bytes += checked.bytes;
    requireThat(bytes <= maxBytes, 'Snapshot exceeds byte budget');
    const snapshotPath = path.posix.join('.agentic/output-snapshots', ref.sha256);
    const file = confined(root, snapshotPath, false);
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temp = file + '.' + id('snapshot');
      try {
        copyFileDurable(confined(sourceRoot, ref.path), temp, checked.bytes);
        requireThat(fileHash(temp) === ref.sha256, 'Output changed while pinning: ' + ref.path);
        try { fs.linkSync(temp, file); } catch (e) { if (e.code !== 'EEXIST') throw e; }
      } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    }
    artifactCheck(root, { path: snapshotPath, sha256: ref.sha256 });
    snapshots.push({ logical_path: ref.path, path: snapshotPath, sha256: ref.sha256 });
  }
  return snapshots;
}
export function checkAttemptRef(state, attempt, ref) {
  const snapshot = attempt.output_snapshots?.find((s) => s.logical_path === ref.path && s.sha256 === ref.sha256);
  return artifactCheck(state.project.workspace, snapshot ? { path: snapshot.path, sha256: snapshot.sha256 } : ref);
}
