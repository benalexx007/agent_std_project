# 07 — Bản sửa r3.1: đóng F1–F5 của `06-critique-r3.md` và mã `src/` 0.3.1-r3.1

Phạm vi: đây là các sửa cục bộ. Kiến trúc đã chốt ở 06 §E.3 và không đổi: lease pipe, journal một writer, runner detached qua trampoline, jobrun `KILL_ON_JOB_CLOSE`, cancel theo thời điểm, cursor thông báo, `runner_failed`.

Ràng buộc giữ nguyên:
- Không chạy backend thật.
- Không thêm dependency npm.
- Chỉ sửa trong `system-by-claude/`.

Nhãn bằng chứng giống 05: **[ĐKC]** đã đo trên máy dev (Windows 11 10.0.26200, Node v26.13.0); **[DKC-nb]** lấy từ notebook; **[SL]** suy luận; **[GĐ]** giả định.

---

## 0. Tóm tắt

| Điều kiện (06 §E.2) | Trạng thái | Test | Probe của bên phản biện chạy lại |
|---|---|---|---|
| F1 / M1 — pipe lease bị tiến trình khác quyền giữ | **Đạt** | `r31.test.mjs` F1 ×2 | J4: `runner_failed`/`lease_permission` sau **4 ms**, **0** relaunch |
| F2 / M2 / R1 — `wait(min_turn)` sau khi cancel bỏ followup | **Đạt** (làm cả hai cách) | F2 ×3 | J10 (`min_turn:2`): trả sau **4 ms**, kèm `min_turn_unreachable:true` và `cancel.dropped` |
| F3 / M3 — jobrun hỏng hoặc bị chặn | **Đạt** | F3 ×4 | J2-c: exe 0 byte được biên dịch lại, `exec_ok`; exe hỏng lúc chạy → `succeeded` + `jobrun_unavailable`, không có `attempt.failed` |
| F4 / M4 / R7 — `-c` chỉ cho mục có thật | **Đạt** | D3 viết lại (4 ca) | probe f4: 6/6 ca đúng (§4) |
| F5 / M8-a — `ensureJobrun` không ném, doctor không sập | **Đạt** | F5 ×2 | J8: `bin` là file → `exe:null`, doctor trả báo cáo; thiếu ComSpec → giống khi có ComSpec |
| M5, M6, M7, M8-b/c/d, M9, M10 | Đã làm | M5, M6, M7, M9 ×2, M10 | J5: idem 8.3/junction trùng; J6(a): **không** còn dương tính giả |

Kết quả test: **`npm test` 104/104 pass, chạy 3 lần liên tiếp** (54 / 51 / 58 giây) [ĐKC].
- Bản r3 có 87 test. Bản r3.1 thêm 17 test trong `test/r31.test.mjs` và viết lại test D3.
- Ba test cũ phải sửa theo hành vi mới:
  - E3/N3: các launch giả trải dài ≥15 s.
  - B13: xóa dấu launch vì giới hạn 5 s giờ tính theo store.
  - B14: dùng `turn_estimate`.

---

## 1. F1 (M1) — `lease_permission` thật sự xảy ra

**Nguyên nhân** [ĐKC: J4 chạy lại trước khi sửa]. Pipe đang bị giữ bởi tiến trình khác quyền (DACL chỉ có SYSTEM full và Everyone read):
- `listen` nhận `EADDRINUSE`, không phải `EACCES`. Nhánh `lease_permission` của r3 vì thế không bao giờ chạy.
- `connect` (probe) nhận `EPERM`, bị hiểu là "runner đã chết", dẫn tới relaunch vô hạn.

Notebook không có `src/win/pipe.c` của libuv [DKC-nb: "hoàn toàn không có tệp mã nguồn src/win/pipe.c"]. Vì vậy cách ánh xạ mã lỗi ở đây dựa trên **đo thực tế**, không dựa trên mã nguồn.

**Sửa:**
- `lease.mjs` có hàm `classifyPipeError(code)` trả `held | foreign | busy | dead` (06 §C.2):
  - `EPERM`/`EACCES` → `foreign`;
  - `probeLease` trả `{alive:'foreign', code}`.
