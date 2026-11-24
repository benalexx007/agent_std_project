# subagent-hub — tổng quan (0.3.1-r3.1)

**Kiến trúc.**
- Một MCP server stdio (`src/bin/mcp-server.mjs`) nằm trong GUI orchestrator (Claude Code, Codex hoặc Antigravity) và chỉ ghi yêu cầu vào store trên đĩa (`%LOCALAPPDATA%\subagent-hub\default`).
- Mỗi task có một **runner tách rời** (`runner-main`). Runner được launch qua trampoline nên không chết theo GUI; nó giữ **lease bằng named pipe** và là **writer duy nhất** của journal.
- Runner chạy backend thật (`claude -p`, `codex exec`, `agy`) qua adapter, bọc trong `jobrun.exe`. jobrun là một Job Object `KILL_ON_JOB_CLOSE`, biên dịch tại chỗ và tự kiểm; nếu hỏng thì runner chạy thẳng và kèm cảnh báo.
- Runner chuẩn hóa kết quả thành một envelope chung, kèm retry, resume, followup và cancel theo thời điểm.
- Orchestrator không bị chặn: nó nhận `task_id`, rồi chờ kết quả bằng `subagent_wait` (≤50 s), hook `orch inbox --hook`, hoặc `orch wait --until-done` chạy nền.

**Dùng nhanh.**
1. Đăng ký MCP server: `node <repo>/system-by-claude/src/bin/mcp-server.mjs`. Mẫu cho từng GUI có trong `src/README.md`.
2. Trong GUI, gọi `subagent_doctor`. Kết quả cần có `jobrun.exec_ok:true` và `codex_hub` đúng mục.
3. Gọi `subagent_spawn {prompt, cwd, backend: "claude"|"codex"|"antigravity"}` để lấy `task_id`, rồi `subagent_wait {task_ids}` để lấy brief và summary. Nếu task cần thêm việc, dùng `subagent_followup` để lấy `followup_id`, rồi `subagent_wait {until_followup}`.
4. CLI tương đương: `node src/bin/orch.mjs spawn|wait|status|result|cancel|doctor|inbox`.
5. Test: `cd src && npm test`, không gọi backend thật.

**Cấu trúc thư mục.**
```
docs/00-README.md      tệp này
docs/01,03,05,07       thiết kế r1, r2, r3, r3.1 (07 = bản hiện hành, kèm danh sách kiểm tay)
docs/02,04,06          phản biện các vòng
src/bin/               mcp-server, orch (CLI + hook), runner-trampoline, runner-main
src/lib/               hub, runner, store/journal, lease, jobrun, proc, schema, failures, hooks, doctor, adapters/
src/test/              node:test; fixtures/fake-backend.mjs; r3.test (E/D), r31.test (F/M)
```

**Đã kiểm** [đo trên Windows 11, Node 26]:
- 104/104 test pass, chạy 3 lần liên tiếp.
- Lease loại trừ, kể cả pipe khác quyền → `lease_permission`.
- Journal một writer khi có 30 runner tranh nhau.
- Runner sống sót khi host chạy `taskkill /T` (nhờ trampoline).
- Cháu `start /b` chết khi cancel, cả qua đường JOB_LIST lẫn SUSPENDED.
- jobrun hỏng → chạy thẳng, có warning.
- Cancel/followup theo thời điểm; `wait` không treo.
- Thông báo: mất 0, lặp 0.
- 8.3/junction cùng project.
- `-c` của Codex chỉ thêm cho mục có thật.
- Quoting cmd/npm shim.

**Chưa kiểm** (cần người dùng, xem `07-design-r3.1.md` §7):
- Chưa chạy backend thật nào. Adapter được viết theo tài liệu, chưa có golden transcript (R4/R5).
- Hành vi dọn tiến trình thật của từng GUI khi đóng (R3).
- Cú pháp `-c` trên Codex thật (M4).
- AV hoặc AppLocker thật đối với jobrun.

**Bước tiếp theo.**
1. Người dùng chạy danh sách kiểm tay §7, trước hết là Claude Code #1: một task Codex, để kiểm M4.
2. Chạy mỗi backend một task với `ORCH_CAPTURE_GOLDEN=1`, rồi đưa transcript vào test.
3. r4: `orch gc`; thông điệp lỗi trần liệt kê project; đọc thêm các dạng `projects` trust trong TOML.
