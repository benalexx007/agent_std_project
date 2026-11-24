# subagent-hub (bản nháp r3.1)

Hub cục bộ để GUI của **Claude Code, Codex hoặc Antigravity** giao việc cho subagent trên **bất kỳ** backend nào trong ba backend đó theo cùng một cách gọi: không chặn GUI, nhận về một định dạng kết quả chung, và resume được sau khi tắt GUI.

Thiết kế hiện hành: `../docs/05-design-r3.md` + bản sửa `../docs/07-design-r3.1.md` (bổ sung cho `03-design-r2.md`). Tổng quan một trang: `../docs/00-README.md`. Các bản r1/r2 và phản biện (`02`, `04`) để tham khảo.

Viết bằng Node.js ≥ 22, chỉ dùng module có sẵn (không cần `npm install`), chạy trên Windows gốc.

## Cấu trúc

```
bin/mcp-server.mjs     MCP server stdio: subagent_spawn/run/wait/status/result/cancel/followup/resume/list/doctor
bin/orch.mjs           CLI tương đương + `orch inbox --hook` (hook) + `orch wait --until-done` (Bash nền) + `orch doctor`
bin/runner-trampoline.mjs  r3: tầng đệm launch (spawn runner detached rồi thoát ngay; làm đứt cây PID)
bin/runner-main.mjs    runner tách rời (mỗi task một tiến trình); là writer DUY NHẤT của journal khi giữ lease
lib/lease.mjs          lease/slot/poke bằng named pipe (Windows) / abstract socket (Linux)
lib/store.mjs          task.json, journal (Journal: một writer), control/, thông báo bất biến + cursor
lib/runner.mjs         supervisor: tiếp quản, slot, attempt, watchdog (idle/tool_idle/wall/total), phân loại lỗi, retry/resume/repair/failover/park
lib/hub.mjs            API không chặn; tự chữa task stale; chống đệ quy (env + tổ tiên tiến trình) + ORCH_MAX_ACTIVE
lib/schema.mjs         TaskSpec (trường công khai), envelope v1 + bất biến, hợp đồng kết quả, strict schema cho Codex, validator
lib/failures.mjs       lớp lỗi + bảng quyết định
lib/hooks.mjs          điểm móc policy (no-op mặc định; on_notify = toast)
lib/notify.mjs         toast Windows/Linux
lib/doctor.mjs         chẩn đoán môi trường (không chạy backend)
lib/proc.mjs           phân giải lệnh theo PATHEXT, chạy shim npm (.cmd/.ps1) không qua cmd.exe/powershell, escape cmd, kill cây, thời điểm tạo, tổ tiên (async)
lib/jobrun.mjs         r3: biên dịch jobrun.exe (Add-Type, csc có sẵn của .NET Framework) — bọc backend trong Job Object KILL_ON_JOB_CLOSE
lib/adapters/          claude-code.mjs, codex.mjs, antigravity.mjs, fake.mjs (chỉ khi ORCH_ENABLE_FAKE=1)
test/                  node:test; backend giả lập test/fixtures/fake-backend.mjs; r3.test.mjs = E1–E10 + D1–D7; r31.test.mjs = F1–F5 + M5–M10
```

## Chạy test

```powershell
cd system-by-claude/src
npm test        # = node --test "test/*.test.mjs"
```

Lần chạy ngày 2026-11-16 trên Windows 11 với Node v26.13.0 (r3.1): **104/104 pass**, chạy 3 lần liên tiếp (51–58 giây mỗi lần). Các test **không** gọi backend thật. Ba adapter thật mới được test bằng dòng JSON tự soạn theo tài liệu, chưa có golden transcript.

## Đăng ký với orchestrator (mẫu)

Store mặc định: `%LOCALAPPDATA%\subagent-hub\default`, dùng chung cho cả ba GUI, không phụ thuộc cwd. `cwd` là **bắt buộc** khi gọi qua MCP.

Claude Code (`.mcp.json`):
```json
{ "mcpServers": { "subagent-hub": { "type": "stdio", "command": "node",
  "args": ["D:/Code/AI/agentic_std_proccess/system-by-claude/src/bin/mcp-server.mjs"] } } }
```
Hook (`settings.json`): `UserPromptSubmit` và `SessionStart` chạy `node D:/…/src/bin/orch.mjs inbox --hook`. Với việc dài, orchestrator chạy Bash nền `node D:/…/src/bin/orch.mjs wait <task_id> --until-done [--deadline <ms>]`; lệnh xong sẽ đánh thức phiên. Mặc định `--deadline` là 2 giờ; quá hạn thì lệnh trả `deadline_exceeded:true`. Sau một followup, dùng `--until-followup <followup_id>`. Lệnh `orch inbox --hook` chỉ báo các task thuộc project của phiên (lấy `cwd` từ stdin của hook, hoặc từ `--cwd`); thêm `--all` để xem mọi task.

