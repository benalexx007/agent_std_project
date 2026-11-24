# 03 — Thiết kế vòng 2: trả lời phản biện r1 và kiến trúc cập nhật

> Trạng thái: thiết kế r2 kèm mã tại `../src` (phiên bản `0.2.0-r2`). **56/56 test pass**, chạy 3 lần liên tiếp trên Windows 11, Node v26.13.0, mỗi lần khoảng 40 giây. Không lần nào gọi backend thật.
> Nhãn: **[KC]** đã kiểm chứng từ nguồn (có ghi nguồn). **[ĐO]** đo trên máy này trong vòng 2. **[TEST]** có test tự động trong `src/test`. **[GĐ]** giả định hoặc suy luận, chưa kiểm chứng.
> Tài liệu này **thay thế** `01-design-r1.md` ở mọi chỗ mâu thuẫn. Những phần r1 mà phản biện đã đồng ý giữ (QĐ1, QĐ2, QĐ3, QĐ6, QĐ8, QĐ9, QĐ10, QĐ11, QĐ13, trần 50 giây) được tóm tắt lại ở §2, không mở lại.

---

## 1. Bảng phản hồi từng điểm

Ký hiệu: ✅ chấp nhận và đã sửa · ◐ chấp nhận một phần hoặc dùng phương án khác · ✗ phản bác (có bằng chứng) · ⏭ chấp nhận về nguyên tắc, hoãn sang r3 (kèm lý do).

### 1.1 Mục B

