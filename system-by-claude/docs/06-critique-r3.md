# 06 — Phản biện vòng 3 cho `05-design-r3.md` và mã `src/` (0.3.0-r3)

> Người viết: phản biện viên. Phạm vi: chỉ `system-by-claude/` (tài liệu 05 và `src/`). Tôi không chạy backend thật nào (không `claude`, `codex`, `agy`, kể cả `--version`). Mọi phép thử dùng backend giả `fake` của chính bộ mã, hoặc `node`/`cmd` thuần.
> Nhãn dùng trong tài liệu này:
> - **[ĐKC: nguồn]** là đã kiểm chứng, kèm nguồn. Nguồn là phép thử tôi tự chạy (Q1…Q10 tái chạy, J1…J10 mới, xem mục D) hoặc notebook.
> - **[SL]** là suy luận từ việc đọc mã.
> - **[KC?]** là không chắc.
>
> Mức độ giữ như các vòng trước: **chặn**, **nghiêm trọng**, **vừa**, **nhẹ**.
> Các lỗi mới do r3 đưa vào (hoặc sửa chưa tới) được đánh số **M1…M10**. Các mục N của vòng 2 được đối chiếu ở B.0.
> Script phép thử: `scratchpad/probes/r3/` của phiên phản biện (q1–q10 tái chạy, j1–j10 mới). Mỗi script tự tạo `ORCH_HOME` tạm, phần lớn dưới đường dẫn **dài có dấu cách** `C:\Users\Firstname Lastname\AppData\Local\Temp\…`.

---

## Tóm tắt điều hành

r3 làm được phần khó nhất và tôi đã tự xác nhận lại, không dựa vào báo cáo của bên thiết kế.