- `runner.runTask`: nếu không lấy được lease, runner probe. Probe ra `foreign` thì runner **ném** `lease_permission` thay vì `{skipped:'lease_held'}` im lặng. `runner-main` ghi `runner.fatal.json` với message bắt đầu bằng `lease_permission`.
- `hub.status`: probe ra `foreign` thì hub **trả ngay** `status:'runner_failed'`, `error.class:'lease_permission'`, kèm gợi ý "đặt `ORCH_HOME` riêng cho mỗi mức quyền", và **không launch**.
  - `runnerFailure()` phân lớp `lease_permission` khi file fatal bắt đầu bằng chuỗi đó.
  - `wait` coi `runner_failed` là đã xong (giống r3).

**Kiểm:**
- Test `F1/J4` dựng pipe DACL hạn chế bằng PowerShell `NamedPipeServerStream`, rồi kiểm cả 3 tầng:
  - `acquireLease` trả `null`; `probeLease` trả `foreign`;
  - `runTask` reject với `lease_permission`;
  - `runner-main` thật exit khác 0, và hub thấy lớp `lease_permission`;
  - `hub.wait` trả `runner_failed` trong < 5 s; số launch = 1 (chỉ lần spawn).
- J4 chạy lại [ĐKC]:
  - `acquireLease → null`, `probeLease → {"alive":"foreign","code":"EPERM"}`;
  - `hub.wait → runner_failed` sau 4 ms; số launch = 0.

## 2. F2 (M2, dung hòa R1) — `cancel:{at,dropped}` và bỏ bẫy `min_turn`

Làm **cả hai** phương án mà bên phản biện cho phép:

1. **MCP bỏ `min_turn`.** `subagent_wait.inputSchema` chỉ còn `until_followup`. Handler vẫn nhận `min_turn` nếu client cũ gửi, nhưng không quảng bá.
   - `subagent_followup` không trả `turn` nữa, chỉ trả `turn_estimate`, để không ai đưa giá trị ước lượng đó vào `min_turn`.
   - Mô tả `subagent_cancel` nói rõ: "kill CẢ job backend… bỏ mọi followup gửi trước lệnh hủy… brief có `cancel.dropped`".
2. **`wait(min_turn)` không treo.** Task được coi là xong, kèm `min_turn_unreachable:true`, khi đủ các điều kiện:
   - task đã kết thúc và không còn followup chờ;
   - và có `cancel`, **hoặc** `status==='cancelled'` (task bị hủy giữa turn 1 mà không có followup nào);
   - và `turn < min_turn`.
3. **State và brief có `cancel: {at, dropped:[followup_id…]}`.** Trường này được đặt bởi `followup.dropped`, đã có `cancel_at` từ r3, và bị xóa (`null`) khi có `followup.accepted` mới. `status` không đổi (R1 được chấp nhận).

**Kiểm:**
- F2/J10: xong → followup → cancel.
  - `status.cancel.dropped = [followup_id]`.
  - `wait(min_turn:2)` trả sau < 2 s, kèm `min_turn_unreachable`.
  - CLI `orch wait --min-turn 2 --until-done` kết thúc ngay, không có `deadline_exceeded`.
  - Followup mới sau đó chạy turn 2 và `cancel` bị xóa.
- F2: hủy giữa turn 1 → `wait(min_turn:2)` cũng trả ngay.
- F2: `tools/list` không có `min_turn`.
- J10 chạy lại [ĐKC]:
  - Bản gốc dùng `min_turn: f.turn`. Vì `turn` đã bỏ, giá trị là `undefined`, và wait trả sau 3 ms.
  - Bản `j10b` dùng `min_turn:2`: trả sau 4 ms, brief có `"cancel":{"at":…,"dropped":["f…"]}` và `"min_turn_unreachable":true`.

## 3. F3 (M3) + F5 (M8) — jobrun tự kiểm, có đường lùi, không bao giờ ném