| # | Phản hồi | Đã làm gì / bằng chứng |
|---|---|---|
| B1 | ✅ | `resolveCommand` chỉ nhận đuôi trong PATHEXT, duyệt theo thứ tự PATHEXT. Không còn chọn shim sh không đuôi. [TEST `proc.test`: thư mục có `x`, `x.cmd`, `x.ps1` thì chọn `.cmd`; thêm `x.exe` thì chọn `.exe`; lệnh không tồn tại ném ENOENT]. [ĐO `orch doctor`]: `claude` → `claude.exe` (direct), `agy` → `agy.exe` (direct), `codex` không có trong PATH của máy này. |
| B2 | ✅ | Schema gửi cho Codex được sinh bằng `strictFinalSchema()`. Mọi object có `additionalProperties:false`; mọi khóa nằm trong `required`; trường tùy chọn thành union với `null`; bỏ `maxLength`/`minLength`/`default`; `enum` thêm `null`. `artifacts.items` có `description`. Nếu `output_schema` của người dùng không biểu diễn được ở strict (object "bất kỳ", dictionary) thì task đó **không** dùng schema native: hub tự validate và repair. Codex từ chối schema (lớp `config` có `schemaRejected`) thì chạy lại **một lần** không có `--output-schema` (sự kiện `native_schema.disabled`). Kết quả thô được `dropOptionalNulls` trước khi validate. [KC notebook r2: strict structured outputs, schema sai bị từ chối ngay]. [TEST `core.test` `assertStrict` đệ quy; `adapters.test` đọc lại `final-schema.json` mà adapter ghi ra (P1)]. |
| B3 | ✅ (chọn named pipe) | Lease là **named pipe do hệ điều hành giữ**: `\\.\pipe\orch-<sha16(root)>-task-<id>`; trên Linux là abstract socket. Listen lần hai cùng tên trả `EADDRINUSE`. Tiến trình chết thì OS đóng handle, nên không cần pid, đồng hồ hay heartbeat. [ĐO `scratchpad/r2/race.mjs`: 10 vòng × 12 tiến trình tranh một tên pipe, **mỗi vòng đúng 1 bên thắng**]. [TEST đa tiến trình, tương đương P4b]: 50 task, mỗi task hai `runner-main` chạy **đồng thời**, theo lô 10 task (20 tiến trình). Cả 50 task đều có đúng 1 `attempt.started`, 1 `task.created` và seq 1..n duy nhất. Đã chạy 3 lần: 150/150 lần, **0 lần chạy đôi**. [TEST]: holder bị `SIGKILL` thì lease chiếm lại được ngay. |
| B4 | ✅ | Quy tắc một câu: **chỉ bên giữ lease mới ghi journal**. Hub chỉ ghi `task.json` (khi tạo) và `control/*` (cancel/resume/followup), rồi launch runner. `task.created` do runner ghi khi journal rỗng. Cancel lúc chưa có runner: hub launch một runner "janitor"; runner này chiếm lease, thấy `cancel.request` và ghi `task.completed{cancelled}`. `Journal` giữ seq và state trong bộ nhớ, nên mỗi lần ghi là O(1). [TEST]: "hub KHÔNG BAO GIỜ ghi journal" (spawn/followup/resume/cancel với launcher no-op thì `events.jsonl` không tồn tại); "hủy ngay sau spawn với runner khởi động chậm" cho ra `cancelled`, 0 attempt, 1 `task.completed`; bất biến seq 1..n được kiểm trên **mọi** task của mọi test e2e (`checkInvariant`). P4a không còn áp dụng vì chỉ còn một writer. |
| B5 | ✅ | Thêm lớp `no_output`: thoát 0 mà không có tin nhắn cuối thì thử lại **đúng 1 lần**, sau đó `failed`. `degraded` chỉ dùng khi **có** text nhưng sai hợp đồng, và khi đó là `succeeded` + `error:null` + `warnings:['unverified_format']`. `makeEnvelope` ném lỗi nếu `succeeded` mà `error!==null` hoặc `summary===''`. [TEST]: `silent` cho ra failed/no_output sau 2 attempt; `silent_once` cho ra succeeded; `bad_output_always` cho ra degraded hợp lệ; bất biến kiểm trên mọi kết quả succeeded của test e2e. |
| B6 | ✅ | Thay inbox phá hủy bằng **thông báo bất biến** (`notifications/<ts>-<id>-<rand>.json`) cộng **cursor theo người tiêu thụ** (`cursors/<consumer>.json`). Consumer lấy từ `session_id` (Claude/Codex) hoặc `conversationId` (agy) trong stdin của hook. `orch inbox` **im lặng** khi `ORCH_DEPTH>0` hoặc có `ORCH_PARENT_TASK`, tức là trong worker. `subagent_list` không còn tiêu thụ thông báo. [TEST `B6`]: worker không in gì; phiên s1 thấy một lần rồi không lặp lại; phiên agy khác vẫn thấy; lỗi vẫn exit 0. |
| B7 | ✅ | (a) `subagent_run`: chờ tối đa 45 giây, xong kịp thì trả kết quả trong **một** lần gọi. (b) `wait` trả **kèm summary** của task đã xong, không cần gọi thêm `result`. (c) Claude Code: chạy Bash nền `orch wait <id> --until-done`; lệnh kết thúc sẽ đánh thức phiên idle [KC notebook r2]. (d) Toast Windows cho người dùng với mọi GUI. (e) Có ma trận giao kết quả theo GUI ở §2.6. |
| B8 | ◐ | **Bỏ** nhánh MCP Tasks tự viết khỏi r2 (mã chết). Server chỉ quảng bá 2025-06-18 / 2025-03-26 / 2024-11-05. Client 2026-07-28 gọi `server/discover` thì nhận -32601 và tự quay về `initialize` [KC notebook r2: fallback khi -32601]. Request mang `_meta["io.modelcontextprotocol/protocolVersion"]` không hỗ trợ thì trả -32602 kèm `data.supported`. [TEST MCP stdio]. Chuyển sang SDK + Tasks: ⏭ r3 (xem §4). Nguồn cho câu "Claude Code v2.1.304+": xem E6. |
| B9 | ✅ | Thêm hai lớp không phụ thuộc env. (1) **Kiểm tổ tiên tiến trình**: nếu một tổ tiên của tiến trình hub là `backend_pid` của một task đang chạy thì đây là lời gọi từ worker. Độ sâu bằng `depth` của task cha; vượt `ORCH_MAX_DEPTH` thì từ chối. Lớp này chỉ chạy khi có backend đang chạy: một truy vấn CIM, cache theo Hub. (2) **Trần toàn cục** `ORCH_MAX_ACTIVE` (mặc định 8). Ngoài ra `ORCH_DEPTH`/`ORCH_PARENT_TASK` vẫn được truyền xuống worker. [TEST `B9`: env, MAX_ACTIVE, tổ tiên giả lập; `detectParentTask`]. |
| B9a | ⏭ | Chưa thêm `-c mcp_servers.<name>.enabled=false` cho Codex: tên khóa chưa có nguồn, và nếu sai khóa thì **mọi** lần chạy Codex hỏng (lớp `config`). Hook `finalize_argv` cho phép policy tự thêm khi đã xác minh. |
| B10 | ✅ (một phần ⏭) | (1) Runner có handler `uncaughtException`/`unhandledRejection`/tín hiệu: kill các backend con rồi mới thoát. Mỗi handler đọc dòng được bọc try. (2) Khi **tiếp quản**, runner đọc `attempt.started{pid, spawned_at}` cuối cùng. Chỉ kill nếu pid còn sống **và** thời điểm tạo (CIM `CreationDate`) lệch `spawned_at` không quá 10 giây, để chống PID reuse. Kết quả kill được ghi vào `task.interrupted.data.orphan`. [TEST]: kill được mồ côi thật rồi resume phiên cũ; pid bị "tái sử dụng" (thời điểm lệch 1 giờ) thì **không** kill; `procCreationTime` khớp thời điểm spawn thật. Job Object riêng cho mỗi attempt: ⏭ r3. |
| B11 | ✅ | `orch doctor` / `subagent_doctor` đo trong ngữ cảnh thật của MCP server. Xem §1.3 cho kết quả đo vòng 2 và cách đọc. Tài liệu không còn khẳng định "GUI có thể giết runner" khi chưa đo. |
| B12 | ✅ | Đếm `task.interrupted` **từ journal** trong turn hiện tại (`followup.accepted`, `task.created` và `task.resumed` reset bộ đếm). Vượt `max_interruptions` (mặc định 3) thì park `needs_attention{class:'poison'}`. [TEST]. |
| B13 | ✅ | `status()` và `wait()` probe lease. Nếu task cần runner mà pipe không có ai giữ thì **tự launch** lại runner, throttle 5 giây cho mỗi task. Việc này an toàn nhờ B3. Nếu đã vượt trần B12 thì runner park `poison`, nên `wait` trả về. [TEST `B13`]. |
| B14 | ✅ | Thêm `turn`. `followup` trả `{turn:n+1}`. `status` báo `pending_followups`; task có followup đang chờ thì không bao giờ được coi là xong. `wait` nhận `min_turn`; envelope có `turn`. [TEST tương đương P3-C]: launcher trễ 300ms, rồi `followup` và `wait(min_turn)` ngay. Kết quả trả về là turn 2 và `resumed:true`. Kể cả khi không truyền `min_turn`, `pending_followups` cũng chặn việc trả kết quả cũ. |
| B15 | ✅ | Adapter phát `tool_start`/`tool_end`: Claude dùng `tool_use`/`tool_result`; Codex dùng `item.started`/`item.completed`; agy dùng `step_update` [GĐ hình dạng]. Khi có tool đang mở, watchdog dùng `tool_idle_timeout_ms` (mặc định 60 phút) thay cho `idle_timeout_ms`. [TEST `long_tool`: idle 600ms, tool im lặng 1,5 giây, không bị kill]. |
| B16 | ⏭ (giữ trong danh sách r2 theo E12) | Hủy hiện vẫn là kill cây tiến trình, nhưng có hiệu lực tức thời nhờ "poke" qua pipe ([TEST]: dưới 1,5 giây). Driver interrupt sạch (Claude `control_request{subtype:"interrupt"}`, `codex app-server` `turn/interrupt`, agy SIGINT ra INTERRUPTED) được **thiết kế** ở §2.8 nhưng chưa viết mã. Lý do: không được chạy backend thật để kiểm định dạng thông điệp; trên Windows không gửi SIGINT tới một process group detached một cách tin cậy được. Về mối lo "đóng stdin bị agy hiểu là hủy": [KC notebook r2] EOF trên stdin với `--input-format stream-json` làm agy **chạy xong lượt, phát `result`, exit 0**, nên `stdin.end()` sau prompt là đúng. |
| B17 | ✅ | Ưu tiên **không đi qua cmd.exe**. Shim npm (cmd-shim) được đọc để lấy entry `.js` rồi chạy `node <entry>`, hoặc lấy entry `.exe` rồi chạy trực tiếp. Chỉ khi `.cmd` không phải shim npm mới đi qua `cmd.exe /d /s /c` với escape theo thuật toán cross-spawn (`^` cho metachar, escape kép cho `.cmd`). Đối số có xuống dòng bị từ chối. [TEST]: một `.cmd` không phải shim npm nhận 12 đối số gồm `{"d":"a & echo INJECTED_MARKER"}`, `a\|b`, `x > y.txt`, `100%`, `%OS%`, `a^b`, `"quoted"`, `!bang!`, `(paren)`, `back\slash\`, `""`. Tất cả round-trip nguyên vẹn, chỉ có **một** dòng output và file `y.txt` không được tạo. |
| B18 | ✅ | (a) `spec.access: 'read'\|'write'` (mặc định `read`). (b) `write` mà `pre_attempt` không trả `grants.write` thì fail-fast lớp `config`, **0 attempt**. (c) Envelope có `denials[]`, lấy từ Claude `result.permission_denials` [KC notebook r2], Codex item declined/rejected [GĐ tên trạng thái] và fake. (d) `warnings`: `permission_denied`; `no_changes` khi `access=write`, `changed_files` rỗng và `git status --porcelain` không đổi. [TEST]. |
| B19 | ✅ | MCP chỉ nhận `PUBLIC_SPEC_FIELDS`: prompt, title, backend, failover, cwd, output_schema, summary_max_chars, model, run_id, idempotency_key, access. `backend_options`, `limits` và `policy` bị bỏ. Thứ tự argv: `backend_options` → `extraArgs` của policy → hook **`finalize_argv`** có quyền sửa hoặc xóa argv cuối cùng. [TEST MCP: `backend_options:{fake:{scenario:'auth'}}` và `limits.max_attempts:99` không có hiệu lực]. |
| B20 | ✅ | (1) Chỉ Codex bật schema native; Claude và agy tắt, và tài liệu ghi đúng như vậy. (2) `cancelled` cho ra `status:'cancelled'`. (3) `crash`: resume 1 lần; nếu chính lần resume crash thì chạy mới; [TEST] chuỗi mode là `fresh, resume, fresh`. (4) Lý do của trần 50 giây sửa lại thành: giới hạn timeout tool call phía client, cụ thể là `tool_timeout_sec` của Codex, có giá trị mặc định [GĐ, chưa có nguồn]. Giữ 50 giây như một hằng số bảo thủ. (5) `depth`/`ORCH_PARENT_TASK` được dùng ở B9. (6) `list` không xả inbox. (7) Đã bỏ `MCP_TASK_STATUS`. |
| B21 | ✅ | agy: `WAITING` → `permission` (park); `INVALID` → `config`; `CANCELED` → `cancelled`; exit 1/2 → `config`; `INTERRUPTED` → `crash`; `AGY_ERROR{canonical_status,error_code}` trên stderr được map theo bảng (exit 3 + 429 → `rate_limited`). [KC notebook r2: exit 0/1/2/3 + `AGY_ERROR`]. [TEST]. |
| B22 | ✅ | `api_retry` chỉ được dùng nếu là tín hiệu cuối: gặp assistant message thì reset. `retry_delay_ms` không còn được coi là thời điểm reset. Parse thêm `limit…\|<epoch 10–13 chữ số>` và "try again at H:MM AM/PM" (nếu giờ đó đã qua thì tính sang ngày mai). [TEST]. Chuỗi rate limit chính xác của Codex: [GĐ], đã đưa vào truy vấn đề xuất. |
| B23 | ◐ | `cwd` **bắt buộc** từ MCP. `ORCH_HOME` mặc định là `%LOCALAPPDATA%\subagent-hub\default`, **một store cho mỗi người dùng**, không nằm trong repo và không phụ thuộc cwd của MCP server. Không chọn `hash(project)`, lý do ở §4 D5. `roots/list`: ⏭ (cwd bắt buộc đã đủ). |
| B24a | ✅ | Đưa vào rủi ro R-bare (§3). Lỗi `auth` có dấu hiệu "thiếu API key" thì thông báo nêu đúng nguyên nhân có thể là `--bare` mặc định. [TEST]. Kiểm "`-p` còn dùng phiên subscription" chỉ làm được khi được phép chạy backend. |
| B24 | ✅ (trừ FIFO) | Slot cũng là named pipe (`slot-<backend>-<i>`), tự nhả khi runner chết, nên hết rò slot do PID reuse. **Không** làm FIFO: backoff ngẫu nhiên 300–600ms là đủ ở quy mô ≤ 8 task. Thêm `total_timeout_ms` (6 giờ cho mỗi turn; reset khi runner khởi động lại, ghi ở §3). Journal ghi O(1). Validator hỗ trợ `additionalProperties:false`, `anyOf`, `minLength`. `extractJsonBlock` hiểu chuỗi (dấu `}` trong chuỗi) và lấy object **cuối cùng**. [TEST]. |

### 1.2 Mục C

| # | Phản hồi |
|---|---|
| C1 | ✅ Named pipe làm lease, liveness, slot và kênh poke (cancel/followup/resume có hiệu lực tức thời; `status` trả `runner_alive`, `runner_unresponsive`). Vẫn không có daemon. |
| C2 | ✅ Quy tắc một writer (B4). |
| C3 | ✅ Ma trận ở §2.6, cộng toast. |
| C4 | ✅ `subagent_run`; `wait` trả kèm summary. |
| C5 | ✅ `orch doctor` / `subagent_doctor`: phân giải lệnh (không chạy), ghi + rename store, lease, Job Object, tổ tiên tiến trình. Riêng "MCP server có được GUI nạp hay không": gọi `subagent_doctor` **từ** GUI, nếu tool trả lời được thì server đã được nạp. |
| C6 | ⏭ Golden transcript cần chạy backend thật, việc này bị cấm ở vòng này. Thư mục dự kiến là `test/fixtures/golden/<backend>/<case>.jsonl`, test hóa `parseLine`/`classifyExit`. |
| C7 | ✅ Bỏ Tasks; `fake`/`fakeN` chỉ tồn tại khi `ORCH_ENABLE_FAKE=1`, kể cả trong `normalizeSpec`. |
| C8 | ✅ Đồng ý: không SQLite, không daemon. |

### 1.3 Mục E (điều kiện chấp nhận) — đối chiếu

| # | Điều kiện | Trạng thái |
|---|---|---|
| E1 | P4b ≥ 50 lần, 0 chạy đôi; P4a 0 seq trùng; hub không append | **Đạt.** 3 × 50 = 150 lần, 0 chạy đôi [TEST]. Chỉ còn một writer, seq 1..n được kiểm trên mọi task. Hub không append [TEST]. |
| E2 | Bất biến envelope; exit 0 im lặng thì `failed` sau ≤ 1 lần thử lại | **Đạt** [TEST]. |
| E3 | Test shim giả; test chèn lệnh P2 | **Đạt** [TEST]. |
| E4 | Bất biến strict, `description`, fallback khi bị từ chối | **Đạt** [TEST]. |
| E5 | Ma trận GUI, cursor, hook không chạy trong worker, toast | **Đạt** (§2.6). Chỗ còn mở: agy có chèn stdout của hook vào context hay không là [GĐ]; toast đã chạy hết script, xem §3 R-toast. |
| E6 | Chỉ quảng bá phiên bản hiện thực được; `server/discover`/`_meta`; bỏ Tasks; dẫn nguyên văn nguồn v2.1.304 | **Đạt** phần mã [TEST]. Nguồn: lần WebFetch tài liệu Claude Code (trang MCP, mục MCP tasks) trong vòng 2 trả câu: "Requirements: Claude Code v2.1.304+; a connection on protocol revision 2026-07-28 (v2 runtime)" và "A one-shot `claude -p` run doesn't get MCP tasks". **Mâu thuẫn nguồn:** notebook nói chưa có client Claude Code nào gửi `tools/call` có task. Vì r2 đã bỏ Tasks nên mâu thuẫn này không chặn. Ghi là rủi ro R-tasks, và chỉ làm Tasks ở r3 khi có test với client thật. |
| E7 | Một lớp không phụ thuộc env + `ORCH_MAX_ACTIVE` | **Đạt** (tổ tiên tiến trình + MAX_ACTIVE) [TEST]. |
| E8 | Tài liệu theo kết quả đo + kế hoạch đo "đóng GUI" | **Đạt.** Xem bảng đo dưới đây. |
| E9 | Kill mồ côi đã xác thực; trần từ journal; `wait` không treo khi stale | **Đạt** [TEST]. Job Object theo attempt: r3. |
| E10 | `wait` sau `followup` không trả kết quả cũ | **Đạt** [TEST]. |
| E11 | `access` + fail-fast; lọc trường; policy quyết định argv cuối | **Đạt** [TEST]. |
| E12 | B15/B16 có trong danh sách, kèm giả định | B15 **đã làm**; B16 đã thiết kế (§2.8), mã ở r3. |
| E13 | R-bare trong rủi ro + phát hiện | **Đạt.** |

**Kết quả đo Job Object vòng 2 [ĐO]** (ngữ cảnh: công cụ shell của phiên Claude Code desktop, **không phải** MCP server do GUI khởi động; mỗi GUI cần chạy `subagent_doctor` để có số đo của chính nó):

| Phép đo | Kết quả | Ý nghĩa |
|---|---|---|
| `powershell.exe` 5.1 khởi động **detached** (`DETACHED_PROCESS`) | Thoát 0 sau khoảng 190ms, **không chạy script** (thử cả có và không `windowsHide`) | Đây là lý do doctor r2 bản đầu đo hỏng. Toast r1/r2-đầu (spawn PowerShell detached) **không bao giờ hiện**, nên đã sửa (§3 R-toast). Phép đo P6/P7 của phản biện đi qua `cmd /c powershell` nên không gặp lỗi này. |
| PowerShell **không** detached, tự hỏi job của mình | `LimitFlags=0x3C00` | Đó là job của libuv, khớp P6. Từ bên trong không đọc được job của host. |
| `node` detached (giống launcher runner), hỏi từ ngoài bằng `IsProcessInJob(pid)` | `in_job=true` | Runner vẫn thuộc **một** job: job của host, khớp P7 "job host 0x0". |
| Tiến trình tạo qua WMI `Win32_Process.Create` | `in_job=true` | Trên Windows 11 này, kể cả tiến trình do WMI tạo cũng thuộc job. Vì vậy `in_job=true` **không đủ để kết luận** runner sẽ chết khi đóng GUI. Ngoài ra launcher WMI cũng không chắc giúp thoát job như r1 giả định. |

Kết luận cho r2: kết hợp với P7 của phản biện (job host có `LimitFlags=0x0`, không có KILL_ON_JOB_CLOSE), runner detached **sống sót khi MCP server đóng**, trừ khi host chủ động `TerminateJobObject`. Không làm launcher breakaway. Kiểm chứng cuối cùng là **thủ công cho từng GUI**: spawn task dài (`slow`), đóng GUI, mở lại, gọi `subagent_status` và thấy `runner_alive:true` (hoặc task đã xong). `subagent_doctor` in `runner_in_job`, `breakaway` và một verdict có câu "không kết luận được" khi `in_job=true`.

---

## 2. Kiến trúc r2 (đầy đủ)

### 2.1 Sơ đồ

```
 GUI orchestrator (Claude Code | Codex | Antigravity)
 ├─ native subagent (việc ngắn, chỉ đọc, trong phiên)
 ├─ hook UserPromptSubmit/SessionStart(/PreInvocation) ─► orch inbox --hook   (thông báo theo cursor của phiên)
 ├─ Bash nền (chỉ Claude Code): orch wait <id> --until-done ─► xong thì đánh thức phiên idle
 └─ MCP client ─stdio─► subagent-hub MCP server (không giữ trạng thái nghiệp vụ; mỗi GUI một tiến trình)
                          │ spawn/run/wait/status/result/cancel/followup/resume/list/doctor
                          │ ghi: task.json (lúc tạo) + control/*.request|followup-*.json      ◄── KHÔNG ghi journal
                          │ probe/poke: connect \\.\pipe\orch-<h>-task-<id>
                          ▼
   ORCH_HOME (%LOCALAPPDATA%\subagent-hub\default)
     tasks/<id>/ task.json · events.jsonl · state.json · control/ · attempts/<n>/{invocation.json,raw.jsonl,stderr.log}
                 artifacts/final-message.md · result.json · runner.log
     notifications/<ts>-<id>-<rand>.json (bất biến) · cursors/<consumer>.json · idem/<sha>.json
                          ▲ ghi journal (writer DUY NHẤT = bên giữ pipe task-<id>)
                          │
   runner-main (node detached, mỗi task một tiến trình; vòng ngoài kiểm lại control/ sau khi nhả lease)
     ├─ lease pipe task-<id> (info + poke) · slot pipe slot-<backend>-<i>
     ├─ tiếp quản: kill mồ côi đã xác thực → task.interrupted → (poison?) → resume
     ├─ adapter → spawn CLI headless (planSpawn: direct | node-shim | exe-shim | cmd đã escape)
     │     claude -p --output-format stream-json --verbose --strict-mcp-config [--resume]
     │     codex exec --json [--output-schema strict.json] [resume <id>] -
     │     agy -p --output-format stream-json --input-format stream-json [--conversation <id>]
     ├─ watchdog: idle | tool_idle (khi có tool mở) | wall/attempt | total/turn | cancel (poke)
     ├─ phân loại lỗi → decide → retry | resume | repair | failover | park | fail | cancel
     └─ result.json (envelope v1) → task.completed → notification (+ on_notify: toast)
```

### 2.2 Các quyết định (r2)

| QĐ | Nội dung r2 | Thay đổi so với r1 |
|---|---|---|
| QĐ1 | Một MCP server stdio, đăng ký giống nhau ở cả ba GUI. Bộ tool `subagent_*` không phụ thuộc backend. | + `subagent_run`, `subagent_doctor`; bỏ MCP Tasks |
| QĐ2 | Backend chạy qua CLI headless có luồng JSON; mọi khác biệt nằm trong adapter. | Spawn không qua cmd.exe (B1/B17); chỉ Codex dùng schema native |
| QĐ3 | Không chặn: runner tách rời cho mỗi task; file-system-as-bus; không daemon. | Thêm named pipe làm lease, liveness và poke |
| QĐ4 | Giao kết quả: `run` (đồng bộ nếu nhanh) → `wait` (≤ 50 giây, kèm summary) → hook theo cursor → Bash nền (Claude) → toast cho người. | Bỏ Tasks; thêm `run`, `--until-done`, toast; inbox không phá hủy |
| QĐ5 | Hợp đồng kết quả + validate + 1 lượt repair; `degraded` chỉ khi có text. | Strict schema; `no_output`; bất biến envelope |
| QĐ6 | Orchestrator chỉ thấy summary khoảng 1–2k token cùng tham chiếu artifact. | Giữ |
| QĐ7 | Journal append-only; `state = fold(journal)`; **một writer = bên giữ lease pipe**; hub chỉ ghi control. | Viết lại hoàn toàn (B3/B4) |
| QĐ8 | Resume bằng phiên backend. | + tiếp quản có kill mồ côi; trần interruption |
| QĐ9 | Phân loại lỗi trước khi quyết định. | + `permission`, `no_output`, `poison`; `cancelled` là trạng thái riêng |
| QĐ10 | Failover là opt-in, chạy phiên mới, có cảnh báo workspace bẩn. | Giữ |
| QĐ11 | Ma trận 3×3: dùng native cho việc ngắn ở đường chéo, mọi thứ khác qua hub. | Giữ |
| QĐ12 | Song song hóa việc đọc, tuần tự hóa việc ghi; chống đệ quy. | + tổ tiên tiến trình, `ORCH_MAX_ACTIVE`, `access` |
| QĐ13 | Windows gốc + Node ≥ 22, không phụ thuộc npm. | Giữ |

### 2.3 Giao diện gọi (giống nhau cho mọi backend)

| Tool MCP / lệnh CLI | Vào | Ra |
|---|---|---|
| `subagent_spawn` / `orch spawn` | **prompt, cwd** (bắt buộc), backend (`auto`\|`claude`\|`codex`\|`antigravity`), access, title, run_id, idempotency_key, failover[], output_schema, model | `{task_id, backend, created, turn:1, status}` trả về ngay |
| `subagent_run` / `orch run` | như spawn + `wait_ms` (≤ 45 giây) | xong kịp: envelope tóm tắt + `completed:true`; nếu chưa thì `{task_id, completed:false}` |
| `subagent_wait` / `orch wait [--until-done]` | task_ids[], mode any\|all, timeout_ms (≤ 50 giây), **min_turn** | `{timed_out, tasks:[{…brief, result?}]}`: task xong thì kèm summary |
| `subagent_status` | task_id | state + `pending_followups`, `runner_alive`, `runner_unresponsive`, `stale` (stale thì tự chữa) |
| `subagent_result` | task_id, view summary\|full\|events, since_seq | envelope |
| `subagent_cancel` | task_id | `cancel_requested` (poke tức thời; không có runner thì launch janitor) |
| `subagent_followup` | task_id, prompt | `{turn}`: sau đó gọi `wait(min_turn)` |
| `subagent_resume` | task_id | task đang park thì ghi `resume.request` rồi launch runner |
| `subagent_list` | run_id, active_only | brief[] (không tiêu thụ thông báo) |
| `subagent_doctor` / `orch doctor` | — | báo cáo môi trường (không chạy backend) |
| `orch inbox [--hook] [--consumer c] [--run r] [--json]` | stdin hook (`session_id`/`conversationId`) | vài dòng ngắn; luôn exit 0; im lặng trong worker |

### 2.4 Envelope `subagent-result/v1` (r2)

```json
{ "schema": "subagent-result/v1", "task_id": "t_…", "run_id": null, "turn": 1, "backend": "codex",
  "status": "succeeded|failed|cancelled|needs_input", "format": "contract|degraded",
  "summary": "…(≤ summary_max_chars, cắt kèm con trỏ tới final_message)", "outputs": {}, "artifacts": [{"path": "…", "description": "…", "abs": "…"}],
  "changed_files": [], "questions": [], "warnings": ["unverified_format|no_changes|permission_denied"],
  "denials": [{"tool": "Write", "detail": "…"}], "session": {"backend_session_id": "…", "resumable": true},
  "usage": {"per_attempt": []}, "attempts": 1, "failovers": [], "error": null,
  "refs": {"events": "tasks/<id>/events.jsonl", "transcript_dir": "…/attempts", "final_message": "…/artifacts/final-message.md"},
  "finished_at": "…" }
```
Bất biến: `status==='succeeded' ⇒ error===null && summary!==''`, được kiểm ngay trong `makeEnvelope`. `needs_attention` không phải trạng thái của envelope: đó là trạng thái của task (park), lý do nằm ở `status.failure`, và thông báo `needs_attention` kèm gợi ý `subagent_resume`.

### 2.5 Lớp lỗi và quyết định

| Lớp | Nguồn tín hiệu | Hành động |
|---|---|---|
| transient | 5xx, overloaded, UNAVAILABLE, lỗi mạng | retry/resume với backoff + jitter, hết lượt thì failover/fail |
| rate_limited | 429, quota, `AGY_ERROR RESOURCE_EXHAUSTED`, `api_retry` cuối | chờ reset nếu ≤ 5 phút; nếu lâu hơn thì failover (opt-in) hoặc backoff dài; hết lượt thì park |
| auth | not logged in, 401, thiếu API key (gợi ý R-bare) | failover (opt-in) hoặc park |
| permission | agy `WAITING` | park |
| hang | idle / tool_idle / wall | kill cây tiến trình, resume |
| crash | exit ≠ 0 không có kết quả, agy `INTERRUPTED` | resume 1 lần; nếu resume crash thì chạy mới; hết lượt thì failover/fail |
| no_output | exit 0, không có tin nhắn cuối | thử lại đúng 1 lần, sau đó fail |
| bad_output | sai hợp đồng | 1 lượt repair trong phiên, sau đó `degraded` (succeeded + warning) |
| agent_failed | agent tự báo `failed` | fail (không retry) |
| cancelled | người dùng hủy, agy `CANCELED` | status `cancelled` |
| config | ENOENT, cờ sai, `INVALID`, schema bị từ chối (Codex: tắt schema native 1 lần trước), `access=write` chưa được cấp quyền | park |
| poison | `task.interrupted` > `max_interruptions` trong turn | park |

Giới hạn mặc định: max_attempts 3, max_repairs 1, max_interruptions 3, idle 10 phút, tool_idle 60 phút, wall/attempt 2 giờ, total/turn 6 giờ. Chỉ policy/cấu hình đặt được các giới hạn này, MCP thì không.

### 2.6 Ma trận giao kết quả theo GUI

| GUI orchestrator | Tự đánh thức phiên idle? | Kênh khuyến nghị | Cần người gõ? | Thông báo cho người |
|---|---|---|---|---|
| **Claude Code** | **Có**: lệnh Bash chạy nền khi kết thúc sẽ mở một lượt mới trong phiên idle [KC notebook r2] | (1) việc ngắn: `subagent_run`; (2) việc dài: `subagent_spawn` rồi Bash nền `orch wait <id> --until-done`; (3) hook `UserPromptSubmit`/`SessionStart` → `orch inbox --hook` (stdout khi exit 0 thành system-reminder [KC]) | Không (với (2)) | toast |
| **Codex** | Không [GĐ: chưa có nguồn về cơ chế đánh thức] | `subagent_run`/`subagent_wait` trong lượt; hook `UserPromptSubmit`/`SessionStart` → `orch inbox --hook` | Có, ở lượt sau | **toast** (để người biết mà gõ) |
| **Antigravity** | Không [GĐ] | `subagent_run`/`subagent_wait`; hook `PreInvocation`/`SessionStart` → `orch inbox --hook` (stdin có `conversationId` [KC]; hook **fail-closed** nên inbox luôn exit 0 [KC]) | Có | **toast** |

Lập luận cho E5: với Codex và Antigravity, việc người dùng gõ prompt để nhận kết quả là chấp nhận được, vì (a) toast báo đúng lúc task xong hoặc cần xử lý, (b) lượt kế tiếp tự nhận thông báo qua hook mà không cần gọi tool, và (c) trong lượt đang chạy, orchestrator luôn có `wait` (≤ 50 giây mỗi lần gọi) nếu muốn chủ động chờ.

### 2.7 Đăng ký MCP và hook (mẫu)

- **Claude Code** (`.mcp.json` của project hoặc user): `{"mcpServers":{"subagent-hub":{"type":"stdio","command":"node","args":["<src>/bin/mcp-server.mjs"]}}}`. Hook trong `settings.json`: `UserPromptSubmit` và `SessionStart` chạy `node <src>/bin/orch.mjs inbox --hook`. Hook kế thừa env [KC], và `orch inbox` tự im lặng trong worker.
- **Codex** (`config.toml`): `[mcp_servers.subagent-hub] command="node" args=["<src>/bin/mcp-server.mjs"]`. Hook `UserPromptSubmit`/`SessionStart` tương tự. Cách Codex truyền env sang MCP server: [GĐ] (whitelist DEFAULT_ENV_VARS chưa có nguồn), nên **không** dựa vào env (B9 dùng tổ tiên tiến trình) và dùng `ORCH_HOME` mặc định theo người dùng.
- **Antigravity**: `.agents/mcp_config.json` (project) hoặc `~/.gemini/config/mcp_config.json` (user) [KC]. Server stdio **không kế thừa env**, nên mọi biến (vd `ORCH_HOME`, `LOCALAPPDATA` nếu cần) phải khai trong `env` của cấu hình [KC]. Hook `PreInvocation`/`SessionStart` gọi `orch inbox --hook`. Việc agy chèn stdout của hook vào context: [GĐ]. Không có cờ tắt một MCP server cho một lần chạy (`agy mcp disable` là lệnh cấu hình [KC]), nên chống đệ quy dựa vào tổ tiên tiến trình + MAX_ACTIVE.

### 2.8 Interrupt sạch (thiết kế cho r3, B16)

| Backend | Cơ chế | Hệ quả cho adapter |
|---|---|---|
| Claude | `--input-format stream-json`, giữ stdin mở; hủy bằng `{"type":"control_request","subtype":"interrupt"}` [KC notebook r2]; followup giữa lượt = ghi thêm user message | adapter có `interrupt(child)` và `send(child, prompt)`; runner gọi `interrupt` trước, đợi `result` ≤ 10 giây, sau đó mới `killTree` |
| Codex | `codex app-server` (JSON-RPC: `thread/start`, `turn/start`, `turn/interrupt`, `thread/resume`; chạy được trên Windows) [KC notebook r2] | driver mới cùng interface adapter; giải luôn #56875 (lượt bị từ chối vẫn exit 0) vì có trạng thái turn tường minh |
| agy | SIGINT → `finished_reason=INTERRUPTED` [KC]; trên Windows phải gửi CTRL_C/CTRL_BREAK tới process group, điều này khó với tiến trình detached [GĐ] | thử `control_request` (agy có cho exit 2 [KC]) trước, SIGINT sau |

Điều kiện để làm ở r3: được phép chạy backend để ghi golden transcript (C6).

### 2.9 Hook point cho policy (chỉ liệt kê)

`route` · `pre_spawn` · `pre_attempt` (trả `extraArgs`, `env`, **`grants.write`**, `deny`) · **`finalize_argv`** (argv cuối cùng, sửa hoặc xóa được) · `on_event` · `pre_resume` · `pre_failover` · `on_result` · `on_park` · **`on_notify`** (mặc định là toast) · `budget_check`. Policy nạp qua `ORCH_POLICY`. Nhắc lại [KC r1]: `claude -p` ở Manual mode, `codex exec` read-only, agy soft-deny vẫn exit 0. Vì vậy `access=write` **bắt buộc** policy cấp quyền (fail-fast).

---

## 3. Mã, test và rủi ro

### 3.1 Thay đổi mã (`src/`)

| File | Thay đổi |
|---|---|
| `lib/proc.mjs` | viết lại: PATHEXT, đọc shim npm, escape theo cross-spawn, `planSpawn`, `procCreationTime`, `processAncestry` |
| `lib/lease.mjs` | **mới**: lease/slot/poke bằng named pipe; `EBUSY` được coi là `unresponsive`, không phải stale |
| `lib/store.mjs` | viết lại: hub không append; `Journal` một writer O(1); thông báo bất biến + cursor; control; `turn`/`interrupted` |
| `lib/runner.mjs` | viết lại: lease, tiếp quản, poison, janitor, followup/turn, tool_idle, access, denials, no_output, tắt schema native khi bị từ chối, `hasWork`/`runTaskLoop` |
| `lib/hub.mjs` | viết lại (async): tự chữa stale, tổ tiên tiến trình, MAX_ACTIVE, `run`, `wait(min_turn)` kèm summary |
| `lib/schema.mjs` | `PUBLIC_SPEC_FIELDS`, strictify, validator, bất biến envelope, `access`, limits mới |
| `lib/failures.mjs` | thêm lớp `permission`/`no_output`/`poison`; crash→resume 1 lần; parse thời điểm reset |
| `lib/adapters/*.mjs` | tool_start/end; denials; Codex strict + fallback; agy `AGY_ERROR`/WAITING/INVALID/CANCELED; Claude R-bare |
| `lib/hooks.mjs`, `lib/notify.mjs` (mới), `lib/doctor.mjs` (mới) | `finalize_argv`, `on_notify`; toast không detached + `flushToasts`; doctor |
| `bin/mcp-server.mjs`, `bin/orch.mjs`, `bin/runner-main.mjs` | thương lượng version; `run`/`doctor`; `inbox --hook`; `wait --until-done`; runner có handler lỗi và đợi toast trước khi thoát |
| `test/*` | `_env.mjs`, `core`, `adapters`, `proc` (mới), `runner` (viết lại); fixture có thêm 8 kịch bản |

### 3.2 Kết quả test

`cd src && npm test` (= `node --test "test/*.test.mjs"`): **56/56 pass**, chạy 3 lần, mỗi lần khoảng 40 giây (Windows 11, Node v26.13.0). Gồm: core 14, adapters 3, proc/lease/doctor 10, e2e 29 (trong đó có đa tiến trình 50×2 runner-main, MCP stdio, CLI hook, runner detached thật).

### 3.3 Rủi ro (cập nhật)

| Mã | Rủi ro | Giảm thiểu / phát hiện |
|---|---|---|
| R-bare | `--bare` trở thành mặc định của `claude -p`, worker mất đăng nhập subscription [KC notebook: "sẽ trở thành mặc định của -p"] | lỗi `auth` nêu đúng nguyên nhân; phương án dự phòng: cờ tắt bare tường minh (khi có) qua `finalize_argv`, hoặc driver Agent SDK (r3); doctor kiểm khi được chạy backend |
| R-job | Host chủ động `TerminateJobObject` khi đóng GUI | `subagent_doctor` + kiểm thủ công theo GUI (§1.3); nếu runner chết thì `reconcile`/tự chữa + resume phiên vẫn phục hồi được, chỉ mất thời gian chạy |
| R-toast | PowerShell 5.1 detached không chạy script [ĐO] | toast chạy PowerShell **không** detached và runner `flushToasts(8s)` trước khi thoát. [ĐO]: tiến trình toast chạy hết script trong khoảng 650ms (so với khoảng 190ms khi detached không làm gì). Toast **hiện trên màn hình** thì chưa xác nhận bằng mắt [GĐ]. Tắt bằng `ORCH_TOAST=0` |
| R-tasks | Nguồn mâu thuẫn về hỗ trợ MCP Tasks của Claude Code | r2 không dùng Tasks |
| R-mac | macOS không có abstract socket: socket file còn một cửa sổ race nhỏ khi dọn | mục tiêu chính là Windows; Linux dùng abstract socket |
| R-total | `total_timeout_ms` đếm lại từ đầu khi runner khởi động lại | trần poison giới hạn số lần khởi động lại; ghi trạng thái deadline vào journal ở r3 |
| R-anc | Kiểm tổ tiên tốn khoảng 0,5–1 giây (CIM), chỉ chạy khi có backend đang chạy, cache theo Hub | `ORCH_ANCESTRY_CHECK=0` để tắt |
| R-agy-tool | Hình dạng `step_update` cho tool của agy là [GĐ] | nếu sai thì chỉ mất tool_idle (về lại idle 10 phút), không gây sai kết quả |
| R-codex-env | Codex có thể không truyền env (`ORCH_DEPTH`) sang MCP server [GĐ] | tổ tiên tiến trình + MAX_ACTIVE |
| R-shared-store | Một store cho mọi project: `list` có thể dài | lọc theo `run_id`/`active_only`; mỗi task mang `cwd`; đặt `ORCH_HOME` riêng nếu muốn tách |

### 3.4 Giả định chưa kiểm chứng (r2)

1. Hình dạng `step_update` (tool) của agy; tên trạng thái declined/rejected của item Codex.
2. Codex: whitelist env cho MCP stdio, khóa `mcp_servers.<n>.enabled`, giá trị mặc định của `tool_timeout_sec`, chuỗi rate limit.
3. Antigravity có chèn stdout của hook `PreInvocation`/`SessionStart` vào context hay không; định dạng JSON nếu cần.
4. Codex và Antigravity không có cơ chế đánh thức phiên idle.
5. Toast hiện trên màn hình với AppID của PowerShell.

---

## 4. Bất đồng còn lại và điều kiện

| # | Điểm | Lập trường thiết kế | Điều kiện để thay đổi lập trường / để đóng |
|---|---|---|---|
| D1 | B8: SDK + MCP Tasks | Hoãn r3. r2 tự viết server tối thiểu, chỉ quảng bá phiên bản hiện thực, có test giao thức | Đóng ở r3 khi (a) có client thật (Claude Code ≥ v2.1.304 trên 2026-07-28) gửi `tools/call` có task, kiểm được bằng log, và (b) được phép thêm dependency npm. Nếu bên phản biện coi Tasks là bắt buộc cho r2 thì cần nêu kịch bản người dùng mà `run` + `wait` + Bash nền + hook không đáp ứng được |
| D2 | B16: interrupt sạch | Thiết kế xong (§2.8), mã ở r3 | Được phép chạy backend để ghi golden transcript của `control_request`/app-server. Bên phản biện đã nói không bắt buộc ở r2 (E12) |
| D3 | B9a: `-c mcp_servers.<n>.enabled=false` cho Codex | Không thêm khi chưa có nguồn cho tên khóa (sai khóa thì hỏng mọi lần chạy Codex) | Một nguồn chính thức (docs/config reference/mã codex-rs) cho tên khóa và hành vi. Khi có thì policy thêm qua `finalize_argv`, hoặc đưa vào adapter |
| D4 | B10: Job Object riêng cho mỗi attempt | Hoãn r3; r2 dùng kill mồ côi đã xác thực bằng thời điểm tạo + handler lỗi | Có test cho thấy cây cháu (backend sinh tiến trình con) sống sót sau `killTree` mồ côi trong kịch bản thực tế. `taskkill /T` hiện kill cả cây theo quan hệ cha con |
| D5 | B23: `ORCH_HOME` dùng chung theo người dùng thay vì `hash(project)` | Giữ store dùng chung. Lý do: (1) MCP server không biết project lúc khởi động, và cwd của server khác nhau giữa các GUI (chính là B23); (2) một store giúp người dùng chuyển GUI giữa chừng mà vẫn thấy task; (3) mỗi task đã mang `cwd` và `run_id` | Một kịch bản cụ thể mà store dùng chung gây sai, ví dụ hai project dùng cùng `idempotency_key`. Khi đó phương án là băm `idempotency_key` cùng `cwd`, thay vì tách store |
| D6 | B24: slot FIFO | Không làm ở quy mô ≤ 8 task (`ORCH_MAX_ACTIVE`) | Một phép đo cho thấy starvation (một task chờ slot > N lần trung bình) ở cấu hình mặc định |
| D7 | C6: golden transcript | Đồng ý về nguyên tắc; bị chặn bởi ràng buộc không chạy backend | Người điều phối cho phép chạy backend thật |

---

## 5. Nguồn

- Notebook "Agentic Harness & Loop Engineering Survey" (61848f50…), truy vấn vòng 2 về: Codex strict structured outputs, #56875, app-server; agy exit code/`AGY_ERROR`/EOF stdin/`control_request`/SIGINT/hook/MCP config/#76; MCP 2026-07-28 `server/discover`, fallback -32601, CreateTaskResult; Claude `control_request` interrupt, `permission_denials`, hook stdin/env/system-reminder, Bash nền đánh thức phiên.
- Tài liệu Claude Code, trang MCP (mục MCP tasks), truy xuất qua WebFetch ở vòng 2 (trích ở E6).
- Đo trên máy: `scratchpad/r2/race.mjs` (race named pipe), `jobdbg*.mjs`, `wmi.ps1` (Job Object, PowerShell detached, WMI), `orch doctor`.
- Phản biện `02-critique-r1.md` (P1–P7).