Codex (`~/.codex/config.toml`):
```toml
[mcp_servers.subagent-hub]
command = "node"
args = ["D:/Code/AI/agentic_std_proccess/system-by-claude/src/bin/mcp-server.mjs"]
```
Hook `UserPromptSubmit`/`SessionStart`: `node D:/…/src/bin/orch.mjs inbox --hook`.
Worker Codex do hub chạy nhận `-c mcp_servers.<tên>.enabled=false` để không nạp lại hub (đệ quy), **chỉ** cho những mục có thật trong `$CODEX_HOME/config.toml` (mặc định `~/.codex`) và trong `.codex/config.toml` của dự án đã trusted, nếu mục đó có tên trong `ORCH_CODEX_HUB_NAMES` hoặc `command`/`args` trỏ tới `mcp-server.mjs` (r3.1 F4: `-c` cho mục không có sẽ tạo mục thiếu `command`/`url` và làm `codex exec` hỏng). Tên mục nên chỉ gồm `[A-Za-z0-9_-]`; tên khác (vd `"hub x"`, `a.b`) không tắt được qua `-c` và `doctor` báo `codex_hub.skipped`. Xem `doctor` → `checks.codex_hub`.

Antigravity (`.agents/mcp_config.json` hoặc `~/.gemini/config/mcp_config.json`): cùng lệnh. Server stdio của agy **không kế thừa env**, nên mọi biến cần thiết phải khai trong `env`, ví dụ `"env": {"LOCALAPPDATA": "C:/Users/<you>/AppData/Local"}` hoặc `ORCH_HOME`. Hook `PreInvocation`/`SessionStart`: `orch inbox --hook` (luôn exit 0 vì hook agy là fail-closed).

Kiểm tra cài đặt: gọi tool `subagent_doctor` **từ** GUI, hoặc chạy `node bin/orch.mjs doctor`. Sau đó kiểm thủ công: spawn task dài, đóng GUI, mở lại, gọi `subagent_status` và phải thấy `runner_alive:true` hoặc task đã xong.

## Biến môi trường

| Biến | Ý nghĩa |
|---|---|
| `ORCH_HOME` | thư mục store (mặc định `%LOCALAPPDATA%\subagent-hub\default`) |
| `ORCH_POLICY` | module policy (export các hook trong `lib/hooks.mjs`; `pre_attempt` trả `grants.write` để cho phép `access:"write"`) |
| `ORCH_CLAUDE_CMD`, `ORCH_CODEX_CMD`, `ORCH_ANTIGRAVITY_CMD` | ghi đè lệnh backend (mặc định là `claude`, `codex`, `agy`) |
| `ORCH_WORKER_MCP_CONFIG` | file `--mcp-config` cho worker Claude |
| `ORCH_MAX_DEPTH` | độ sâu đệ quy tối đa (mặc định 2) |
| `ORCH_MAX_ACTIVE` | số task chưa xong tối đa, tính trên toàn store (mặc định 8) |
| `ORCH_MAX_ACTIVE_PER_CWD` | số task chưa xong tối đa cho mỗi project/cwd (mặc định 4) — r3 N6 |
| `ORCH_JOBRUN` | `0` để tắt việc bọc backend bằng jobrun.exe (khi tắt, cháu chạy nền của backend có thể sống sót sau cancel) — r3 N5 |
| `ORCH_JOBRUN_NO_JOBLIST` | `1` để jobrun không dùng `PROC_THREAD_ATTRIBUTE_JOB_LIST` mà lùi về CREATE_SUSPENDED + AssignProcessToJobObject như r3 — r3.1 M9 |
| `ORCH_JOBRUN_DEBUG` | `1`: jobrun ghi `[jobrun-debug] joblist` hoặc `[jobrun-debug] suspended` ra stderr (test) |
| `ORCH_JOBRUN_PARENT` | runner tự đặt: jobrun.exe theo dõi PID này; nếu cha chết thì `TerminateJobObject` |
| `ORCH_CAPTURE_GOLDEN` | thư mục; nếu đặt, runner chép raw.jsonl của mỗi attempt vào đó để làm golden transcript (D7) |
| `ORCH_LAUNCH_DIRECT` | `1` để launch runner trực tiếp như r2. Mặc định runner được launch qua `bin/runner-trampoline.mjs`, để nó không nằm trong cây PID của MCP server; nhờ vậy nó không bị `taskkill /T` của GUI host kéo theo — D4b |
| `ORCH_CODEX_HUB_NAMES` | tên mục MCP của hub trong config Codex, cách nhau bằng dấu phẩy (mặc định `subagent-hub`); r3.1: chỉ **chọn** trong các mục có thật, không tạo mục mới — D3/F4 |
| `CODEX_HOME` | (của Codex) hub đọc `$CODEX_HOME/config.toml` để quyết định `-c` — F4 |
| `ORCH_ANCESTRY_CHECK` | `0` để tắt kiểm tổ tiên tiến trình |
| `ORCH_TOAST` | `0` để tắt toast |
| `ORCH_ENABLE_FAKE` | `1` để bật backend giả (chỉ dùng cho test) |
| `ORCH_DEPTH`, `ORCH_PARENT_TASK` | hub tự đặt cho worker; `orch inbox` im lặng khi thấy các biến này |