**Biên dịch và tự kiểm** (`jobrun.mjs`, gộp theo 06 §C.1):
- `ensureJobrun(root)` bọc `try/catch` toàn bộ, nên **không bao giờ ném lỗi** (F5).
- Nếu exe đã có, hàm khớp nó với `.ok` (`{size, mtimeMs}`); không khớp thì **chạy thật** `jobrun "<System32>\cmd.exe" /d /c exit 7`, theo đúng đường mà runner dùng (job, JOB_LIST, std handle), và mong đợi exit 7.
- Tự kiểm hỏng → xóa exe → biên dịch lại **một lần** → tự kiểm lại. Vẫn hỏng, hoặc biên dịch lỗi, thì ghi `.bad` `{at, reason}`, hiệu lực 24 giờ. Đây là negative cache trên đĩa cho M8-c. Hàm trả `{exe:null, exec_ok:false, error}`.
- PowerShell và cmd được gọi bằng đường dẫn tuyệt đối trong `%SystemRoot%\System32` (M8-b).
- `--jobinfo` dùng `Environment.SystemDirectory\cmd.exe`, không đọc `ComSpec` (M8-d).

**Đường lùi lúc chạy** (`runner.mjs` `runAttempt` → `runAttemptOnce`):
- Runner coi jobrun là hỏng trong hai trường hợp:
  - spawn jobrun lỗi `EFTYPE/EACCES/EPERM/UNKNOWN/EINVAL`, hoặc `ENOENT` khi exe không còn hay chỉ còn 0 byte. `ENOENT` do `cwd` sai **không** tính;
  - jobrun exit 120–123 và stderr bắt đầu bằng `[jobrun]`. Exit 126/127 là lỗi CreateProcess của **backend**, không phải của jobrun.
- Khi jobrun hỏng, runner làm lần lượt:
  - `markJobrunBad(exe)`;
  - ghi sự kiện `jobrun.unavailable{exe, reason}`;
  - chạy lại **chính attempt đó** không qua jobrun, không tính vào `max_attempts`;
  - thêm `warnings:['jobrun_unavailable']` vào envelope.
- `runner-main`: nếu `ensureJobrun` đã trả `null` trên Windows và người dùng không tự tắt (`ORCH_JOBRUN≠0`), envelope cũng có `jobrun_unavailable`.
- doctor:
  - `checks.jobrun = {ok, exec_ok, error?, effect}`, trong đó `effect` giải thích hậu quả: tiến trình nền có thể sống sót sau khi hủy;
  - `checks.codex_hub` (F4).

**Kiểm** [ĐKC]:
- F3 exe 0 byte trong cache → biên dịch lại, `exec_ok`, có `.ok` (≈0,7 s).
- F3/J2-c exe hỏng đưa thẳng vào runner → `succeeded`, có warning, `reason` là `spawn EFTYPE`, có `.bad`, 0 `attempt.failed`.
- F3 `.bad` còn hạn → `exe:null`; xóa `.bad` thì thử lại được.
- F3 `jobrunUnavailableReason` → warning.
- F5 `bin` là file → không ném; doctor trả báo cáo, `jobrun.exec_ok:false`.
- F5 thiếu ComSpec → `breakaway` giống khi có ComSpec (không còn `denied:87`).
- Probe chạy lại:
  - J2 (c1): exe 0 byte → 554 ms → `exec_ok`, 9216 byte. (c2): 96 ms → `succeeded`, `["jobrun_unavailable"]`, `.bad=true`.
  - J2 (a)(b) không đổi: `denied:5`; 12/12 biên dịch đồng thời, max 1236 ms, chỉ còn `exe` và `.ok`.
  - J8 (c3): doctor trả báo cáo. J8 (d): thiếu ComSpec cho kết quả giống hệt khi có.

Nhãn `(c)` trong `j2.mjs` gốc in cứng "DUNG file hong" mỗi khi `jr.exe` khác null. Ở r3.1, `jr.exe` là exe **đã được biên dịch lại**, không phải file hỏng; probe `j2c2.mjs` in thêm kích thước và `exec_ok`.

## 4. F4 (M4, R7) — `-c mcp_servers.X.enabled=false` chỉ cho mục có thật

