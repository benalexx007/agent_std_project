// Tro giup test N2 (da tien trinh): writer ghi N thong bao; reader doc lien tuc consumer 'c1' trong ms roi in JSON task_id.
import '../_env.mjs';
import { TaskStore } from '../../lib/store.mjs';

const [mode, root, a, b] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = new TaskStore(root);
if (mode === 'writer') {
  for (let i = 0; i < Number(b); i++) { st.notify(`${a}-${i}`, { status: 'succeeded' }); if (i % 7 === 0) await sleep(1); }
} else {
  const seen = [];
  const end = Date.now() + Number(a);
  while (Date.now() < end) { for (const n of await st.readNotifications('c1', { max: 100000 })) seen.push(n.task_id); await sleep(2); }
  for (let k = 0; k < 3; k++) { for (const n of await st.readNotifications('c1', { max: 100000, lockWaitMs: 2000 })) seen.push(n.task_id); }
  process.stdout.write(JSON.stringify(seen));
}
process.exit(0);
