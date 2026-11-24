# 05 — Thiết kế vòng 3: trả lời `04-critique-r2.md` và mã `src/` 0.3.0-r3

> **r3.1:** các sửa F1–F5 (+ M5–M10) theo `06-critique-r3.md` nằm ở `07-design-r3.1.md`; mã hiện hành là 0.3.1-r3.1. Một số mô tả dưới đây đã bị thay thế, ví dụ D3 luôn thêm `-c` và `min_turn` trong MCP.

Phạm vi và ràng buộc của vòng này:

- Chỉ sửa trong `system-by-claude/`.
- Không chạy backend thật (`claude`, `codex`, `agy` đều không chạy, kể cả `--version`).
- Không thêm dependency npm. Thành phần ngoài Node duy nhất là `jobrun.exe`. Nó được biên dịch tại chỗ bằng PowerShell 5.1 `Add-Type -OutputAssembly … -OutputType ConsoleApplication`, tức csc của .NET Framework có sẵn trên Windows 10/11. Chỗ đo nằm ở §4.1.

Nhãn bằng chứng:

| Nhãn | Nghĩa |
|---|---|
| **[ĐKC]** | đã kiểm chứng bằng phép chạy trên máy dev (Windows 11 10.0.26200, Node v26.13.0) |
| **[DKC-nb]** | trích từ notebook NotebookLM `61848f50…` (nguồn chính thức hoặc issue) |
| **[SL]** | suy luận |
| **[GĐ]** | giả định chưa kiểm được |

---

## 0. Tóm tắt