**Nguồn** [DKC-nb]:
- Mỗi mục `mcp_servers` cần `command` (stdio) hoặc `url` (HTTP); thiếu cả hai thì lỗi nạp config. Notebook dẫn nguồn thứ cấp và thông báo lỗi tương tự (`missing field … Error loading config.toml`), **không** trích mã serde. Vì vậy nhãn của điểm này vẫn là [KC?], nhưng sửa rẻ.
- "Project-scoped config … Codex walks from the project root to the working directory… **Loaded only when the project is trusted**" (Configuration Reference).
- Tên server cho phép `A-Z a-z 0-9 - _ : @ / .`.

**Sửa** (`adapters/codex.mjs`):
- `codexConfigFiles(cwd, env)` trả các file:
  - `$CODEX_HOME/config.toml` (mặc định `~/.codex`);
  - `.codex/config.toml` của dự án, đi từ `cwd` lên tới thư mục có `.git` và không vượt quá home. Lớp dự án **chỉ** được tính khi config user có `[projects."<P>"] trust_level = "trusted"`, với P là `cwd` hoặc tổ tiên của nó (so sánh sau `realpath`).
- `parseMcpServers(text)` là bộ đọc TOML tối thiểu, không thêm dependency. Nó nhận ra ba dạng:
  - `[mcp_servers.X]` hoặc `[mcp_servers."X"]`, kể cả bảng con `.env`;
  - khóa chấm ở gốc, `mcp_servers.X.command = …`;
  - bảng inline `X = {…}` dưới `[mcp_servers]`.
- `codexHubEntries({cwd, env, hubNames})` chọn mục X **có thật** và thỏa một trong hai: tên nằm trong `ORCH_CODEX_HUB_NAMES` (mặc định `subagent-hub`), hoặc nội dung mục chứa `mcp-server.mjs` (người dùng đặt tên tùy ý).
  - Tên không phải bare key `[A-Za-z0-9_-]` thì bị bỏ vào `skipped`, vì không quote an toàn qua `-c` được [GĐ: cú pháp `-c` với khóa có dấu chấm]. Khi đó doctor báo `codex_hub.ok:false` kèm cách sửa (đổi tên mục).
- `buildInvocation` thêm `-c` chỉ cho các tên trên, áp dụng cho cả lần chạy mới và resume.
- Đọc sai theo hướng **thiếu** `-c` thì worker nạp hub. Lớp chặn đệ quy bằng tổ tiên tiến trình (r2) vẫn còn, nên hậu quả nhẹ hơn nhiều so với `codex exec` hỏng ngay từ đầu.

**Kiểm:**
- D3 viết lại, dùng `CODEX_HOME` tạm, không đọc config thật:
  - (a) không có config → 0 `-c`;
  - (b) mục `orch` trỏ `mcp-server.mjs` cùng một server HTTP khác → chỉ `-c mcp_servers.orch.enabled=false`, cho cả lần mới và resume;
  - (c) khóa chấm `subagent-hub`, mục `"hub x"` và `.codex/` của dự án:
    - dự án chưa trusted → chỉ `subagent-hub`;
    - dự án trusted → thêm `localhub`;
    - `"hub x"` → `skipped`;
  - (d) `ORCH_CODEX_HUB_NAMES` có tên không tồn tại → không tạo mục.
- probe `probes/r3/f4.mjs` [ĐKC]:
  1. không config → `[]`;
  2. chỉ có server khác → `[]`;
  3. `hubNames=subagent-hub` nhưng mục không có → `[]`;
  4. có `subagent-hub` và `my-orch` → 2 `-c`;
  5. thêm `.codex/` của dự án chưa trusted → vẫn 2 `-c`;
  6. dự án trusted → 3 `-c`.
- Kiểm cuối cùng phải làm trên máy thật: E.3 Claude Code #1 (§7).

## 5. Các mức nhẹ

