#!/usr/bin/env node
// r3 (D4b): bac dem giua hub va runner. Spawn runner-main detached roi THOAT NGAY.
// Ly do: Codex Desktop tren Windows don tien trinh bang `taskkill /pid <pid> /t /f` (openai/codex #34260, ma trong app.asar).
// taskkill /T di theo ParentProcessId; runner la con TRUC TIEP cua MCP server -> chet cung server (do tren may: chet 2/2).
// Qua bac dem nay, cha cua runner da chet -> cay bi dut -> runner song (do: song 2/2). Xem docs/05-design-r3.md §D4.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNNER_MAIN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'runner-main.mjs');
const child = spawn(process.execPath, [RUNNER_MAIN, ...process.argv.slice(2)], {
  detached: true, stdio: 'ignore', windowsHide: true, env: process.env,
});
child.on('error', () => process.exit(1));
child.on('spawn', () => { child.unref(); process.exit(0); });