- **`npm test`: 87/87 pass, 3 lần** (56,8 s; 44,1 s; 44,0 s).
- **`jobrun.exe` đúng như mô tả.**
  - Biên dịch được trong `ORCH_HOME` có dấu cách, `&`, `()` và tiếng Việt có dấu: `…\orch r3 thư mục & (x) …` (470 ms).
  - 12 tiến trình cùng biên dịch lần đầu: 12/12 ra exe, không sót file tạm (J2-b).
  - Trung thực đầu vào/đầu ra: argv 12 ca khó (ngoặc kép, `\` cuối, `%PATH%`, `^&|<>()`, Unicode, emoji, tab, chuỗi rỗng), cwd Unicode, env Unicode, stdin 4 MB, stderr Unicode, exit code 0/3/255/1234567. Kết quả giống hệt spawn trực tiếp, kể cả khi đi qua `.cmd` (J1-B).
  - **Cháu chết** trong cả 3 đường: cancel (103 ms), backend tự thoát (116 ms), runner bị `taskkill /F` không `/T` (416 ms).
  - Đối chứng không jobrun: cháu **sống** ở cả hai đường (J1-C).
  - Đầu-cuối qua runner thật: cancel và kill cứng runner đều không để lại cháu; hub tự chữa sau 3,2 s (J7).
- **Trampoline có hiệu lực thật.** "MCP server" giả bị host `taskkill /PID … /T /F`:
  - mặc định (trampoline): runner **sống 3/3**, task vẫn chạy tiếp;
  - `ORCH_LAUNCH_DIRECT=1`: runner **chết 3/3** (J3).
- **Đã sửa và tôi xác nhận:** N1 (Q3), N2 (Q4: 0 mất, 0 lặp), N3 (Q9: `runner_failed` sau 282 ms), N4 (J6-b), N5, N6 phần idem, N8, N9 (Q7), N10, N11, N13, N14.

Bốn điểm chưa ổn. Cả bốn đều tái hiện được bằng phép thử, nhưng **không** điểm nào ở mức chặn:

1. **M1 — N7 chưa thật sự được sửa** [vừa]. Trên Windows, libuv đổi `ERROR_ACCESS_DENIED` khi bind pipe thành `EADDRINUSE`, nên nhánh `EACCES` mới không bao giờ chạy.
   - Mô phỏng pipe do tiến trình khác quyền giữ: `acquireLease` trả `null`, `probeLease` trả `{alive:false, code:'EPERM'}`.
   - Hub relaunch mỗi 5 s, mỗi runner ghi `lease_held` rồi thoát. Task kẹt ở `queued`, **không** có `runner_failed` (J4).
2. **M2 — R1 có một kịch bản hại cụ thể** [vừa]. Trạng thái `succeeded` thì đúng, vấn đề nằm ở `wait`.
   - Chuỗi: task xong → followup (trả `turn:2`) → cancel. Sau đó `wait(min_turn:2)` **không bao giờ xong** (J10).
   - Brief của `wait`/`status` không có trường nào cho biết followup đã bị bỏ.
   - Với `orch wait --until-done --min-turn 2`, lệnh nền treo tới deadline 2 giờ.
3. **M3 — jobrun không tự kiểm và không có đường lùi** [vừa]. File `jobrun-<hash>.exe` hỏng hoặc bị chặn chạy (AV, AppLocker, ASR) là đủ.
   - `ensureJobrun` chỉ kiểm `existsSync`.
   - Mọi task fail `crash: spawn EFTYPE` sau 3 attempt, và lặp lại cho tới khi người dùng tự xóa file (J2-c).
4. **M4 — Cờ Codex `-c mcp_servers.subagent-hub.enabled=false` luôn được thêm** [KC?, có thể chặn cho Codex-làm-worker]. Nếu config Codex **không có** mục `subagent-hub`, ví dụ khi orchestrator là Claude Code, thì cờ này có thể tạo một server thiếu `command`/`url`. Hệ quả là `codex exec` có thể từ chối khởi động.
   - Notebook xác nhận khóa và `-c`, nhưng không nói gì về trường hợp mục không tồn tại.
   - Tôi không chạy được codex để kiểm. Đây là mục kiểm tay số 1 cho người dùng.

Về R1–R7:
- **R1:** chấp nhận lập luận về `status`, kèm dung hòa để sửa M2.
- **R2, R4, R5, R6, R7:** chấp nhận. R7 có kèm điều kiện, gộp với M4.
- **R3:** chấp nhận chuyển sang kiểm tay.

**Kết luận: tôi đồng ý chốt kiến trúc và phần lõi (lease, journal, runner, jobrun, trampoline).** Điều kiện là sửa M1–M3 và xử lý M4 như ở E.2. Tất cả đều là sửa cục bộ, không đổi kiến trúc. Sau đó người dùng làm danh sách kiểm tay ở E.3 trên từng GUI.

---

## A. Điểm đã thống nhất (đóng, không mở lại)

1. **Kiến trúc** như các vòng trước: MCP facade, runner detached, store trên đĩa, journal append-only, một writer giữ lease bằng named pipe, phân loại lỗi, resume phiên. Không daemon, không SQLite, không dependency npm.
2. **jobrun = Job Object riêng `KILL_ON_JOB_CLOSE`, không breakaway, `CREATE_SUSPENDED` → Assign → Resume.**
   - Biên dịch tại chỗ bằng `Add-Type` và cache theo hash nguồn. Rename nguyên tử nên an toàn khi nhiều tiến trình cùng biên dịch [ĐKC: J2-b].
   - Cancel dùng `child.kill()` lên jobrun thay vì `taskkill /T`. Cách này đúng và nhanh hơn (≈100 ms so với ≈4,6 s của `taskkill /T` trong đối chứng) [ĐKC: J1-C].
3. **Trampoline** (`runner-trampoline.mjs`) làm launcher mặc định. Đường đối chứng `ORCH_LAUNCH_DIRECT=1` được giữ lại [ĐKC: J3].
4. **Ngữ nghĩa cancel theo thời điểm** (N1):
   - followup có `at ≤ cancel.at` thì bị bỏ, kể cả khi trùng mili-giây;
   - followup gửi sau cancel là việc mới [ĐKC: J6-c, J6-c2].
   - `wait(until_followup)` trả `followup:{dropped:true}` cho followup bị bỏ [ĐKC: J6-d].
5. **Cursor thông báo** `{last, seen}` cộng khóa theo consumer [ĐKC: Q4 (a)–(d)].
6. **N3:** `runner.started`/`runner.fatal`/`launch-*` và `runner_failed` suy ra ở hub, không ghi journal; `--until-done` có deadline [ĐKC: Q9].
7. **N4:** `attempt.exited`, và không kill khi attempt cuối đã thoát, kể cả khi pid khớp tuyệt đối thời điểm tạo [ĐKC: J6-b, Q8-b].
8. **N8, N9, N10, N11, N13, N14** như mô tả ở 05 [ĐKC: Q6, Q7, Q3-D, đọc mã].
9. **Chính sách degraded (N14)** và **"cancel = kill cứng" (D2)** đã ghi vào tài liệu.
10. **D1, D2, D6** (hoãn SDK/Tasks, hoãn interrupt mềm, không FIFO slot) giữ như vòng 2.

---

## B. Đối chiếu "đã sửa" và lỗi mới

### B.0 — Bảng đối chiếu N1–N14 (tôi tự chạy lại)

| # | Bên thiết kế nói | Tôi kiểm | Kết luận |
|---|---|---|---|
| N1 | ✅ / ⚖ Q3-A | Q3-A: `succeeded` turn 1, có `followup.dropped`, 1 attempt. Q3-B: `cancelled`, followup bị bỏ. J6-c: followup sau cancel vẫn chạy (turn 2) | **Đạt.** Ngữ nghĩa chấp nhận (R1); còn M2 ở `wait` |
| N2 | ✅ | Q4: (a) 10 + 5, mất 0; (b) A không mất; (c) 900/900, lặp 0; (d) 200, lặp 0 | **Đạt** |
| N3 | ✅ | Q9: `runner_failed` sau 282 ms, 1 launch, có `log_tail`. J6-a: có **dương tính giả** khi runner khởi động chậm và có ≥ 2 tiến trình hub cùng poll (M5) | **Đạt**, kèm M5 (nhẹ) |
| N4 | ✅ | Q8-b: không kill (lệch 4 s). J6-b: pid khớp **tuyệt đối** nhưng có `attempt.exited` → không kill | **Đạt** |
| N5 | ✅ | J1-C, J7: cháu chết ở cả 3 đường; đối chứng không jobrun thì cháu sống | **Đạt**, kèm M3 (đường lùi) |
| N6 | ✅ / ⚖ | Q5: idem tách theo project. J5: **8.3/junction** làm hỏng idem, trần theo cwd và lọc inbox (M6). Trần toàn cục vẫn chặn chéo (R2, chấp nhận) | **Đạt một phần** (M6, nhẹ) |
| N7 | ✅ | J4: pipe do tiến trình khác quyền giữ → `null` + `EPERM` → relaunch vô hạn, task kẹt `queued` | **Chưa đạt** (M1) |
| N8 | ✅ | Q6: `.ps1` có `.cmd` cùng tên → đi qua `.cmd`, sai 0/10 | **Đạt** |
| N9 | ✅ | Q7: `oneOf`/`allOf`/`$defs`/tuple/free object → không strictable; `anyOf` null vẫn OK | **Đạt** |
| N10 | ✅ | Q3-D: 2 followup liên tiếp → turn 2, `wait` xong. Đọc mã: peek → accepted → ack; `journal_bytes` | **Đạt** |
| N11 | ✅ | Đọc mã `defaultRoot`, `envCheck` | **Đạt** |
| N12 | ✅ | `--jobinfo` chạy được; thiếu `ComSpec` thì báo sai `denied:87` (M8) | **Đạt**, kèm M8 (nhẹ) |
| N13 | ✅ | Đọc mã. `processAncestryAsync` ≈ 670 ms nhưng không chặn event loop | **Đạt** |
| N14 | ✅ | Đọc mã `finishDegraded` | **Đạt** |

### M1 — [vừa] N7 chưa được sửa thật: `EACCES` không bao giờ xuất hiện khi bind pipe; probe nhận `EPERM` và coi như runner đã chết

**Bằng chứng [ĐKC: J4].**
- Dựng mô phỏng bằng PowerShell: một `NamedPipeServerStream` cùng tên lease, DACL chỉ cấp FullControl cho SYSTEM và Read cho Everyone. Đây là dạng gần với DACL mặc định của pipe do tiến trình **elevated** tạo; đó là [SL], tôi không chạy elevated được. Kết quả:

```
acquireLease -> null (coi la held)
probeLease   -> {"alive":false,"code":"EPERM"}
hub.wait 16s -> timed_out=true status=queued | so lan launch runner=3
runner.log: ... {"skipped":"lease_held"} | ... {"skipped":"lease_held"} | ... {"skipped":"lease_held"}
```

- Nguyên nhân [SL, đọc libuv]: `uv_pipe_bind` trên Windows ánh xạ `ERROR_ACCESS_DENIED` thành `EADDRINUSE`, để phân biệt pipe đã có instance. Vì vậy `listenErrorAction` chỉ thấy `EADDRINUSE` và trả `held`. Nhánh `lease_permission` mới không bao giờ chạy trong kịch bản N7. Test N7 trong `r3.test.mjs` chỉ gọi `listenErrorAction({code:'EACCES'})` trực tiếp, nên không bắt được điều này.
- Ở phía probe: `net.connect` bị từ chối quyền và trả `EPERM`. `probeLease` không liệt `EPERM` vào nhóm `unresponsive`, nên trả `alive:false` và hub coi là stale.

**Hậu quả.** Đây đúng là hậu quả N7 gốc: relaunch mỗi 5 s cho mỗi tiến trình hub đang poll, task kẹt `queued`, không `runner_failed`, và `--until-done` chạy tới deadline.
- Kịch bản thực tế: cùng một user, một GUI chạy "Run as administrator" và một GUI thường, dùng chung `ORCH_HOME`.
- Xác suất thấp, nhưng khi xảy ra thì không tự thoát được.

**Sửa.**
1. `probeLease`: `EPERM`/`EACCES` → `{alive:'foreign', code}`, không coi là stale. `status` trả `runner_failed` với `error.class='lease_permission'` và hint "pipe do tiến trình khác quyền giữ (elevated?)".
2. Runner: khi `acquireLease` trả `null`, probe ngay một lần; nếu `EPERM`/`EACCES` thì ghi `runner.fatal.json{lease_permission}`.
3. Test thật: dựng pipe có DACL hạn chế như J4 (PowerShell 5.1 có sẵn `PipeSecurity`), không gọi `listenErrorAction` trực tiếp.

### M2 — [vừa] (R1) Sau "followup rồi cancel", `wait(min_turn)` không bao giờ xong và brief không cho biết followup đã bị bỏ

**Bằng chứng [ĐKC: J10].**

```
followup tra turn=2; cancel -> cancel_requested note="turn 1 da succeeded; huy se bo 1 followup dang cho (followup.dropped)"
wait(min_turn=2) -> timed_out=true sau 4200ms; brief={... "status":"succeeded","turn":1, ... "pending_followups":0 ...}
```

- `subagent_wait` vẫn công khai `min_turn` trong inputSchema.
- `subagent_followup` vẫn trả `turn` (ước lượng) cạnh `followup_id`.
- Một orchestrator đọc `turn:2` rồi gọi `wait(min_turn:2)` sẽ không bao giờ nhận kết quả. Lý do: `done()` cần `turn ≥ 2`, nhưng turn 2 không bao giờ tồn tại.
- `brief()` bỏ trường `followups`, nên caller không có tín hiệu nào. Chỉ `note` của lời gọi `cancel` có nói điều này, và note thì dễ trôi khỏi context.

**Hậu quả.**
- `orch wait --until-done --min-turn 2` (kênh đánh thức Claude Code) treo tới deadline 2 h.
- Orchestrator dùng MCP thì lặp `wait` vô ích.
- Đây chính là "kịch bản caller bị hại" mà điều kiện đóng R1 yêu cầu.

**Sửa (dung hòa, giữ `status` như bên thiết kế muốn):**
1. Brief của `status`/`wait`/`list` có `cancel:{at, dropped:[followup_id…]}` khi lần cancel gần nhất bỏ followup. Đây là đề xuất của chính bên thiết kế ở §5-R1.
2. `wait`: điều kiện `min_turn` được coi là thỏa khi task đã TERMINAL, không còn followup chờ, và có `followup.dropped` sau `task.completed` cuối. Trả kèm `min_turn_unreachable:true`.
3. Hoặc gọn hơn: bỏ `min_turn` khỏi inputSchema MCP và chỉ giữ `until_followup`. Nếu giữ `turn` ước lượng thì nó vẫn là bẫy.

### M3 — [vừa] jobrun chỉ được kiểm bằng `existsSync`; exe hỏng hoặc bị chặn thì mọi task fail và không lùi về spawn trực tiếp

**Bằng chứng [ĐKC: J2-c].** Đặt sẵn `bin/jobrun-<hash>.exe` 0 byte, mô phỏng file bị AV cắt hoặc ghi dở:

```
ensureJobrun -> DUNG file hong; task -> failed sau 4355ms,
attempt.failed=["crash:spawn EFTYPE","crash:spawn EFTYPE","crash:spawn EFTYPE"]
```

- [SL] Cùng chuỗi hậu quả xảy ra khi exe **chạy không được** dù nguyên vẹn:
  - AppLocker hoặc WDAC chỉ cho chạy exe trong `%ProgramFiles%`/`%WINDIR%`; `%LOCALAPPDATA%` bị chặn theo rule mặc định;
  - Defender ASR "block executable files unless they meet a prevalence/age criterion";
  - AV cách ly exe sau khi rename.
- Riêng trường hợp bị cách ly thì spawn trả `ENOENT`, bị phân loại thành `config`, nên task park với thông điệp sai.
- jobrun dùng exit code 120–127 cho lỗi nội bộ: `CreateJobObject`, `AssignProcessToJobObject` (vd job host có UI limit chặn nested job [KC?]), `CreateProcess`. Runner coi các mã này là exit code của backend, ra `crash`, rồi retry vô ích.

**Hậu quả.** Đây là đường chính: **mọi** backend trên máy đó đều hỏng. Không có tự phục hồi; người dùng phải tự tìm và xóa `ORCH_HOME\bin\jobrun-*.exe`. Trên máy công ty thì xác suất không thấp. Trên máy cá nhân Windows 11 Home như máy dev thì thấp.

**Sửa.**
1. `ensureJobrun` tự kiểm ngay sau khi biên dịch, và cả khi gặp file cache lần đầu trong tiến trình: chạy `jobrun "%ComSpec%" /d /c exit 7` và chờ exit 7. Ghi kết quả vào `bin/jobrun-<hash>.ok` hoặc `.bad`. File `.bad` có TTL (vd 24 h).
2. Trong `runAttempt`: spawn jobrun lỗi (`EFTYPE`/`EACCES`/`EPERM`/`UNKNOWN`/`ENOENT`), hoặc exit 120–123 kèm stderr bắt đầu bằng `[jobrun]`, thì đánh dấu `.bad` và **chạy lại attempt đó trực tiếp không jobrun**. Lần này không tính vào `max_attempts`, và ghi `warnings:['jobrun_unavailable']`.
3. `doctor.jobrun`: báo cả `exec_ok` (kết quả tự kiểm), không chỉ "biên dịch được".

### M4 — [KC?, có thể chặn cho Codex-làm-worker] `-c mcp_servers.subagent-hub.enabled=false` được thêm vô điều kiện

**Bằng chứng.**
- [ĐKC: notebook, Configuration Reference] Khóa `mcp_servers.<id>.enabled` (boolean, "Disable an MCP server without removing its configuration") có tồn tại. `-c` của `codex exec` nhận dotted path và có độ ưu tiên cao nhất.
- [KC?] Câu hỏi riêng về trường hợp **mục không tồn tại** thì notebook không trả lời.
- [SL] `-c` được merge vào cây TOML trước khi deserialize. Nếu `[mcp_servers.subagent-hub]` không có trong config, override tạo ra một bảng chỉ có `enabled=false`. Bảng này thiếu `command` và `url`. Nếu bước kiểm transport bắt buộc một trong hai thì `codex exec` lỗi config **trước khi suy luận**, ở mọi lần chạy.

**Hậu quả nếu đúng.**
- Cấu hình "orchestrator = Claude Code hoặc Antigravity, worker = Codex" là cấu hình phổ biến nhất. Trong cấu hình này, config Codex thường **không** có `subagent-hub`, nên mọi task Codex fail ngay.
- Ngược lại (R7): tên mục khác `subagent-hub` thì cờ vô hiệu, và lớp chống đệ quy chỉ còn tổ tiên tiến trình cùng MAX_ACTIVE.

**Sửa (gộp với R7, chỉ đọc file, không chạy codex):**
1. Adapter hoặc `doctor` đọc `$CODEX_HOME/config.toml` (mặc định `~/.codex/config.toml`) và `.codex/config.toml` từ cwd lên gốc.
2. Lấy các mục `[mcp_servers.X]` mà `command`/`args` trỏ tới `mcp-server.mjs` của hub, hoặc có tên trong `ORCH_CODEX_HUB_NAMES`.
3. **Chỉ** thêm `-c mcp_servers.X.enabled=false` cho các X **thực sự có**.
4. Đọc lỗi thì không thêm cờ (an toàn hơn so với nguy cơ làm hỏng mọi lần chạy), và ghi cảnh báo vào doctor.
5. Không cần parser TOML đầy đủ: regex `^\s*\[mcp_servers\.("?)([A-Za-z0-9_-]+)\1\]` là đủ để biết mục nào tồn tại.

### M5 — [nhẹ] `runner_failed` dương tính giả: chặn tự chữa theo từng tiến trình, nên N tiến trình poll cho N lần launch mỗi 5 s

**Bằng chứng [ĐKC: J6-a].** Launcher cố ý làm runner khởi động chậm:

| Khởi động chậm | Số hub poll | `runner_failed` lúc | Kết cục |
|---|---|---|---|
| 7 s | 1 | không | succeeded |
| 7 s | 2 | **5,2 s** | runner_failed → running → succeeded |
| 12 s | 1 | **10,3 s** | runner_failed → succeeded |

- Thời gian khởi động bình thường đo được (J6-e): spawn → `runner.started` là 107–255 ms; lần đầu kèm biên dịch jobrun là 795 ms. Vì vậy dương tính giả chỉ xảy ra khi máy rất tải hoặc AV quét lần đầu.
- `wait` coi `runner_failed` là xong. Orchestrator nhận "lỗi" trong khi task vẫn chạy và thành công.
- `_lastLaunch` nằm trong bộ nhớ của từng hub. MCP server, `orch wait --until-done` và `orch status` là các tiến trình khác nhau, nên mỗi tiến trình tự launch.

**Sửa.**
- Chặn theo store: không launch nếu có `control/launch-*` trẻ hơn 5 s. Cách này giảm luôn bão launch ở M1.
- Nới điều kiện: ≥ 3 launch **và** launch cũ nhất ≥ 15 s.

### M6 — [nhẹ] `normCwd` không chuẩn hóa tên 8.3 và junction

**Bằng chứng [ĐKC: J5].** Cùng một thư mục viết theo 3 dạng: dài, 8.3 `C:\Users\USERNA~1\…`, junction.

```
normCwd khac nhau: 3 (1 = dung)
(a) idem k1: dai created=true | 8.3 created=true | junction created=true   (dung: true,false,false)
(b) tran theo cwd=2 (da co 3 task): them duoc 3/4 task moi cho CUNG thu muc
(c) inbox: thong bao cwd=dai, phien cwd=8.3 -> cwdWithin=false; junction -> false
```

**Hậu quả.**
- Trên chính máy dev, `%TEMP%` có dạng 8.3 (`USERNA~1`). Đường dẫn model chép từ output công cụ có thể ở dạng này.
- Idem không chặn được chạy trùng. Trần theo cwd bị vượt. Thông báo của task lọt khỏi inbox của đúng phiên, nên orchestrator không được đánh thức.

**Sửa.** `normCwd`: nếu đường dẫn tồn tại thì dùng `fs.realpathSync.native(p)`, vốn giải cả 8.3 lẫn junction, rồi `toLowerCase()`. Không tồn tại thì giữ `path.resolve`. Áp dụng cho idem, trần theo cwd, `cwdWithin` và consumer mặc định.

### M7 — [nhẹ, thay đổi hành vi cần ghi tài liệu] Job của jobrun cấm breakaway và giết mọi tiến trình nền khi backend thoát

- [ĐKC: J2-a; notebook: Microsoft Q&A "CREATE_BREAKAWAY_FROM_JOB failed with ERROR_ACCESS_DENIED (5) because breakaway is not enabled"] Tiến trình chạy dưới jobrun tự đo được `{"in_job":true,"limit_flags":8192,"breakaway":"denied:5"}`. Công cụ nào của backend gọi `CreateProcess(CREATE_BREAKAWAY_FROM_JOB)` sẽ nhận `ERROR_ACCESS_DENIED`.
  - Dưới host GUI vốn đã có `breakaway:'denied:5'` (N12), nên đây không phải thay đổi.
  - Đây là thay đổi khi runner không nằm trong job nào, ví dụ chạy `orch` từ terminal [SL].
- [ĐKC: J1-C "backend tự thoát"] `KILL_ON_JOB_CLOSE` giết **mọi** hậu duệ khi backend thoát, kể cả tiến trình nền mà subagent cố ý để lại, như dev server hay watcher.
  - Đó là mục tiêu của N5, nhưng là thay đổi ngữ nghĩa mà người dùng cần biết.
  - Ví dụ: nhờ subagent "khởi động dev server" thì server chết khi subagent xong.

**Sửa.** Ghi vào tài liệu và vào `resultContract` ("tiến trình nền bạn khởi động sẽ bị dừng khi bạn kết thúc"). Không cần đổi mã.

### M8 — [nhẹ] Các đường lỗi nhỏ của `ensureJobrun` và `--jobinfo`

[ĐKC: J8]
- (a) `ensureJobrun` **ném lỗi** khi lỗi fs (mkdir hoặc ghi `.cs`; mô phỏng bằng `<root>/bin` là file). Hai hệ quả:
  - Runner ghi fatal và task ra `runner_failed`, thay vì chạy tiếp không jobrun.
  - `doctor` **ném lỗi toàn bộ**, không trả báo cáo nào.
  - Sửa: bọc `try/catch` và trả `{exe:null, error}`.
- (b) `powershell.exe` được tìm qua `PATH`. Nếu PATH rút gọn thì kết quả là ENOENT và đi đường lùi đúng. Tuy vậy nên dùng đường dẫn tuyệt đối `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`, giống `doctor`/`proc` hiện cũng dùng PATH.
- (c) Biên dịch lỗi chỉ cache **trong tiến trình**. Mỗi lần launch runner lại thử biên dịch: mất ≈ 0,5–1 s, tối đa 60 s nếu PowerShell treo. Cần negative cache trên đĩa có TTL (gộp với M3-1).
- (d) `--jobinfo` thiếu `ComSpec` thì báo `breakaway:"denied:87"`, trông như "host cấm breakaway". Nên dùng `%SystemRoot%\System32\cmd.exe`, hoặc chính `jobrun.exe --noop`.
- (e) Không tái hiện được Constrained Language Mode bằng `__PSLockdownPolicy=4`: Add-Type vẫn chạy được, nên kết quả không kết luận [KC?]. Dù sao M3 cũng bao trường hợp này.

### M9 — [nhẹ] R6 thực chất là rò tiến trình treo chứ không phải lỗ breakaway

[SL]
- Nếu jobrun bị giết đúng trong khoảng giữa `CreateProcess(SUSPENDED)` và `AssignProcessToJobObject`, backend đang suspended đã silent-breakaway khỏi job libuv vào job host. Nó **không** bị giết, và giữ handle stdio mãi.
- Cửa sổ cỡ micro-giây, nên tôi chấp nhận R6 (xem E.1). `PROC_THREAD_ATTRIBUTE_JOB_LIST` (Win10 1607+) đóng hẳn cửa sổ này, nên làm khi tiện.

### M10 — [nhẹ] Lặt vặt

- Sự kiện `progress` được append **sau** `attempt.exited` (`flushProgress(true)` gọi sau). Thấy trong journal Q3-B. Nên flush trước khi ghi `attempt.exited`.
- Không có GC cho `notifications/`, `tasks/`, `control/dropped/`, `golden/`. Chi phí đọc không đáng kể: 30 000 thông báo cũ cho `readNotifications` 33 ms [ĐKC: J9]. Chỉ có dung lượng đĩa tăng dần. Đề xuất `orch gc --older-than 14d` ở r4.

---

## C. Đề xuất bổ sung hoặc đơn giản hóa

1. **Một hàm `jobrunHealth(root)` duy nhất**: biên dịch, tự kiểm, ghi `.ok`/`.bad`. Runner, doctor và đường lùi trong `runAttempt` cùng dùng hàm này (M3, M8).
2. **Phân loại lỗi pipe ở một chỗ**: `classifyPipeError(code)` → `held | foreign | dead | busy`, dùng chung cho `acquireLease` và `probeLease` (M1).
3. **Bỏ `min_turn` khỏi API MCP**, chỉ giữ `until_followup` (M2). Gọn hơn và hết bẫy `turn` ước lượng.
4. **Chặn launch theo store** (M5): một dòng `if (newest launch-* < 5s) skip`.
5. **`normCwd` dùng `realpathSync.native`** (M6).
6. **Test r3 nên có các phép thử "thật" sau** thay cho gọi hàm thuần: pipe DACL (J4), exe hỏng (J2-c), 8.3/junction (J5), `wait(min_turn)` sau drop (J10).

---

## D. Kết quả tôi tự chạy

Máy: Windows 11 10.0.26200, Node như của bên thiết kế. Không chạy backend thật.

| Mã | Nội dung | Kết quả |
|---|---|---|
| T | `node --test test/*.test.mjs` × 3 | **87/87** × 3 (56,8 s / 44,1 s / 44,0 s) |
| Q1 | Lease pipe: loại trừ, kill holder, 50 acquire đồng thời | null sau 1 ms; probe sau kill `ENOENT` 1 ms; 1/50 thành công; holder bị chặn → `unresponsive` |
| Q2 | 5 vòng × 30 `runner-main` cùng task (kèm biên dịch jobrun đồng thời lần đầu) | 0 vòng lỗi; mỗi vòng 1 `attempt.started`, seq liền, `succeeded`; cache chỉ còn 1 exe |
| Q3 | Cancel/followup A–D | A `succeeded` t1 + `followup.dropped`; B `cancelled` + dropped; C `cancelled`; D turn 2 |
| Q4 | Cursor (a)–(d) | mất 0, lặp 0 cả 4 ca |
| Q5 | Idem/ trần | idem tách theo project ✅; trần toàn cục vẫn chặn chéo (R2, chấp nhận) |
| Q6 | Quoting cmd/npm/ps1 trong thư mục `%x% & (y)` | sai 0/10 mỗi đường; `.ps1` → `.cmd` cùng tên |
| Q7 | Strict schema | khớp yêu cầu N9 |
| Q8 | Lệch CreationDate; tiếp quản | lệch −2…−4 ms; chi phí 556–670 ms; không kill khi lệch 4 s |
| Q9 | ORCH_POLICY hỏng | `runner_failed` sau 282 ms, 1 launch, có log |
| J1 | jobrun: biên dịch trên đường dẫn dài có dấu cách + Unicode; trung thực I/O; cháu | 470 ms; 0 khác biệt / 5 nhóm; cháu chết 3/3 đường; đối chứng không jobrun: cháu sống 2/2 |
| J2 | (a) breakaway dưới jobrun; (b) 12 biên dịch đồng thời; (c) exe 0 byte | (a) `denied:5`, flags 0x2000; (b) 12/12 OK, max 1296 ms, không file sót; (c) **task failed: EFTYPE × 3** (M3) |
| J3 | `taskkill /T /F` lên MCP server giả | trampoline: runner sống **3/3**; direct: chết **3/3** |
| J4 | Pipe lease do tiến trình khác quyền giữ | **`null` + `EPERM` → relaunch vô hạn, `queued`** (M1) |
| J5 | 8.3 / junction | **idem 3/3 tạo mới, trần bị vượt, inbox lọc sai** (M6) |
| J6 | (a) khởi động chậm; (b) N4; (c)(d) cancel/followup; (e) độ trễ khởi động | (a) dương tính giả ở 7 s/2 hub, 12 s/1 hub (M5); (b) không kill; (c)(d) đúng ngữ nghĩa; (e) 107–255 ms, lần đầu 795 ms |
| J7 | Đầu-cuối runner thật + jobrun + fake `grandchild` | cancel: jobrun và cháu chết, `cancelled`; runner `/F`: jobrun và cháu chết sau 0,8 s, hub tự chữa sau 3,2 s |
| J8 | Đường lỗi `ensureJobrun`/`--jobinfo` | PATH thiếu → lùi đúng; `bin` hỏng → **ném lỗi, doctor sập**; thiếu ComSpec → `denied:87` (M8) |
| J9 | 30 000 thông báo cũ | `readNotifications` 33 ms |
| J10 | followup → cancel → `wait(min_turn:2)` | **không bao giờ xong** (M2) |

---

## E. Bất đồng còn lại, điều kiện chấp nhận, và quyết định chốt

### E.1 — R1…R7

| # | Lập trường | Lý do | Rủi ro còn lại | Điều kiện |
|---|---|---|---|---|
| R1 Q3-A ra `succeeded` | **Chấp nhận** lập luận về `status` | Đúng ngữ nghĩa C4 tôi đề xuất: kết quả turn 1 là thật và có trước cancel; cancel chỉ hủy yêu cầu chưa chạy. Đổi sang `cancelled` sẽ xóa một kết quả thật | Kịch bản hại có thật nhưng nằm ở `wait`, không ở `status` (M2, J10) | **Dung hòa:** thêm `cancel:{at,dropped}` vào brief, **và** sửa `wait(min_turn)` (hoặc bỏ `min_turn`). Không đổi `status` |
| R2 trần toàn cục 8, theo cwd 4 | **Chấp nhận** | Lập luận tài nguyên/quota dùng chung đúng. Tôi không có số liệu cho default khác. Chỉnh được bằng env | Một project chiếm 4, hai project chiếm 8 thì project thứ ba bị chặn | Thông điệp lỗi trần toàn cục nên liệt kê project đang chiếm chỗ (nhẹ, không bắt buộc) |
| R3 host `TerminateJobObject`/candidate scan | **Chấp nhận chuyển sang kiểm tay** | Không đo được từ bên trong; trampoline đã chặn đúng cơ chế có nguồn (`taskkill /T`) [ĐKC: J3] | GUI giết theo tiêu chí khác cây PID | Danh sách E.3; fail thì bật launch qua WMI |
| R4 `knownTypes` agy | **Chấp nhận** | Canary và `parser_unrecognized` đã có; golden capture đã có | Lệch format agy thì task thành `bad_output` có chẩn đoán, không im lặng | Người dùng chạy 1 task agy với `ORCH_CAPTURE_GOLDEN=1` (E.3) |
| R5 fixture doc-derived | **Chấp nhận** | Ràng buộc không chạy backend | Như R4 | Như R4, cho cả 3 backend |
| R6 SUSPENDED → Assign | **Chấp nhận rủi ro thấp** | Cửa sổ micro-giây; hậu quả là rò một tiến trình treo, không phải lỗ breakaway (M9) | Rò hiếm | `JOB_LIST` khi tiện, không bắt buộc để chốt |
| R7 tên mục MCP Codex | **Chấp nhận có điều kiện; gộp với M4** | Đọc config.toml chỉ đọc, rẻ | Thêm cờ cho mục không tồn tại có thể làm hỏng mọi lần chạy Codex [KC?] | Làm **trong r3.1**, không đợi r4: chỉ thêm `-c` cho mục có thật |

### E.2 — Điều kiện để tôi chấp nhận bản chốt (r3.1)

| # | Điều kiện | Lỗi |
|---|---|---|
| F1 | J4 (pipe DACL hạn chế): `status` trả `runner_failed` với `lease_permission` trong ≤ 20 s; không relaunch quá 3 lần | M1 |
| F2 | J10: `wait(min_turn:2)` trả về (vd `min_turn_unreachable:true`), **hoặc** `min_turn` bị bỏ khỏi MCP; brief có `cancel.dropped` | M2 / R1 |
| F3 | J2-c: exe 0 byte → task vẫn `succeeded` (chạy không jobrun, `warnings:['jobrun_unavailable']`), và lần sau không thử lại exe hỏng | M3 |
| F4 | Codex adapter chỉ thêm `-c mcp_servers.X.enabled=false` cho X có trong config; có test với config không có mục và config có mục tên khác | M4 / R7 |
| F5 | `ensureJobrun` không ném; `doctor` không sập khi `bin` hỏng | M8-a |

M5, M6, M7 (ghi tài liệu), M8-b/c/d, M9 và M10 là **nên làm**, không phải điều kiện chốt.

### E.3 — Quyết định

**Tôi đồng ý chốt** kiến trúc và phần lõi của r3. Cụ thể:
- lease pipe; journal một writer;
- runner detached với trampoline; jobrun `KILL_ON_JOB_CLOSE`;
- cancel theo thời điểm; cursor thông báo; `runner_failed`.

Phần còn lại (F1–F5) là sửa cục bộ, có phép thử tái hiện sẵn. Tôi **không** yêu cầu một vòng phản biện đầy đủ nữa. Chỉ cần bên thiết kế chạy lại J2-c, J4, J10 và test F4, rồi đính kèm kết quả.

**Danh sách kiểm tay cho người dùng.** Bước chung cho mọi GUI: trước tiên chạy `orch doctor` hoặc tool `subagent_doctor` trong chính GUI đó, rồi ghi lại `job_limits`, `jobrun`, `env`, `commands`.

| GUI | Việc kiểm | Đạt khi |
|---|---|---|
| **Claude Code** (orchestrator) | 1. `subagent_spawn` một task Codex ngắn (đọc file). **Đây là kiểm M4**: config Codex không có mục `subagent-hub` | Task `succeeded`, `attempt.failed` không có lỗi config của codex |
| | 2. Spawn task dài, đóng hẳn Claude Code, đợi 30 s, mở lại, `subagent_status` | `runner_alive:true` hoặc task đã xong (R3) |
| | 3. `Bash` chạy nền `orch wait <id> --until-done`, rồi `subagent_cancel` | Lệnh nền kết thúc, Claude tự mở lượt mới |
| | 4. Hook `orch inbox --hook` | Chỉ thông báo của project hiện tại; không lặp khi gửi 2 prompt liên tiếp |
| **Codex Desktop** (orchestrator) | 1. Spawn task dài, **kết thúc lượt/đóng thread**, rồi đóng app; mở lại, `subagent_status` | `runner_alive:true` hoặc đã xong. Fail thì báo lại kèm `runner.log` (R3: candidate scan) |
| | 2. Nếu tên mục MCP khác `subagent-hub`: `doctor` gợi ý đúng tên (F4); worker Codex **không** thấy tool `subagent_*` | Trong `raw.jsonl` của worker không có `mcp_tool_call` tới hub |
| | 3. Hai hook chạy song song (Codex chạy hook đồng thời) | Không lặp thông báo |
| **Antigravity** (orchestrator) | 1. Spawn task dài, đóng Antigravity, mở lại, `subagent_status` | Như trên (R3) |
| | 2. Một task backend `antigravity` với `ORCH_CAPTURE_GOLDEN=1` | Task `succeeded` không có `unknown_events`; nếu có thì gửi file `golden/antigravity-*.jsonl` cho bên thiết kế (R4) |
| | 3. Hook agy fail-closed: làm hỏng tạm `ORCH_HOME` (trỏ tới file) rồi gửi prompt | Lượt của người dùng **không** bị chặn |
| **Mọi GUI** | 1. Nhờ subagent chạy một lệnh để lại tiến trình nền (vd `start /b ping -n 600 127.0.0.1`), rồi cancel | Không còn `ping.exe` sau cancel (N5 trên máy thật, kèm AV thật) |
| | 2. Lần chạy đầu sau cài đặt: kiểm `ORCH_HOME\bin\jobrun-*.exe` có tồn tại và không bị AV cách ly; `runner.log` không có dòng "jobrun khong dung duoc" | — |
| | 3. Nếu dùng song song một GUI "Run as administrator" và một GUI thường: **đặt `ORCH_HOME` khác nhau** cho tới khi F1 xong | — |

---

## F. Truy vấn notebook

Chỉ dùng `chat_start`/`chat_status`, không dùng `research_*`.

| Câu hỏi | Kết quả | Dùng ở |
|---|---|---|
| Codex: `-c mcp_servers.foo.enabled=false` khi config **không có** `[mcp_servers.foo]` thì lỗi hay bị bỏ qua? | Notebook xác nhận khóa `mcp_servers.<id>.enabled` (Configuration Reference: "Disable an MCP server without removing its configuration"), `-c` dùng được với `exec` và có ưu tiên cao nhất. **Không** trả lời trường hợp mục không tồn tại [KC?] | M4, R7 |
| Job thiếu `BREAKAWAY_OK` + `CREATE_BREAKAWAY_FROM_JOB`; `PROC_THREAD_ATTRIBUTE_JOB_LIST` | (1) `CreateProcess` thất bại với `ERROR_ACCESS_DENIED` (5), khớp J2-a. Một số spawner (sandbox renderer) tự thử lại không breakaway khi gặp lỗi 5, nên tác động thực tế của M7 thấp hơn. (2) `JOB_LIST` (Win10/Server 2016+) gán job trong lúc khởi tạo tiến trình, trước khi thread đầu chạy, nên đóng cửa sổ R6/M9 (Raymond Chen, theo Microsoft Q&A trong notebook). Ghi chú: danh sách nhiều job gán tuần tự, không có cam kết all-or-nothing | M7, M9/R6 |

Yêu cầu notebook cho người điều phối (câu ngắn, tách chủ đề):
1. **(Ưu tiên cao, M4)** Mã nguồn `codex-rs` về deserialize `McpServerConfig`: một mục chỉ có `enabled=false`, không có `command`/`url`, thì lỗi gì? Nguồn cần import: file `config_types.rs` hoặc `mcp_server_config` của openai/codex, hoặc issue liên quan "missing field command".
2. libuv `uv_pipe_bind`/`uv_pipe_connect` trên Windows: `ERROR_ACCESS_DENIED` ánh xạ thành mã gì (M1). Nguồn: `src/win/pipe.c` của libuv.
3. Nếu chưa có: ví dụ stream nguyên văn của `agy -p --output-format stream-json` (R4), như vòng trước.