- **M5.**
  - Chặn launch **theo store**: `_launch` bỏ qua nếu file `launch-*` mới nhất còn chưa tới 5 s; spawn và resume dùng `force`.
  - `runner_failed` do launch lặp cần ≥3 launch trong 60 s **và** launch cũ nhất ≥15 s.
  - Test M5: 3 launch trong 14 s, 2 hub poll 8 lần → không `runner_failed`, không thêm launch.
  - J6(a) chạy lại [ĐKC]: runner chậm 7 s với 1 hub và 2 hub, chậm 12 s với 1 hub → **không** còn `runner_failed`, cả ba kết thúc `succeeded`, với 2/3/3 launch.
- **M6.**
  - `normCwd` dùng `realpathSync.native`, có cache 500 mục. Đường dẫn chưa tồn tại được giải theo tổ tiên gần nhất còn tồn tại.
  - Lỗi này lộ ra nhờ test cũ E6 (inbox với `cwd` con chưa tồn tại) khi chạy toàn bộ suite.
  - Test M6: junction tạo bằng `mklink /J`, cùng tên 8.3 → cùng idem key.
  - J5 chạy lại: idem `true,false,false` (đúng), trần theo cwd đúng, inbox đúng.
- **M7.** `resultContract` thêm câu "mọi tiến trình nền bạn khởi động… sẽ bị dừng khi bạn kết thúc lượt này". README §r3.1 và mô tả `subagent_cancel` cũng ghi điều này. Có test M7.
- **M9 (R6).** jobrun thử `PROC_THREAD_ATTRIBUTE_JOB_LIST` (0x2000D, `EXTENDED_STARTUPINFO_PRESENT`) trước, nên không còn cửa sổ giữa SUSPENDED và Assign. Nếu lỗi (Windows cũ) thì lùi về cách r3.
  - `ORCH_JOBRUN_NO_JOBLIST=1` ép dùng đường lùi; `ORCH_JOBRUN_DEBUG=1` in đường đã dùng.
  - Test M9 ×2: cả hai đường đều đúng đường đã chọn, và cháu `start /b` chết khi cancel [ĐKC].
- **M10.** `flushProgress(true)` chạy **trước** `attempt.exited`. Test dùng scenario `progress_burst`. Phần GC (`orch gc`) để r4.

## 6. Thay đổi API / hành vi (cho người dùng)

- MCP `subagent_wait` mất `min_turn`; `subagent_followup` mất `turn` và thêm `turn_estimate`.
- Brief có `cancel`; `wait` có thể trả `min_turn_unreachable`.
- `runner_failed` có lớp mới `lease_permission`; `warnings` có giá trị mới `jobrun_unavailable`; journal có sự kiện mới `jobrun.unavailable`.
- doctor có `jobrun.exec_ok` và `codex_hub`.
- Env mới: `ORCH_JOBRUN_NO_JOBLIST`, `ORCH_JOBRUN_DEBUG`. Hub đọc thêm `CODEX_HOME`.
- Phiên bản: `0.3.1-r3.1`.

## 7. Danh sách kiểm tay cho người dùng (06 §E.3, đã cập nhật r3.1)

Bước chung cho mọi GUI: chạy `subagent_doctor` **trong chính GUI đó** (hoặc `node src/bin/orch.mjs doctor`), rồi ghi lại các mục `job_limits`, `jobrun` (phải có `exec_ok:true`), `codex_hub`, `env`, `commands`.