## Trạng thái mới ở r3

- `runner_failed`: runner không khởi động được (ghi `runner.fatal.json`), hoặc hub đã launch ≥3 lần trong 60 giây mà chưa thấy `runner.started`. Hub thôi tự chữa và trả về `error.message`, `log_tail` cùng gợi ý. Sửa nguyên nhân rồi gọi `subagent_resume`.
- `subagent_followup` trả về `followup_id`. Gọi `subagent_wait` với `until_followup` để chờ đúng lượt của followup đó; nếu followup bị cancel bỏ thì kết quả có `followup.dropped:true`.
- `cancel` chỉ hủy những followup gửi **trước** yêu cầu cancel. Nếu task đã xong, kết quả của lượt đó được giữ nguyên.
- Cảnh báo mới trong `warnings`: `killed_mid_write` (task ghi bị hủy giữa chừng khi workspace đã thay đổi), `unknown_events:<n>` (backend có loại sự kiện lạ), `unverified_format` (định dạng kết quả không kiểm chứng được).
- `doctor` thêm các mục kiểm tra: `job_limits` (cờ LimitFlags của job mà tiến trình detached rơi vào), `jobrun` và `env`.


## Thay đổi ở r3.1 (sửa F1–F5 của docs/06-critique-r3.md)

- **MCP `subagent_wait` không còn `min_turn`** (CLI `--min-turn` vẫn còn). `subagent_followup` không trả `turn` nữa, chỉ trả `turn_estimate` để hiển thị. Muốn chờ đúng lượt của một followup thì dùng `until_followup`. Nếu vẫn chờ bằng `min_turn` mà lượt đó không bao giờ tới (followup bị cancel bỏ, hoặc task bị hủy), `wait` trả về ngay, kèm `min_turn_unreachable:true`.
- Brief/status có thêm `cancel: {at, dropped:[followup_id…]}` khi lệnh cancel đã bỏ followup. Trường này bị xóa khi task nhận một followup mới.
- `runner_failed` có thêm lớp `error.class = "lease_permission"`. Lớp này nghĩa là pipe lease đang bị một tiến trình khác quyền giữ, ví dụ GUI chạy elevated hoặc một user khác dùng chung `ORCH_HOME`. Hub báo ngay và không relaunch. Cách sửa: đặt `ORCH_HOME` riêng cho mỗi mức quyền.
- `runner_failed` do launch lặp chỉ được báo khi có ≥3 launch trong 60 giây **và** launch cũ nhất đã cách ≥15 giây. Trong vòng 5 giây kể từ launch gần nhất thì không launch thêm. Giới hạn 5 giây này dựa vào file trong store nên áp dụng chung cho mọi tiến trình hub.
- jobrun **tự kiểm** ngay sau khi biên dịch: chạy `jobrun cmd /c exit 7`, đạt thì ghi file `.ok`. Exe trong cache bị hỏng thì được biên dịch lại một lần. Nếu vẫn hỏng hoặc bị chặn, hub ghi file `.bad` (hiệu lực 24 giờ; xóa file này để thử lại).
- Lúc chạy, runner coi jobrun là hỏng khi spawn jobrun gặp `EFTYPE`, `EACCES`, `EPERM`, `UNKNOWN`, `ENOENT` (exe không còn) hoặc `EINVAL`, hay khi jobrun thoát với mã 120–123 kèm `[jobrun]`. Khi đó runner chạy lại **chính attempt đó** trực tiếp, không qua jobrun và không tính vào `max_attempts`. Runner ghi sự kiện `jobrun.unavailable` và thêm `warnings:["jobrun_unavailable"]`.
- `ensureJobrun` không bao giờ ném lỗi. doctor có thêm `checks.jobrun.exec_ok` và `checks.codex_hub`.
- jobrun dùng `PROC_THREAD_ATTRIBUTE_JOB_LIST`, nên backend nằm trong job ngay từ lúc được tạo. Nếu không dùng được, jobrun lùi về SUSPENDED + Assign. Có thể ép đường lùi bằng `ORCH_JOBRUN_NO_JOBLIST=1`.
- **Mọi tiến trình nền do worker khởi động (dev server, watcher, `start /b`) đều bị dừng khi lượt của worker kết thúc hoặc bị hủy**, vì job KILL_ON_JOB_CLOSE cấm breakaway. Hợp đồng kết quả gửi cho worker có ghi rõ điều này.
- `normCwd` giải tên 8.3 và junction bằng `realpathSync.native`. Với đường dẫn chưa tồn tại, nó giải tổ tiên gần nhất còn tồn tại.