- **Bảy lỗi bắt buộc N1–N7 đã sửa.** Mỗi lỗi có test tương ứng trong `src/test/r3.test.mjs`.
- **Mười điều kiện E1–E10 đạt, trừ một điểm phản bác ở E1.** Kịch bản Q3-A (task **đã xong** → followup → cancel) kết thúc ở `succeeded` của **turn 1**, có `followup.dropped`, và không có attempt mới. Tôi không đổi nó thành `cancelled`; lý do ở §1.1.
- **D3 đóng bằng nguồn.** Khóa `mcp_servers.<id>.enabled=false` có nguồn từ notebook. Worker Codex luôn nhận `-c mcp_servers.subagent-hub.enabled=false`.
- **D1 đóng bằng nguồn và fixture.** Fixture JSON-RPC viết theo spec 2026-07-28 (Tasks).
- **D4 đóng bằng `jobrun.exe`.** Đo được: cháu chết trong cả 3 đường (cancel, runner bị kill cứng, backend thoát).
- **Phát hiện mới D4b.** Codex Desktop dọn tiến trình bằng `taskkill /pid <pid> /t /f`, không dùng Job Object (openai/codex #34260) [DKC-nb]. Đo trên máy cho thấy runner r2, vốn là con trực tiếp của MCP server, **chết 2/2 lần** khi host chạy `taskkill /T` lên server.
  - Sửa: thêm tầng đệm `bin/runner-trampoline.mjs`. Đo lại: runner **sống 2/2**.
  - Có test, và có đối chứng âm: chạy với `ORCH_LAUNCH_DIRECT=1` thì test fail.
- **Test: 87/87 pass, chạy 3 lần liên tiếp**, mỗi lần 45–50 giây. Bản r2 có 56 test. Bản này thêm 31 test mới, và sửa 5 chỗ trong test cũ do API chuyển sang async.

---

## 1. Bảng phản hồi

Ký hiệu ở cột "Kết quả": ✅ đã sửa và có test; ⚖ phản bác hoặc thay đổi phương án, có lý do; ⏳ còn mở, kèm điều kiện đóng.

### 1.1 N1–N14

| # | Kết quả | Thay đổi | Bằng chứng |
|---|---|---|---|
| **N1** cancel bỏ sót followup | ✅ / ⚖ (Q3-A) | **Cancel theo thời điểm.** `consumeCancel()` chọn các `followup-*.json` có `at ≤ cancel.at`, append `followup.dropped{ids,count,reason}`, chuyển file sang `control/dropped/`, rồi `clearCancel`.<br>Được gọi ở cả `finish()` (task đang chạy) lẫn nhánh janitor khi task đã TERMINAL.<br>Followup gửi **sau** cancel là việc mới, nên vẫn chạy.<br>`hub.cancel` trên task đã xong trả `note` "turn N đã …; hủy sẽ bỏ k followup đang chờ". | Test `E1/N1 Q3-A`, `Q3-B`, `followup gửi SAU cancel` [ĐKC] |
| **N2** cursor mất/lặp | ✅ | Trả **cũ nhất trước**; cursor chỉ tiến tới phần tử đã xử lý.<br>`cursor = {last, seen}` với lookback 30 s.<br>Khóa theo consumer bằng pipe `cursor-<consumer>`: chờ ≤ 300 ms, không lấy được thì trả `[]`, nên hook không bao giờ treo.<br>File đọc không được thì dừng lại, không nhảy qua.<br>`readNotifications` thành **async**. | Q4 tái chạy (§4.3): (a) 10 + 5, (b) A không mất, (c) 900/900 × 3 vòng, (d) tổng 200, lặp 0 [ĐKC] |
| **N3** runner không khởi động được | ✅ | Đúng theo đề xuất C1 của phản biện:<br>• hub ghi `control/launch-<ts>-<r>.json`;<br>• runner-main ghi `runner.started.json` ngay dòng đầu (sau import), và ghi `runner.fatal.json` cho mọi lỗi trước vòng lặp, cũng như cho uncaught/unhandled;<br>• hub suy ra `runner_failed` khi có fatal, hoặc khi ≥ 3 lần launch trong 60 s mà chưa có `started` (lần cũ nhất cách ≥ 3 s), và trả về `error.message`, `log_tail`, `hint`;<br>• hub ngừng tự chữa; `resume` xóa dấu lỗi;<br>• `orch wait --until-done` có `--deadline` (mặc định 2 h) và cờ `deadline_exceeded`.<br>`runner_failed` **không** nằm trong journal, để giữ nguyên tắc một writer. | Q9: `runner_failed` sau 277 ms với 1 lần launch (probe); test `E3/N3 Q9` ≤ 20 s, có `log_tail`, `resume` chạy lại được; test 3-launch; test `--deadline` [ĐKC] |
| **N4** kill nhầm pid | ✅ | Append `attempt.exited{code,pid,killed_for}` ngay sau `close`.<br>Tiếp quản chỉ kill khi attempt cuối **chưa** exited.<br>Dung sai `creation_time` giảm 10 s → **1 s**.<br>Không khớp thì không kill, chỉ ghi lý do. | Test Q8-b: pid khớp **tuyệt đối** nhưng đã exited → không kill; test `attempt.exited` [3,0] [ĐKC] |
| **N5** cháu sống sót | ✅ | `jobrun.exe` (§2.3). | Test Q10 (cancel), test runner bị kill cứng; số đo ở §4.1 [ĐKC] |
| **N6** store chung va chạm | ✅ / ⚖ (mặc định) | Idem `sha256(normCwd(cwd)+'\0'+key)`.<br>Thêm `ORCH_MAX_ACTIVE_PER_CWD`, **mặc định 4** chứ không bằng trần toàn cục; lý do ở §5.<br>`orch inbox` lọc theo `cwdWithin(task.cwd, cwd của phiên)`, với `cwd` lấy từ stdin hook → `--cwd` → `process.cwd()`; `--all` để xem hết.<br>Consumer mặc định là `default@<sha12(cwd)>`. | Test Q5 và test `inbox --hook` [ĐKC] |
| **N7** EACCES = "đang giữ" | ✅ | `listenErrorAction`: EADDRINUSE → `held`; EACCES → ném lỗi `lease_permission`, runner-main ghi fatal, kết quả là `runner_failed`. | Test N7 [ĐKC] |
| **N8** nhánh `.ps1` | ✅ | `.ps1` **không bao giờ** đi qua `powershell -File`:<br>• shim npm `.ps1` → đọc target và chạy `node <entry>`;<br>• có `.exe`/`.cmd` cùng tên → dùng file đó;<br>• còn lại → ENOENT kèm lý do. | Q6: sai 0/10; test N8 [ĐKC] |
| **N9** `isStrictable` | ✅ | `NON_STRICTABLE_KEYS` = `oneOf allOf not if then else $ref $defs definitions patternProperties prefixItems dependentSchemas unevaluatedProperties`; `items` là mảng thì trả false. `anyOf` (union null) vẫn được giữ. | Q7, test N9 [ĐKC] |
| **N10** race followup/snapshot | ✅ | (1) Followup có `followup_id`; thứ tự là peek → append `followup.accepted{ids,prompts}` → ack (xóa). Khi khởi động, bỏ qua các id đã nằm trong journal.<br>(2) `followup` trả `followup_id`; `wait(until_followup)`; `turn` chỉ là ước lượng (`turn_is_estimate:true`).<br>(3) Snapshot có `journal_bytes`; `state()` chỉ tin snapshot khi kích thước khớp; constructor `Journal` ghi lại snapshot. | 3 test E8 [ĐKC] |
| **N11** fallback `~/.local/state` | ✅ | Trên win32: `LOCALAPPDATA` → `USERPROFILE\AppData\Local`. `doctor.env` liệt kê biến thiếu (`LOCALAPPDATA PATH SystemRoot USERPROFILE PATHEXT ComSpec`), kèm gợi ý `ORCH_HOME`. | Test E9/N11 [ĐKC] |
| **N12** doctor đo job host | ✅ | `job_limits`: chạy `jobrun --jobinfo <file>` **detached** rồi đọc `{in_job, limit_flags, breakaway}`.<br>Verdict `jobVerdict`:<br>• có `0x2000` (KILL_ON_JOB_CLOSE) → `ok:false`;<br>• không có → `ok:true`, kèm cảnh báo rủi ro `TerminateJobObject` chủ động.<br>Thêm check `jobrun` (biên dịch/cache). | Trong phiên Claude Code: `{in_job:true, limit_flags:0, breakaway:'denied:5'}` [ĐKC], khớp phép đo của phản biện |
| **N13** CIM đồng bộ | ✅ | `processAncestryAsync`, `powershellAsync`; `hub.callerDepth` thành async. | Đọc mã; test cũ B9 vẫn pass |
| **N14** degraded | ✅ (chính sách) | Có `output_schema` mà hợp đồng hỏng sau repair → `failed`, `error.class='bad_output'`, `format='degraded'`, giữ text thô trong `summary`.<br>Không có schema → `succeeded` + `warnings:['unverified_format']`.<br>Lý do: không có schema thì caller chỉ cần văn bản, và text thô vẫn có giá trị. Lượt bị **từ chối** có schema nên rơi vào `failed`. | Test E10/N14 [ĐKC] |

**Phản bác ở E1 (Q3-A).**

- Ở Q3-A, `task.completed:succeeded` của turn 1 đã nằm trong journal **trước** khi có cancel. Journal là append-only, và kết quả đó là thật.
- Đổi trạng thái cuối thành `cancelled` sẽ làm hai việc sai:
  1. xóa mất một kết quả hợp lệ đối với caller, trong khi `wait` lấy kết quả theo trạng thái cuối;
  2. trái với ngữ nghĩa "cancel hủy **yêu cầu** có `at ≤ cancel.at`" mà chính phản biện đề xuất ở C4. Yêu cầu đã hoàn tất thì không còn gì để hủy.
- Điều E1 thực sự bảo vệ là "không chạy thêm". Điều này đạt đủ:
  - `turn` không tăng;
  - chỉ có 1 `attempt.started`;
  - có `followup.dropped`;
  - `wait(until_followup=<id>)` trả `followup.dropped:true`;
  - `cancel` trả `note` nói rõ turn đã xong.
- Q3-B (task đang chạy) cho `cancelled`, đúng như E1 yêu cầu.

### 1.2 B6, B10, B13, B23 (các điểm "chưa đạt" ở B.0)

| # | Trạng thái r3 | Ghi chú |
|---|---|---|
| B6 | Đạt | Qua N2 |
| B10 | Đạt | Qua N4 (`attempt.exited`, 1 s, không kill khi không khớp) và N5 (job). Với jobrun, cancel và hang chỉ còn `TerminateProcess(jobrun)`; OS đóng handle và KILL_ON_JOB_CLOSE giết cả cây, không qua `taskkill /T`. Không có jobrun thì vẫn dùng `taskkill /T`, nay có timeout 10 s (§2.3) |
| B13 | Đạt | Qua N3 |
| B23 | Đạt | Qua N6 và N11 |

### 1.3 D1–D7

| # | Kết quả | Nội dung |
|---|---|---|
| **D1** Tasks | ✅ đóng | [DKC-nb] Spec 2026-07-28: Tasks là "server-directed".<br>• Client opt-in qua `_meta["io.modelcontextprotocol/clientCapabilities"].extensions["io.modelcontextprotocol/tasks"]`; cờ `params._meta.task.required` đã bỏ.<br>• Server không hỗ trợ thì trả `CallToolResult` thường, và "MUST NOT return CreateTaskResult" cho client chưa khai báo. Nếu tool bắt buộc task thì trả -32021.<br>• Chưa client nào trong Claude Code, Codex hay agy gửi Tasks. Codex có cờ `mcp_2026_07_28` nhưng chưa bật Tasks.<br>Fixture `D1`: `tools/call` không qua `initialize`, có `_meta` 2026-07-28 kèm capability tasks → -32602 với `data.supported`; `server/discover` → -32601; client cũ (không `_meta`) vẫn nhận kết quả đồng bộ, **không** có `resultType`.<br>Ghi chú R-tasks: Tasks không giải quyết việc đánh thức phiên đang idle (đồng ý với phản biện). |
| **D2** cancel = kill cứng | ✅ | `killed_mid_write`: task `access=write` bị cancel mà `git status --porcelain` trước và sau khác nhau → thêm cảnh báo. Tài liệu ghi: **cancel và hang là kill cứng**; với jobrun là kill cả job. Turn đang chạy bị mất (Claude trả 143), file dở dang có thể còn lại. Test D2 (repo git tạm). |
| **D3** tắt hub trong worker Codex | ✅ đóng | [DKC-nb] Configuration Reference: `mcp_servers.<id>.enabled` (boolean) — "Disable an MCP server without removing its configuration". `codex exec` chấp nhận `-c` override.<br>Lý do bắt buộc: Codex `env_clear()` rồi chỉ nạp `DEFAULT_ENV_VARS` (HOME, PATH, USER, …) cho MCP stdio. Vì vậy `ORCH_DEPTH` **không** tới được hub chạy trong worker, và lớp env của B9 vô hiệu với Codex.<br>Adapter luôn thêm `-c mcp_servers.<name>.enabled=false` cho mỗi tên trong `ORCH_CODEX_HUB_NAMES` (mặc định `subagent-hub`; chỉ nhận ký tự `[A-Za-z0-9_-]`), cả khi chạy mới lẫn khi resume. Lớp tổ tiên tiến trình (B9) và MAX_ACTIVE vẫn giữ làm lớp thứ hai. Test D3. |
| **D4** job theo attempt | ✅ | `jobrun.exe` (§2.3); thêm **D4b** (trampoline, §2.4). |
| **D5** | ✅ | = N6 |
| **D6** | ✅ | `slot.waiting{since}` ghi một lần khi chờ slot quá `slotWaitNoticeMs` (mặc định 30 s). Test D6. |
| **D7** golden | ✅ (biện pháp tối thiểu) / ⏳ (golden thật) | **Canary.** Mỗi adapter có `knownTypes`. Dòng JSON có `type` lạ được đếm, ghi `parser.unknown_events{count,types}` và `warnings:['unknown_events:n']`. Exit 0, không nhận được final và có dòng lạ → `bad_output` với `parser_unrecognized: …` (retry/repair như `bad_output`), thay vì `no_output` mơ hồ.<br>**Thu golden.** `ORCH_CAPTURE_GOLDEN=1` chép `raw.jsonl` mỗi attempt vào `<ORCH_HOME>/golden/<backend>-<ts>.jsonl`. Tôi chép ra store chứ không chép vào `test/fixtures/golden/…` như C6, vì hub không được ghi vào cây mã nguồn khi đang chạy; người dùng tự chép vào fixture.<br>`knownTypes` của agy (`step_update`, `result`) là [GĐ].<br>Test D7 (`format_changed`, `unknown_extra`). |

### 1.4 E1–E10

| # | Đạt? | Test (`src/test/r3.test.mjs`) |
|---|---|---|
| E1 | Đạt, trừ phản bác Q3-A ở §1.1 | `E1/N1 Q3-A`, `E1/N1 Q3-B`, `N1: followup gửi SAU cancel` |
| E2 | Đạt | `E2/N2 (a)`, `(b)`, `(c)+(d) đa tiến trình, 3 lần` |
| E3 | Đạt | `E3/N3 Q9`, `E3/N3 ≥3 launch`, `E3/N7`, `E3 --deadline` |
| E4 | Đạt (dung sai 1 s **và** `attempt.exited`) | `E4/N4 Q8b`, `E4/N4 attempt.exited` |
| E5 | Đạt (jobrun khả thi) | `E5/N5 jobrun giữ dòng lệnh`, `E5/N5 Q10`, `E5/N5 runner-main bị kill cứng` |
| E6 | Đạt | `E6/N6 Q5`, `E6/N6 inbox --hook` |
| E7 | Đạt | `E7/N8`, `E7/N9` |
| E8 | Đạt | 3 test `E8/N10` |
| E9 | Đạt | `E9/N11`, `E9/N12` |
| E10 | Đạt | `E10/N14`, `D2` cùng mục §2.6 |

---

## 2. Kiến trúc r3

Những phần không nhắc tới ở đây giữ nguyên như `03-design-r2.md`: lease bằng named pipe, một writer journal, envelope `subagent-result/v1`, bảng lỗi và adapter.

### 2.1 Cây tiến trình

```
GUI host (Claude Code | Codex Desktop | agy)
 └─ MCP server: node bin/mcp-server.mjs        (hub: chỉ ghi task.json + control/)
     └─ node bin/runner-trampoline.mjs          (thoát ngay sau khi spawn)        ← D4b
         ┄┄ (cha đã chết: cây ParentProcessId bị đứt)
node bin/runner-main.mjs  (detached; giữ lease task-<id>; writer duy nhất của journal)
 └─ jobrun-<hash12>.exe   (Job Object KILL_ON_JOB_CLOSE, không breakaway; theo dõi PID runner)   ← N5
     └─ backend (claude | codex | agy) ── tool ── cháu (`start /b`, dev server, …)  : mọi tiến trình ở lại trong job
```

### 2.2 Bố cục store (thêm ở r3)

```
<root>/tasks/<id>/control/followup-<fid>.json   followup có id; chỉ xóa sau khi journal có followup.accepted{ids}
<root>/tasks/<id>/control/dropped/              followup bị cancel bỏ (giữ lại làm dấu vết)
<root>/tasks/<id>/control/launch-<ts>-<r>.json  hub ghi mỗi lần launch; runner-main xóa khi khởi động
<root>/tasks/<id>/runner.started.json           runner-main ghi ngay khi khởi động
<root>/tasks/<id>/runner.fatal.json             lỗi khởi động / uncaught / lease_permission
<root>/cursors/<consumer>.json                  {last, seen[] trong 30 s}
<root>/bin/jobrun-<hash12>.exe                  cache theo hash của nguồn C#
<root>/golden/<backend>-<ts>.jsonl              chỉ khi ORCH_CAPTURE_GOLDEN=1
state.json: thêm journal_bytes; idem/<sha(cwd+key)>.json
```

Sự kiện journal mới:

- `attempt.exited{code,pid,killed_for}`
- `followup.accepted{count,ids,prompts}`
- `followup.dropped{ids,count,reason}`
- `slot.waiting{since}`
- `parser.unknown_events{count,types}`

Trạng thái suy ra (không nằm trong journal): `runner_failed`.

### 2.3 `jobrun.exe` (N5/D4)

**Nguồn và biên dịch.**

- Nguồn C# khoảng 90 dòng, nằm trong `lib/jobrun.mjs` (`JOBRUN_CS`).
- `ensureJobrun(root)` biên dịch bằng `powershell -NoProfile Add-Type -TypeDefinition … -OutputAssembly <tmp> -OutputType ConsoleApplication`, rồi `rename` sang `bin/jobrun-<hash12>.exe`. Có cache trong tiến trình.
- `ORCH_JOBRUN=0` tắt jobrun. Không phải win32 thì trả `null`.

**Trình tự trong `Main`:**

1. `CreateJobObject`, rồi `SetInformationJobObject(ExtendedLimitInformation)` với `LimitFlags = 0x2000` (KILL_ON_JOB_CLOSE). **Không** có 0x800 (BREAKAWAY_OK) hay 0x1000 (SILENT_BREAKAWAY_OK).
2. Dòng lệnh backend = phần đuôi của `GetCommandLineW()` sau argv0. Runner spawn jobrun với `windowsVerbatimArguments:true` và argv0 đã quote, nên phần đuôi đúng **từng byte** như libuv sẽ tạo. Đối số được quote bằng `quoteArg`, port từ `quote_cmd_arg` của libuv. jobrun không quote lại.
3. `CreateProcessW(…, CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT, STARTF_USESTDHANDLES)` với ba std handle kế thừa từ jobrun, nên pipe của runner chạy xuyên qua.
4. `AssignProcessToJobObject`, rồi `ResumeThread`.
5. Chờ backend, đồng thời theo dõi `ORCH_JOBRUN_PARENT` (PID runner). Cha chết thì `TerminateJobObject` và thoát 137.
6. Backend thoát thì jobrun thoát với **nguyên** exit code. Handle job đóng, nên cháu còn sót cũng bị giết.

**Kill.**

- Runner gọi `child.kill()`, tức `TerminateProcess(jobrun)`. Handle job đóng, và OS giết cả job, kể cả cháu đã mất liên kết ParentProcessId.
- Không có jobrun (`ORCH_JOBRUN=0`, hoặc biên dịch thất bại) thì quay về `taskkill /T /F` như r2, nay có `timeout:10s`. #34260 cho thấy `taskkill /T` có thể treo khi WMI quá tải [DKC-nb].

**Đối chiếu với nguồn Job Object mới (17 nguồn) [DKC-nb].**

| Điểm thiết kế | Nguồn | Kết luận |
|---|---|---|
| Backend được gán vào job mới trong khi bản thân đã nằm trong job của host (không cho breakaway) | MS Learn *Job Objects*: "A process can be associated with more than one job in a hierarchy of nested jobs" (từ Windows 8 / Server 2012) | Hợp lệ. Đo được: `AssignProcessToJobObject` thành công trong ngữ cảnh Claude Code [ĐKC] |
| Cháu tạo qua `cmd /c start /b` từ một tiến trình nằm trong job libuv (0x3C00, có SILENT_BREAKAWAY) | MS Learn: con breakaway khỏi job trực tiếp "and from each job in the parent job chain … until it reaches a job that does not permit breakaway" | Cháu thoát khỏi job libuv nhưng **dừng lại ở job jobrun** vì job này không cho breakaway. Đây đúng là lý do r2 rò rỉ (job libuv cho breakaway, mà runner không có job riêng), và cũng là lý do r3 giữ được cháu [ĐKC: Q10 với jobrun, cháu chết] |
| Đóng handle cuối cùng chỉ giết tiến trình khi có KILL_ON_JOB_CLOSE | MS Learn *CreateJobObject*: "if the job has the JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE flag specified, closing the last job object handle terminates all associated processes" | Đúng cho cả hai chiều: (a) jobrun chết thì cả cây chết; (b) job của host với `limit_flags:0` không giết runner khi GUI đóng handle |
| Cửa sổ race giữa `CREATE_SUSPENDED` và `AssignProcessToJobObject` | MS Learn: `PROC_THREAD_ATTRIBUTE_JOB_LIST` (Win10+) gán job ngay lúc tạo | Nếu jobrun chết **đúng** giữa hai lệnh, backend còn ở trạng thái suspended và không chạy (vô hại, nhưng rò rỉ một tiến trình treo). Cải tiến ghi nhận, chưa làm: chuyển sang `JOB_LIST`. Rủi ro thấp [SL] |

### 2.4 D4b — host GUI có kill runner không? (mới)

| Host | Cơ chế dọn | Ảnh hưởng tới runner r2 | r3 |
|---|---|---|---|
| **Claude Code** | Tiến trình detached nằm trong job host với `LimitFlags=0`; breakaway bị từ chối (lỗi 5) [ĐKC qua `doctor.job_limits`] | Đóng GUI **không** giết runner. `TerminateJobObject` chủ động thì chưa kiểm được | Như r2; `doctor` hiển thị verdict |
| **Codex Desktop** | `execFile(taskkill.exe, ["/pid", pid, "/t", "/f"])` trong `app.asar`, không dùng Job Object; có thêm "detached-process candidate scan" [DKC-nb: openai/codex #34260] | Runner là con trực tiếp của MCP server. `taskkill /T` lên server **giết runner 2/2** [ĐKC: `scratchpad/r3/tk.mjs`] | Qua trampoline thì runner **sống 2/2** [ĐKC]. Test `D4b` có đối chứng âm (`ORCH_LAUNCH_DIRECT=1` → fail) |
| **Host có KILL_ON_JOB_CLOSE** (RStudio/Electron, CI; issue Bun #31603, Deno #11487) | libuv không truyền `CREATE_BREAKAWAY_FROM_JOB` cho `detached:true`, nên con detached vẫn ở trong job và bị giết khi host thoát [DKC-nb] | Runner chết khi GUI đóng | `doctor.job_limits` báo `ok:false` (có 0x2000). Phương án dự phòng (chưa làm): launch qua WMI `Win32_Process.Create`. r2 đã đo được rằng tiến trình tạo theo cách này có cha là `WmiPrvSE`, không nằm trong job host |

Về "detached-process candidate scan" của Codex Desktop, nguồn không nói phạm vi quét [DKC-nb]. Nếu bộ quét nhận diện runner bằng tiêu chí khác cây PID, ví dụ dòng lệnh hoặc thời điểm, trampoline không đủ. Điều kiện đóng ở §5.

Giới hạn của trampoline: nếu PID của trampoline đã chết được tái sử dụng cho một tiến trình trong cây host, `taskkill /T` có thể lại đi tới runner. Xác suất rất thấp [SL].

### 2.5 Hub và giao diện

- **`subagent_followup`** trả `{followup_id, turn (ước lượng), turn_is_estimate:true, hint}`. **`subagent_wait`** nhận `until_followup`. Nếu followup đã bị bỏ, kết quả có `followup:{dropped:true}`.
- **`subagent_cancel`** chỉ hủy followup có `at ≤ cancel.at`. Task đã xong thì trả `note`.
- **`status`/`wait`** có thể trả `runner_failed` (coi như "xong với lỗi"). Khi đó hub không launch nữa cho tới khi gọi `resume`.
- **Trần tải:** `ORCH_MAX_ACTIVE` (toàn cục, 8) và `ORCH_MAX_ACTIVE_PER_CWD` (4).
- **Thông báo:** `notifications()` là async. Mỗi brief có `cwd`.
- **CLI:**
  - `orch wait --until-done --deadline <ms>`;
  - `--until-followup <id>`;
  - `orch inbox --hook [--cwd <dir>] [--all]`.
- **Worker Codex:** luôn có `-c mcp_servers.<name>.enabled=false`.

### 2.6 Chính sách (E10)

- **Cancel và hang là kill cứng.** Với jobrun, cả job bị giết. Turn đang chạy bị mất. Task `access=write` có thể để lại file dở dang; khi `git status` trước và sau khác nhau, envelope có `warnings:['killed_mid_write']`.
- **`degraded`** áp dụng khi hợp đồng kết quả hỏng sau một lần repair:
  - có `output_schema` → `failed` / `bad_output`, `format:'degraded'`, kèm text thô;
  - không có → `succeeded`, `format:'degraded'`, `warnings:['unverified_format']`.
- **Cảnh báo canary:** `unknown_events:n`. Không có final mà có dòng lạ thì là `bad_output`, `parser_unrecognized`.

---

## 3. Mã đã thay đổi (`src/`, phiên bản 0.3.0-r3)

| File | Thay đổi chính |
|---|---|
| `lib/jobrun.mjs` **(mới)** | `JOBRUN_CS`, `JOBRUN_HASH`, `quoteArg`, `ensureJobrun`, `detachedJobInfo`, `wrapWithJobrun` |
| `bin/runner-trampoline.mjs` **(mới)** | D4b |
| `bin/runner-main.mjs` (viết lại) | `markRunnerStarted`; `fatal()`/`die()` ghi `runner.fatal.json`; `ensureJobrun`, rồi `jobrunExe` |
| `lib/store.mjs` | `defaultRoot` win32; idem theo cwd; `journal_bytes`; `followup_id`, peek/ack/drop; sổ launch/started/fatal; cursor `{last,seen}` kèm khóa pipe (async); `applyEvent` cho các sự kiện mới |
| `lib/runner.mjs` | `consumeCancel`; `attempt.exited`; tiếp quản chỉ khi chưa exited, dung sai 1 s; `followup.accepted` trước khi ack; `fullPrompt` giữ mọi followup; `slot.waiting`; `finishDegraded` theo schema; canary; `captureGolden`; `killed_mid_write`; kill qua jobrun |
| `lib/hub.mjs` | `runnerFailure`/`runner_failed`; `recordLaunch`; trần theo cwd; `until_followup`; `note` của cancel; `detachedLauncher` qua trampoline; ancestry async |
| `lib/lease.mjs` | `listenErrorAction` (EACCES → `lease_permission`) |
| `lib/proc.mjs` | `.ps1` → shim npm / `.cmd` / `.exe` / ENOENT; `parseNpmPs1Shim`; bọc jobrun trong `spawnInvocation`; `powershellAsync`, `processAncestryAsync`; `taskkill` có timeout |
| `lib/schema.mjs` | `NON_STRICTABLE_KEYS`, tuple → false |
| `lib/doctor.mjs` | `job_limits` (detached jobinfo), `jobrun`, `env`; export `jobVerdict`, `envCheck` |
| `lib/adapters/*.mjs` | `knownTypes`; codex: `hubServerNames`, `-c mcp_servers.<n>.enabled=false` |
| `bin/orch.mjs` | `--until-followup`, `--deadline`, inbox `--cwd`/`--all`/consumer theo cwd |
| `bin/mcp-server.mjs` | 0.3.0-r3; `until_followup`; ghi chú Tasks 2026-07-28 |
| `test/r3.test.mjs` **(mới, 31 test)**; `test/fixtures/notify-helper.mjs` **(mới)**; `fake-backend.mjs` (thêm `grandchild`, `write_then_hang`, `format_changed`, `unknown_extra`) | |
| `test/core.test.mjs`, `test/runner.test.mjs` | `await` cho API thông báo async; `maxActivePerCwd` cho test 50 task |
| `README.md`, `package.json` | biến môi trường mới, trạng thái mới, version |

---

## 4. Số đo [ĐKC]

Máy đo: Windows 11 Home 10.0.26200, Node v26.13.0, PowerShell 5.1. Script probe nằm trong scratchpad của phiên (`…/scratchpad/r3/`, `…/scratchpad/probes/r3/`), không nằm trong repo.

### 4.1 jobrun

| Phép đo | Kết quả |
|---|---|
| Biên dịch `Add-Type -OutputType ConsoleApplication` | 738–951 ms lần đầu; lấy từ cache 0 ms |
| Đối số `['a b','q"x','tail\\','x\\"y','','{"a":"b c"}','%PATH%','a&b|c']` | Tới backend nguyên vẹn; stdin, stdout, stderr đúng; exit code 7 được giữ (test E5) |
| Cháu `cmd /c start "" /b node` (jr2, 3 kịch bản) | A: kill jobrun → cháu chết; B: runner bị SIGKILL → jobrun thấy cha chết, cháu chết; C: backend thoát bình thường → cháu chết |
| `--jobinfo` chạy detached trong phiên Claude Code | `{in_job:true, limit_flags:0, breakaway:'denied:5'}` |
| Test Q10 (cancel) / test runner bị `taskkill /F` không `/T` | Cháu chết / backend và cháu chết, cả 3 lần chạy suite |

### 4.2 D4b (taskkill /T của host)

| Cách launch | runner sống sau `taskkill /PID <mcp> /T /F` |
|---|---|
| Trực tiếp (r2) | 0/2 (chạy 2 lần) |
| Qua trampoline (r3) | 2/2 |

### 4.3 Chạy lại Q1–Q10 trên r3

| Mã | r2 (phản biện, tôi xác nhận lại) | r3 |
|---|---|---|
| Q1 | OK | OK |
| Q2 | 0 vòng lỗi | 0 vòng lỗi |
| Q3 | A và B: turn 2 chạy, kết quả `succeeded` | A: `succeeded` turn 1, 1 attempt, có `followup.dropped` (phản bác §1.1); B: `cancelled` turn 1, 1 attempt, có `followup.dropped` |
| Q4 | (a) mất 5; (b) mất; (c) mất 4/900; (d) lặp 200 | (a) 10 + 5, mất 0; (b) không mất; (c) 900/900, mất 0, lặp 0, ×3; (d) tổng 200, lặp 0 |
| Q5 | idem trùng giữa project; MAX_ACTIVE chặn chéo | idem tách; trần theo cwd 4 (MAX_ACTIVE toàn cục vẫn có, §5) |
| Q6 | `.ps1` sai 5/10 | sai 0/10 |
| Q7 | `oneOf`, `allOf`, `$defs` vẫn bị coi là strictable | Không strictable → tắt schema native |
| Q8 | (b) victim bị kill; ancestry ~981 ms đồng bộ | (a) lệch +5..+9 ms; (b) không kill; ancestry async |
| Q9 | 4 lần launch, `queued`, không có lỗi | `runner_failed` sau 277 ms, 1 lần launch |
| Q10 | cháu sống | cháu chết (qua jobrun; test E5) |

### 4.4 Toàn bộ test

`cd src && npm test`, chạy 3 lần liên tiếp sau thay đổi cuối cùng:

| Lần | Kết quả | Thời gian |
|---|---|---|
| 1 | 87/87 pass | 50 s |
| 2 | 87/87 pass | 47 s |
| 3 | 87/87 pass | 45 s |

Không test nào chạy backend thật. Những test chỉ có trên Windows (jobrun, `.ps1`, D4b, `job_limits`) được skip trên nền tảng khác.

---

## 5. Bất đồng còn lại và điều kiện đóng

| # | Điểm | Lập trường của tôi | Điều kiện đóng |
|---|---|---|---|
| R1 | **Q3-A ra `succeeded` thay vì `cancelled`** (E1) | Kết quả turn 1 là thật và đã có trước cancel. Cancel chỉ hủy yêu cầu chưa thực hiện | Phản biện nêu một kịch bản cụ thể mà caller bị hại vì thấy `succeeded` của turn 1, khi đã có `followup.dropped` và `note`. Nếu có kịch bản như vậy, tôi sẽ thêm trường `cancel:{at, dropped}` vào brief của `status`/`wait` thay vì đổi `status` |
| R2 | **MAX_ACTIVE toàn cục vẫn chặn chéo; trần theo cwd mặc định 4 thay vì bằng 8** | Trần toàn cục bảo vệ tài nguyên dùng chung (CPU/RAM, quota tài khoản backend), vốn không chia theo project. Nếu trần theo cwd bằng trần toàn cục thì kịch bản Q5 vẫn y nguyên, vì một project lấy hết 8 chỗ. Đặt 4 thì hai project chạy song song được | Phản biện đưa số liệu hoặc kịch bản cho thấy nên có default khác. Cả hai giá trị đều chỉnh được bằng biến môi trường |
| R3 | **Host chủ động `TerminateJobObject`, hoặc "detached-process candidate scan" của Codex Desktop** | Không đo được từ bên trong và không có nguồn nói rõ. `doctor` chỉ đo được KILL_ON_JOB_CLOSE | Kiểm tay trên từng GUI: spawn task `very_slow` → đóng GUI (hoặc kết thúc lượt, với Codex Desktop) → mở lại → `subagent_status` phải cho thấy `runner_alive:true` hoặc task đã xong. Nếu fail: bật phương án launch qua WMI (§2.4) |
| R4 | **`knownTypes` và fixture của agy** | [GĐ]: chưa có dòng stream nguyên văn | Notebook trích được ví dụ nguyên văn `step_update`/`result` của `agy`, hoặc người dùng thu golden bằng `ORCH_CAPTURE_GOLDEN=1` |
| R5 | **Fixture adapter là doc-derived** | Không chạy được backend (ràng buộc) | Có golden transcript thật (C6) |
| R6 | **Cửa sổ race `CREATE_SUSPENDED` → `Assign`** | Rủi ro thấp: tiến trình còn treo ở trạng thái suspended, không chạy | Chuyển sang `PROC_THREAD_ATTRIBUTE_JOB_LIST` nếu phản biện coi là cần; nguồn Microsoft Learn đã có trong notebook |
| R7 | **Tên mục MCP trong config Codex khác `subagent-hub`** | Người dùng phải khai `ORCH_CODEX_HUB_NAMES`; nếu sai tên thì chỉ còn lớp tổ tiên + MAX_ACTIVE | `doctor` đọc `~/.codex/config.toml` để gợi ý tên. Có thể làm ở r4, chỉ đọc, không cần chạy codex |

---

## 6. Notebook (chỉ dùng `chat_start`; không `research_*`)

| Chủ đề | Kết quả | Dùng ở |
|---|---|---|
| Codex: khóa tắt MCP, env của MCP stdio, timeout, `item.completed`, hook | `mcp_servers.<id>.enabled`; `env_clear` + `DEFAULT_ENV_VARS`; `startup_timeout_sec`=10, `tool_timeout_sec`=60; `item.completed` có status `completed`/`failed`; hook chạy đồng thời, cwd của hook là cwd phiên, stdin có `session_id`; lượt bị từ chối exit 0 và phát `turn.failed`/`error` | D3, N2-d, N6, N14 |
| MCP 2026-07-28 Tasks | Server-directed, opt-in qua `clientCapabilities.extensions`, "MUST NOT return CreateTaskResult" cho client chưa khai báo, -32021; chưa client nào dùng | D1 |
| Job Object (Microsoft Learn) | Nested jobs từ Win8; SILENT_BREAKAWAY đi lên chuỗi job tới job không cho breakaway; đóng handle chỉ giết tiến trình khi có KILL_ON_JOB_CLOSE | D4, N5, N12 |
| Bun #31603 / Deno #11487 / openai/codex #34260 | libuv không truyền `CREATE_BREAKAWAY_FROM_JOB`; Codex Desktop dùng `taskkill /T /F`, không Job Object, không timeout; WMI quá tải gây cleanup storm | D4b, timeout của `taskkill`, kill qua jobrun |

Yêu cầu notebook cho vòng sau (người điều phối quyết định):

1. Dòng stream **nguyên văn** của `agy` headless: `step_update` cho tool, sự kiện kết thúc (R4).
2. Codex Desktop: phạm vi của "detached-process candidate scan", và việc `taskkill /T` có áp dụng cho tiến trình MCP server khi đóng app không (R3).
3. Claude Code: `control_request` interrupt trong `--input-format stream-json`, để có cancel mềm thay cho D2.