| GUI | # | Việc kiểm | Đạt khi |
|---|---|---|---|
| **Claude Code** | 1 | **(Kiểm M4/F4, việc số 1)** `subagent_spawn` một task `backend:"codex"` ngắn, chỉ đọc file. Nếu config Codex **không** có mục hub thì `doctor` báo `codex_hub.disabled_for_workers: []`, và `attempts/1/invocation.json` **không** có `-c mcp_servers…` | Task `succeeded`; không có `attempt.failed` lớp `config` của codex |
| | 1b | Thêm mục `[mcp_servers.subagent-hub]` vào `~/.codex/config.toml`, rồi spawn lại | `invocation.json` có `-c mcp_servers.subagent-hub.enabled=false`; `raw.jsonl` của worker không có `mcp_tool_call` tới hub |
| | 2 | Spawn task dài, đóng hẳn Claude Code, đợi 30 s, mở lại, gọi `subagent_status` | `runner_alive:true` hoặc task đã xong (R3) |
| | 3 | `Bash` chạy nền `orch wait <id> --until-done`, rồi `subagent_cancel` | Lệnh nền kết thúc và Claude tự mở lượt mới |
| | 4 | Hook `orch inbox --hook` | Chỉ thông báo của project hiện tại; không lặp khi gửi 2 prompt liên tiếp |
| **Codex Desktop** | 1 | Spawn task dài, kết thúc lượt hoặc đóng thread, đóng app; mở lại, gọi `subagent_status` | `runner_alive:true` hoặc đã xong; fail thì gửi `runner.log` (R3) |
| | 2 | Đặt tên mục hub khác `subagent-hub`, rồi chạy `doctor` | `codex_hub.disabled_for_workers` có đúng tên đó; worker Codex không thấy tool `subagent_*` |
| | 3 | Hai hook chạy song song | Không lặp thông báo |
| **Antigravity** | 1 | Spawn task dài, đóng Antigravity, mở lại, gọi `subagent_status` | Như trên (R3) |
| | 2 | Chạy một task `backend:"antigravity"` với `ORCH_CAPTURE_GOLDEN=<thư mục>` | `succeeded`, không có `unknown_events`; nếu có thì gửi `golden/antigravity-*.jsonl` (R4) |
| | 3 | Làm hỏng tạm `ORCH_HOME` (trỏ tới một file), rồi gửi prompt | Hook fail-closed **không** chặn lượt của người dùng |
| **Mọi GUI** | 1 | Nhờ subagent chạy `start /b ping -n 600 127.0.0.1`, rồi cancel | Không còn `ping.exe` (N5 với AV thật) |
| | 2 | Lần chạy đầu: kiểm `ORCH_HOME\bin\jobrun-*.exe`, `.ok` và không có `.bad`; envelope không có `jobrun_unavailable` | Nếu có `.bad`: đọc `reason`, có thể do AV/AppLocker; task vẫn chạy nhưng tiến trình nền có thể sống sót |
| | 3 | GUI "Run as administrator" chạy song song với GUI thường, **dùng chung** `ORCH_HOME` | Task bị kẹt báo `runner_failed`/`lease_permission` kèm gợi ý, **không** kẹt `queued`. Cách đúng là đặt `ORCH_HOME` riêng |
| | 4 | Nhờ subagent khởi động một dev server | Server dừng khi subagent xong (M7, đúng thiết kế) |

## 8. Điểm còn lại (không chặn chốt)

- **Cần kiểm tay** (§7): R3 (host GUI giết runner theo tiêu chí khác cây PID), R4/R5 (golden transcript của cả 3 backend), M4 trên Codex thật (cú pháp `-c` và mục thiếu `command`/`url` thực sự làm hỏng), và AV thật với jobrun.
- **F4 – các dạng chưa đọc:**
  - Bộ đọc TOML tối thiểu chưa đọc `projects = { "<P>" = { trust_level = … } }` (inline) và khóa chấm `projects."<P>".trust_level`. Gặp hai dạng này thì lớp dự án bị coi là chưa trusted, nên hậu quả là **thiếu** `-c`, và chặn đệ quy vẫn còn tầng tổ tiên.
  - `doctor` xét `codex_hub` theo `cwd` của chính nó, không theo `cwd` của từng task.
- **F3 – sau đường lùi:**
  - Khi chạy không qua jobrun, tiến trình nền của backend có thể sống sót sau cancel (như r2). Điều này luôn hiện thành warning, không im lặng.
  - Lần chạy lại attempt sau khi jobrun hỏng ghi thêm một `attempt.started` cho **cùng** số attempt.
- **M8-e** (Constrained Language Mode) chưa tái hiện được; nếu CLM chặn `Add-Type` thì đường `.bad` + chạy thẳng đã bao trường hợp này.
- **r4:** `orch gc --older-than 14d` (M10-b); thông điệp lỗi của trần toàn cục nên liệt kê project đang chiếm chỗ (R2).
