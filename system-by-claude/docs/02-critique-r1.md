# 02 — Phản biện vòng 1 cho `01-design-r1.md` và mã nháp `src/`

> Người viết: phản biện viên. Phạm vi: chỉ `system-by-claude/` (tài liệu r1 và `src/`). Không chạy backend thật nào (không `claude`, `codex`, `agy`, kể cả `--version`).
> Nhãn dùng trong tài liệu này:
> - **[ĐKC: nguồn]** là đã kiểm chứng, kèm nguồn. Nguồn có thể là phép thử tôi tự chạy trên máy này (ký hiệu P1…P7, xem mục D) hoặc notebook.
> - **[SL]** là suy luận.
> - **[KC?]** là không chắc, cần bên thiết kế hoặc notebook xác nhận.
>
> Mức độ: **chặn** (không chạy được, hoặc sai kết quả một cách âm thầm trên đường chính), **nghiêm trọng** (hỏng tính đúng đắn hoặc trải nghiệm trong tình huống thường gặp), **vừa**, **nhẹ**.

---

## Tóm tắt điều hành

Tôi đồng ý với khung kiến trúc: một MCP facade chung, CLI headless có luồng JSON, runner tách rời, store trên đĩa, phân loại lỗi rồi resume phiên backend. Tôi **không** đề xuất đổi sang daemon hay durable engine.

Tuy vậy, bản nháp r1 có ba nhóm lỗi phải sửa trước khi chạy với backend thật:

1. **Đường găng trên Windows hỏng ở bước gọi lệnh.**
   - `resolveCommand` chọn shim npm không có đuôi, nên Codex hoặc Claude cài qua npm sẽ luôn ENOENT rồi bị park (B1).
   - Schema strict mà adapter sinh cho Codex không hợp lệ (B2).
   - Cách quote cho cmd.exe cho phép chèn lệnh (B17).
2. **Tính đúng đắn của lease và journal không đạt mức thiết kế tuyên bố.**
   - Trong phép thử, hai runner cùng chạy một task 8–11/15 lần (B3).
   - Hub ghi journal song song với runner nên trùng `seq` (B4).
   - Backend mồ côi bị resume chồng (B10).
3. **"Liền mạch" mới đúng ở phía hub, chưa đúng ở phía GUI.**
   - Backend thoát 0 mà không in gì vẫn được tính là `succeeded` (B5).
   - Inbox bị tiêu thụ phá hủy, đến cả worker cũng xả được (B6).
   - Orchestrator chỉ biết task xong nếu tự gọi `wait` lặp đi lặp lại hoặc người dùng gõ prompt mới (B7).
   - MCP Tasks trong mã chưa tương thích với giao thức (B8).

Về rủi ro Job Object (điểm 1 bên thiết kế nêu), tôi đã **đo được một phần**: runner `detached` thoát khỏi job `KILL_ON_JOB_CLOSE` của libuv. Rủi ro thật nằm ở job của host, đo được bằng một lệnh `orch doctor` (B11).

---

## A. Các điểm đúng, nên giữ

1. **QĐ1, mặt tiền MCP stdio dùng chung, 8 tool `subagent_*`.**
   - Đây là bề mặt chung duy nhất hợp lý cho ba GUI.
   - Loại bỏ `codex mcp-server`/`claude mcp serve` làm mặt tiền là đúng, vì mỗi lời gọi chặn suốt phiên agent.
   - Đưa hướng dẫn vào trường `instructions` của server là cách rẻ để "dạy" orchestrator.
2. **QĐ2, CLI headless có luồng JSON, prompt đi qua stdin.**
   - Đây là mẫu số chung đúng.
   - Prompt qua stdin né được giới hạn khoảng 32K ký tự và lỗi quoting cho phần dữ liệu lớn nhất. P2 cho thấy quoting là chỗ dễ vỡ.
   - Quyết định không dùng `--bare` vì cần đăng nhập subscription là hợp lý.
3. **QĐ3, runner tách rời cho mỗi task, không có daemon trung tâm.**
   - Với một người dùng trên một máy Windows, không cần daemon. Tôi đồng ý với điểm 5 của bên thiết kế: **không** cần Temporal/Restate.
   - Điều kiện: lease phải đúng (B3) và có cơ chế tự chữa khi runner chết lúc GUI vẫn mở (B13).
4. **QĐ6, cô lập context.**
   - Summary ≤ 6000 ký tự, outputs lớn chỉ trả tham chiếu, transcript nằm trên đĩa.
   - Nội dung trả về được gắn nhãn "dữ liệu không tin cậy". Giữ nguyên.
5. **QĐ7 về mặt mô hình.** Journal append-only, `state = fold(journal)`, thư mục attempt, `invocation.json` không chứa prompt, đọc chịu được dòng cuối bị cắt. Mô hình tốt; phần hiện thực cần sửa (B3, B4).
6. **QĐ8, resume bằng phiên backend.** Ghi `backend.session` ngay khi thấy là đúng. Không replay là trung thực với bản chất agent LLM.
7. **QĐ9 và QĐ10, phân loại lỗi trước khi quyết định.**
   - `auth` không retry và không bao giờ tự đăng nhập.
   - Failover là opt-in, có `pre_failover`.
   - Có trần `max_attempts` và `max_repairs`.
   - Backoff có jitter.
8. **§5 đã thừa nhận thẳng** rằng mặc định quyền hạn chế khiến subagent "thành công mà không làm gì". Nhận diện đúng; tôi chỉ bổ sung cách phát hiện (B18).
9. **Interface adapter nhỏ** (`buildInvocation/parseLine/classifyExit/finalize`). Fake backend và 28 test đọc dễ, chạy nhanh (khoảng 11 giây).
10. **Trần long-poll 50 giây** là hợp lý. Ràng buộc thật có lẽ là timeout tool MCP của Codex (mặc định 60 giây) chứ không phải "HTTP 60 giây" (xem B8, [KC?] chờ notebook). Vẫn nên cho cấu hình được.
11. **Kỷ luật gắn nhãn [KC]/[GĐ]** trong tài liệu r1 rất tốt và giúp phản biện nhanh.

---

## B. Danh sách vấn đề

### B1 — [chặn] `resolveCommand` chọn shim npm không đuôi, nên mọi lần gọi backend cài qua npm đều ENOENT và bị park `config`
- **Bằng chứng:**
  - `lib/proc.mjs:12`: `const exts = isWin ? ['', ...PATHEXT] : ['']`, tức đuôi rỗng được thử **trước**.
  - npm cài toàn cục tạo ba file `x`, `x.cmd`, `x.ps1`; file `x` là script sh.
  - [ĐKC: P2] `resolveCommand('npm')` trả `C:\Program Files\nodejs\npm` (không đuôi). `spawnInvocation({command:'npm'})` cho `spawn error ENOENT`.
- **Hậu quả:**
  - Codex (thường cài bằng `npm i -g @openai/codex`) và Claude bản npm sẽ không bao giờ chạy được.
  - `runAttempt` phân loại thành `config`, `decide` cho ra `park`, task rơi vào `needs_attention` với thông báo khó hiểu.
  - Không test nào bắt được lỗi này, vì test chỉ dùng `process.execPath`.
- **Đề xuất:**
  - Trên Windows chỉ chấp nhận file có đuôi thuộc PATHEXT, thử theo thứ tự PATHEXT. Bỏ đuôi rỗng, trừ khi `cmd` đã có sẵn đuôi.
  - Thêm test dùng một thư mục giả có `x`, `x.cmd`, `x.ps1`.

### B2 — [chặn cho Codex] Schema "strictify" sinh ra không hợp lệ ở strict mode và mâu thuẫn với RESULT CONTRACT
- **Bằng chứng:** [ĐKC: P1] in ra schema mà adapter Codex ghi vào `final-schema.json`:
  - `outputs` = `{"type":"object"}`, không có `properties` và không có `additionalProperties:false`. `strictify` chỉ xử lý object **có** `properties` (`adapters/codex.mjs:88`).
  - `artifacts.items` = `{"required":["path"],"properties":{"path":…},"additionalProperties":false}`, tức **trường `description` bị cấm**, trong khi RESULT CONTRACT (`schema.mjs:54`) yêu cầu `{"path","description"}`.
- **Hậu quả:**
  - [ĐKC: notebook, Developers Digest "Strict Mode" 2026; DEV Community 2026] `--output-schema` dùng strict structured outputs. Strict mode bắt buộc **mọi** object có `additionalProperties:false` và mọi property phải nằm trong `required`.
  - Vì vậy [SL] API sẽ từ chối `outputs:{"type":"object"}`. Mọi task Codex khi đó thành `crash` hoặc `config`, và lỗi này luôn xảy ra vì `nativeSchema !== false` là mặc định.
  - Nếu API chấp nhận, model bị ràng buộc không được xuất `description`, còn `outputs` không ràng buộc được gì.
  - Với `output_schema` của người gọi có trường tùy chọn, strictify ép mọi trường thành `required`, nên ý nghĩa schema bị đổi.
- **Đề xuất:**
  - (a) Không có `output_schema` thì `outputs` = `{"type":"object","properties":{},"additionalProperties":false}`.
  - (b) Strictify đệ quy cho **mọi** object. Trường tùy chọn chuyển thành union có `null` thay vì ép `required`. Giữ `description` trong `artifacts.items`.
  - (c) Thêm test kiểm bất biến strict: mọi object có `additionalProperties:false` và `required` bằng tập khóa của `properties`.
  - (d) Nếu Codex báo lỗi schema (lớp `config`), tự động thử lại **một lần không có** `--output-schema` (để hub validate và repair), thay vì park.

### B3 — [nghiêm trọng] Lease không loại trừ được: hai runner cùng chạy một task
- **Bằng chứng:**
  - `runner.mjs:25-40` (`acquireLease`) làm tuần tự: kiểm stale → `unlinkSync` → `wx`. Đây là TOCTOU kinh điển: A và B cùng thấy stale; A xóa rồi tạo lease mới; B xóa **lease mới của A** rồi tạo của mình.
  - Heartbeat (`runner.mjs:72`) ghi đè `lease.json` mà **không kiểm tra** `runner_id` (không có fencing).
  - `leaseIsStale` coi lease là stale khi `heartbeat_at` quá 30 giây **dù pid còn sống**.
  - [ĐKC: P4b] Đặt `lease.json` của một pid đã chết, rồi khởi động đồng thời hai runner: **8–11/15 lần (qua 3 lần chạy) cả hai cùng chạy backend** (hai `attempt.started` với hai pid backend khác nhau, cả hai báo `succeeded`).
- **Kịch bản thường gặp** [SL]:
  - Laptop sleep quá 30 giây. Khi máy thức, mọi heartbeat đều cũ.
  - Lúc đó GUI mở lại khiến `reconcile` chạy, hoặc người dùng gọi `followup`/`resume`. Một runner mới chiếm lease trong khi runner cũ vẫn sống.
  - Kết quả: hai agent cùng ghi một `cwd`, tốn chi phí gấp đôi, journal xen kẽ.
- **Đề xuất (ưu tiên giảm dần):**
  1. **Dùng named pipe làm lease do hệ điều hành giữ.** Runner `listen('\\.\pipe\orch-<hash(ORCH_HOME)>-<task_id>')`.
     - [ĐKC: P5] Trên máy này:
       - Lần `listen` thứ hai cùng tên trả `EADDRINUSE`.
       - `connect` khi holder còn sống thì thành công.
       - Sau `taskkill /F` holder, `connect` trả `ENOENT` và `listen` lại được ngay.
     - Như vậy liveness không phụ thuộc pid (không lo PID reuse), không phụ thuộc đồng hồ (không lo sleep), và không cần heartbeat.
     - Pipe còn là **kênh điều khiển tức thời** (cancel, followup, hỏi tiến độ) thay cho việc poll `control/` mỗi 200ms.
  2. Nếu vẫn dùng file:
     - Chỉ coi là stale khi pid đã chết **và** thời điểm tạo tiến trình khác với giá trị ghi trong lease. Không bao giờ coi stale chỉ vì heartbeat cũ.
     - Chiếm lease bằng `rename` sang tombstone rồi đọc lại để xác nhận.
     - Thêm fencing token (`lease_gen` tăng dần), và kiểm tra token trước mỗi lần append hoặc heartbeat.

### B4 — [nghiêm trọng] "Một writer" bị vi phạm: hub, nhiều MCP server và runner cùng append, gây trùng `seq` và mất lệnh hủy
- **Bằng chứng:**
  - Hub append trực tiếp ở `hub.cancel` (`hub.mjs:101`, khi `!runner_alive`), `hub.reconcile` (`hub.mjs:140`) và `createTask`.
  - `seq` được tính bằng cách đọc toàn bộ file rồi cộng 1 (`store.mjs:90-91`).
  - [ĐKC: P4a] Hai tiến trình, mỗi bên append 150 lần, cho ra 301 sự kiện với **40–99 `seq` trùng (3 lần chạy)**.
- **Kịch bản:**
  - **Hủy ngay sau khi spawn.** Runner mất vài trăm ms để khởi động node. `cancel` thấy không có runner, liền append `task.completed{cancelled}` rồi **`clearCancel`**. Đúng lúc đó runner vừa chiếm được lease: nó đọc state trước khi sự kiện kia được ghi, không còn thấy `cancel.request`, và chạy task đến hết. Trạng thái cuối bị ghi đè thành `running`, rồi `succeeded`.
  - **Nhiều GUI hoặc phiên Claude cùng khởi động.** Mỗi phiên khởi động một MCP server, nên `reconcile` chạy song song và append `task.interrupted` trùng nhau.
  - `events(since_seq)` có thể bỏ sót sự kiện khi `seq` trùng.
- **Đề xuất:**
  - Quy tắc sở hữu cứng: **chỉ tiến trình giữ lease mới được append**. Hub chỉ ghi `control/`, rồi launch runner.
  - Runner, sau khi chiếm lease, tự ghi `task.interrupted`, `task.completed{cancelled}`, v.v.
  - `hub.cancel` khi không có runner thì launch một runner "janitor". Runner này thấy `cancel.request` và kết thúc trong vài ms.
  - `seq` lấy từ bộ đếm trong bộ nhớ của người giữ lease.

### B5 — [nghiêm trọng] "Thành công giả": backend thoát 0 mà không in gì thì vẫn là `succeeded`
- **Bằng chứng:**
  - `runner.mjs:352-355`: không có `final` thì trả `finalText: ''`.
  - Không có session nên không repair được, đi vào `finishDegraded('')` với `status:'succeeded'`.
  - [ĐKC: P3-A] Adapter `node -e ""` (thoát 0, im lặng) cho ra `status=succeeded format=degraded summary="" error=bad_output`.
- **Hậu quả:**
  - Đây đúng là kịch bản agy #76 (stdout bị nuốt) và kịch bản soft-deny thoát 0. Orchestrator nhận "succeeded" với summary rỗng.
  - [ĐKC: notebook, John Young "Loop Engineering" 2026, issue Codex #56875 "codex exec: refused turn silently dropped"] Codex cũng có thể thoát 0 khi lượt bị từ chối. Harness không được coi exit 0 là thành công.
  - Envelope còn tự mâu thuẫn: `status: succeeded` nhưng `error` khác null.
  - Điều này trả lời điểm (6) của bên thiết kế: **chưa** đủ để gọi là định dạng thống nhất, vì ngữ nghĩa của `status` không nhất quán.
- **Đề xuất:**
  - Không có output (hoặc text rỗng) thì xếp lớp `no_output`: thử lại một lần (resume nếu có session, ngược lại chạy fresh); vẫn rỗng thì `failed`.
  - `degraded` chỉ dùng khi có text không rỗng. Khi đó `status` là `succeeded` nhưng `error:null` và `warnings:["unverified_format"]`.
  - Bất biến: `status==='succeeded'` ⇒ `error===null`. Thêm test cho bất biến này.

### B6 — [nghiêm trọng] Inbox bị tiêu thụ phá hủy và dùng chung cho mọi bên, kể cả worker
- **Bằng chứng:**
  - `drainInbox()` xóa file khi đọc (`store.mjs:153-163`).
  - Tool `subagent_list` cũng gọi `hub.inbox()` (`mcp-server.mjs:60`), nên một lần `list` sẽ "ăn" mất thông báo mà hook `UserPromptSubmit` đáng lẽ hiển thị.
  - Ba GUI hoặc nhiều phiên cùng một `ORCH_HOME`: ai xả trước thì người đó nhận hết.
  - **Worker Claude chạy trong `cwd` của project**, và `--strict-mcp-config` không tắt hook. [ĐKC: notebook, Claude Code docs: `claude -p` vẫn nạp `CLAUDE.md`, `.claude/settings*.json` và chạy hook `UserPromptSubmit`/`SessionStart`/`Stop`; chỉ `--bare` mới bỏ hook; ngoài ra có `--setting-sources` và `--settings` để lọc]. Hook `UserPromptSubmit`/`SessionStart` trong `.claude/settings.json` của project sẽ chạy `orch inbox` **ngay trong worker**. Worker vừa xả thông báo của orchestrator, vừa nhét thông báo của task khác vào context của chính nó.
- **Hậu quả:** kênh thông báo số 3 của QĐ4 mất thông báo một cách ngẫu nhiên, và còn rò thông tin giữa các task.
- **Đề xuất:**
  - Inbox chuyển thành log append-only (`notifications.jsonl`) cộng **cursor theo người tiêu thụ**. Khóa cursor là `session_id` mà hook nhận qua stdin; Claude và Codex đều truyền `session_id` vào hook [KC?].
  - `subagent_list` **không** xả inbox.
  - `orch inbox` thoát im lặng khi `ORCH_DEPTH>0` hoặc khi có `ORCH_PARENT_TASK`. Biến này runner đã đặt sẵn ở `runner.mjs:265` nhưng chưa dùng.
  - Lọc theo `run_id` hoặc `origin` để mỗi phiên chỉ thấy task của mình.
  - Tên hook khác nhau giữa các bên: [ĐKC: notebook] Codex có `UserPromptSubmit`/`SessionStart`/`Stop` (12 điểm, các hook khớp chạy **đồng thời**). Họ Gemini/Antigravity CLI **không có** `UserPromptSubmit`; tương đương gần nhất là `BeforeAgent`/`SessionStart`. Tài liệu r1 nên ghi đúng tên hook cho từng GUI. Riêng Antigravity GUI, notebook không có nguồn.

### B7 — [nghiêm trọng, trải nghiệm] Không chặn ở hub, nhưng orchestrator vẫn phải chặn hoặc tự poll để biết kết quả
- **Phân tích** [SL]:
  - `spawn` trả về ngay, nhưng cách duy nhất để orchestrator *tự* biết task đã xong là gọi `subagent_wait` lặp lại.
  - Mỗi lần gọi là một vòng model: tốn token, context phình. Một task 30 phút cần khoảng 36 lời gọi, cộng dồn chừng 10k token kết quả `wait`. Trong lúc đó lượt của agent vẫn "bận".
  - Nếu orchestrator kết thúc lượt, thì với Codex và Antigravity **không có cơ chế đánh thức phiên đang idle**. Hook inbox chỉ chạy khi người dùng gõ prompt mới.
  - Tài liệu r1 ghi "GUI không bao giờ bị treo", nhưng điều này chỉ đúng với tiến trình GUI, không đúng với hội thoại.
- **Đề xuất:**
  - (a) Viết một **ma trận "giao kết quả" trung thực theo từng GUI**: kênh nào đánh thức được phiên idle, kênh nào cần người gõ, kênh nào bắt orchestrator chặn.
  - (b) Riêng Claude Code: kênh thật sự liền mạch là MCP Tasks làm đúng chuẩn (B8), hoặc chạy nền `node orch.mjs wait <id> --until-done`. [ĐKC một phần: notebook cho biết Claude Code chèn sự kiện hoàn thành của tác vụ nền vào phiên idle và tự mở một lượt model mới; nguồn còn mơ hồ về điều kiện cụ thể].
  - (c) Thêm **thông báo cho người** (Windows toast qua PowerShell, không cần dependency) khi task xong hoặc bị park, làm hook `on_complete_notify`. Người dùng biết lúc nào quay lại, kể cả với Codex và Antigravity.
  - (d) `subagent_wait` trả luôn `summary` của task đã xong, để bớt một vòng `subagent_result`.
  - (e) Thêm `subagent_run{…, wait_ms ≤ 45000}`: việc ngắn thì nhận kết quả trong một lời gọi, việc dài thì nhận `task_id`. Cách này khớp với tiêu chí "cùng một cách dùng".

### B8 — [nghiêm trọng] Kênh MCP Tasks trong mã chưa tương thích với giao thức, và server tự nhận mọi `protocolVersion`
- **Bằng chứng:**
  - `initialize` chỉ khai `capabilities: { tools }` (`mcp-server.mjs:84`), không khai `tasks`. Tool không có chú thích thực thi (`execution.taskSupport`). Client không có lý do gửi `params.task`, nên nhánh `tasks/*` gần như chắc chắn là mã chết.
  - [ĐKC: notebook, MCP spec 2026-07-28] Bản 2026-07-28 là **stateless**:
    - **Bỏ** handshake `initialize`. Mỗi request mang `_meta["io.modelcontextprotocol/protocolVersion"]` và `clientCapabilities`.
    - Có `server/discover` (tùy chọn) để khám phá năng lực.
    - Tasks là extension: server trả handle `{taskId, status, pollInterval, ttl}`, còn kết quả đồng bộ mang `resultType:"complete"`.
  - Server tự viết **không** xử lý `_meta` hay `server/discover`, nhưng lại echo mọi `protocolVersion` trong `initialize` (`params?.protocolVersion ?? …`). Tức là nó tự nhận hỗ trợ 2026-07-28 mà không hiện thực bản đó.
  - **Mâu thuẫn nguồn:** r1 ghi [KC] "Claude Code v2.1.304+ hỗ trợ MCP Tasks", nhưng notebook cho biết chưa có tài liệu nào cho thấy Claude Code, Codex hay Antigravity **gửi** request kèm task. Bên thiết kế cần dẫn nguyên văn đoạn tài liệu.
- **Hậu quả:**
  - Tài liệu QĐ4 xếp MCP Tasks là kênh "mượt nhất", nhưng thực tế kênh này không hoạt động.
  - Echo protocol version có thể khiến client mới hành xử sai.
- **Đề xuất:**
  - Chuyển sang `@modelcontextprotocol/sdk` ngay ở r2 (bên thiết kế đã đề xuất; tôi đồng ý và đẩy lên mức ưu tiên cao). Một lần `npm install` là chi phí nhỏ.
  - Chỉ trả về phiên bản mà server thật sự hiện thực.
  - Chỉ quảng bá `tasks` khi đã có test hợp chuẩn với SDK client.

### B9 — [nghiêm trọng] Chống đệ quy với Codex và Antigravity: `ORCH_DEPTH` nhiều khả năng không tới được hub
- **Bằng chứng/suy luận:**
  - Theo hiểu biết của tôi về `codex-rs`, Codex khởi chạy MCP server stdio với **env đã lọc** (whitelist vài biến hệ thống, cộng `env`/`env_vars` trong cấu hình), không kế thừa toàn bộ env [SL, [KC?]].
  - Notebook xác nhận Codex có `env`/`env_vars` riêng cho từng server và áp dụng nguyên tắc least privilege, nhưng **không** nêu danh sách whitelist.
  - Nếu đúng vậy: worker Codex có `ORCH_DEPTH=1`, nhưng hub mà nó thấy (khai trong `~/.codex/config.toml`) lại khởi động với depth bằng 0. Trần độ sâu không có tác dụng.
  - Tài liệu r1 đã nêu đây là GĐ; tôi cho rằng khả năng hỏng cao.
- **Đề xuất (nhiều lớp, không phụ thuộc env):**
  - (a) Worker Codex: thêm `-c mcp_servers.subagent-hub.enabled=false`, hoặc `-c 'mcp_servers.subagent-hub.env.ORCH_DEPTH="1"'` để tiêm env tường minh qua cấu hình [KC?: tên khóa `enabled`].
  - (b) Hub tự kiểm tra **tổ tiên tiến trình** lúc khởi động: đi ngược `ParentProcessId` (một lần `Get-CimInstance Win32_Process`, khoảng 0,5–1 giây). Nếu gặp một pid backend đang ghi trong `attempt.started` của task đang chạy, thì đặt depth bằng depth của task đó cộng 1.
  - (c) Đặt trần toàn cục `ORCH_MAX_ACTIVE` (số task đang chạy trong store) làm hàng rào cuối, chặn bùng nổ fan-out dù mọi lớp kia đều hỏng.
  - (d) Antigravity: ghi rõ là chưa có cơ chế, và mặc định **không** đăng ký hub ở cấu hình toàn cục mà worker agy đọc được.
    - [ĐKC: notebook, Gemini CLI docs 2026] Nền Gemini CLI, mà Antigravity CLI kế thừa phần nạp ngữ cảnh, đọc MCP từ `mcpServers` trong `settings.json` theo các tầng project `.gemini/`, user `~/.gemini/` và system.
    - Vì vậy hub đăng ký ở `~/.gemini/settings.json` sẽ hiện ra trong mọi worker agy [SL: chưa rõ Antigravity CLI có dùng đúng tệp này không].

### B10 — [nghiêm trọng] Backend mồ côi khi runner chết lẻ, rồi bị resume chồng lên cùng phiên
- **Bằng chứng:**
  - Trên Windows, backend được spawn không tách rời và **không** nằm trong job nào của runner. Runner là con detached nên không thuộc job của libuv (P7). Khi runner chết vì exception, backend vẫn sống.
  - Exception có thể đến từ:
    - Heartbeat `setInterval` gọi `writeJsonAtomic`, hàm này ném lỗi sau 20 lần `EPERM` (antivirus, hoặc reader giữ file).
    - `append` trong handler `rl.on('line')`.
  - Các callback này nằm ngoài `try/catch` của `runner-main.mjs`.
  - `reconcile` relaunch, runner mới `--resume` **cùng session** trong khi tiến trình cũ vẫn chạy. Pid backend đã có trong `attempt.started` nhưng không được dùng để kill.
- **Đề xuất:**
  - Bọc `process.on('uncaughtException'|'unhandledRejection')`: kill cây backend rồi ghi `attempt.failed{crash}`.
  - Khi tiếp quản task, kill cây của pid backend cũ, sau khi xác thực đúng tiến trình bằng thời điểm tạo.
  - r2: đặt mỗi attempt vào một **Job Object riêng** có `KILL_ON_JOB_CLOSE`, thông qua helper nhỏ (PowerShell `Add-Type` hoặc một exe vài KB). Cách này giải quyết luôn chuyện `taskkill /T` bỏ sót cháu bị đổi cha.
  - Lưu ý: [ĐKC: notebook, Microsoft/Windows Report 07/10/2026; Codex Windows sandbox docs] Codex trên Windows 11 dùng Microsoft Execution Containers (AppContainer). Chưa rõ `taskkill /T` từ runner có với tới tiến trình trong container hay không [KC?]. Cần đưa vào `orch doctor`.

### B11 — [vừa] Job Object: rủi ro thật hẹp hơn tài liệu viết, và đo được ngay
- **Kết quả đo** [ĐKC: P6, P7], trong host Claude Code trên máy này:
  - Tiến trình con **không** detached nằm trong job có `LimitFlags=0x3C00` (KILL_ON_JOB_CLOSE, BREAKAWAY_OK, SILENT_BREAKAWAY_OK, DIE_ON_UNHANDLED_EXCEPTION). Đây đúng là job toàn cục của libuv.
  - Tiến trình con **detached** (như `detachedLauncher`) **không** thuộc job đó. Job trực tiếp của nó là job của host, với `LimitFlags=0x0` (không có KILL_ON_JOB_CLOSE), và **cấm breakaway**: `CREATE_BREAKAWAY_FROM_JOB` trả lỗi 5.
- **Giới hạn của phép đo:**
  - Đây là cây tiến trình của công cụ shell trong phiên Claude Code của tôi, không phải cây của một MCP server do GUI khởi động.
  - Phía detached được đo qua `cmd /c powershell` sinh từ một tiến trình detached. `cmd` không tạo job, nên powershell thừa hưởng job của cha.
  - Cần đo lại trong ngữ cảnh MCP server của từng GUI.
- **Kết luận:**
  - Với host dựa trên libuv (Node/Electron, có lẽ cả Bun [KC?]), runner detached **sống sót** khi MCP server bị đóng.
  - Rủi ro còn lại: host chủ động `TerminateJobObject` hoặc kill cây khi thoát. Điều này chưa đo.
  - Nếu cần thoát ra khỏi job, `CREATE_BREAKAWAY_FROM_JOB` **không dùng được** ở host này, nên chỉ còn WMI `Win32_Process.Create` hoặc `schtasks`.
  - Lưu ý về WMI [SL]: tiến trình **không kế thừa env** của người gọi (phải truyền `ORCH_HOME` qua argv), chậm khoảng 0,5–1 giây, và có thể bị EDR gắn cờ.
- **Đề xuất:**
  - Thêm `orch doctor`, chạy P6/P7 trong ngữ cảnh MCP server của từng GUI và in ra cờ job.
  - Thêm một phép thử thủ công: spawn task `slow`, đóng GUI, kiểm tra heartbeat vẫn tăng.
  - Chỉ thêm launcher breakaway cho GUI nào thật sự giết runner.

### B12 — [vừa] Retry không có trần khi runner bị relaunch nhiều lần (poison pill)
- **Bằng chứng:**
  - `attemptsThisRun` reset theo **tiến trình runner** (`runner.mjs:123`).
  - Mỗi lần MCP server khởi động (mỗi phiên Claude Code là một server) đều chạy `reconcile` rồi relaunch.
  - Một task làm runner chết một cách tất định sẽ chạy lại backend vô hạn, tốn tiền.
- **Đề xuất:**
  - Đếm `attempt.failed` và `task.interrupted` **từ journal**.
  - Vượt `max_interruptions` (ví dụ 3) thì `needs_attention{class:'poison'}`.

### B13 — [vừa] Runner chết khi GUI vẫn mở thì task treo vô hạn trong `wait`
- **Bằng chứng:**
  - `reconcile` chỉ chạy lúc MCP server khởi động.
  - `wait` coi "done" là TERMINAL hoặc `needs_attention`. Task có `stale:true` không bao giờ thỏa điều kiện đó, nên orchestrator poll đến hết giờ, lặp lại mãi.
- **Đề xuất:**
  - `status()`/`wait()` phát hiện `stale` thì tự launch runner (an toàn nhờ lease đúng ở B3).
  - Nếu đã vượt trần ở B12 thì trả `needs_attention`.

### B14 — [vừa] `followup` rồi `wait` ngay thì nhận lại kết quả cũ
- **Bằng chứng:** [ĐKC: P3-C] Gọi `followup` trên task đã `succeeded`, rồi `wait` ngay: `wait` trả `timed_out=false status=succeeded`, và `result` vẫn là bản cũ (cùng `finished_at`).
- **Hậu quả:** orchestrator đọc kết quả của lượt trước và tưởng đó là câu trả lời cho followup. Lỗi này âm thầm.
- **Đề xuất:**
  - Thêm khái niệm `turn`. `followup` trả `{turn: n+1}`.
  - `status` báo `pending_followups>0` là chưa xong.
  - `result` mang `turn`.
  - `wait` nhận `{task_id, min_turn}`.

### B15 — [vừa] Watchdog idle giết các tool chạy lâu
- **Phân tích:**
  - Khi agent chạy một lệnh build/test dài hơn 10 phút, backend thường không in gì ra stdout [SL]. Watchdog coi đó là `hang`, kill, resume, và agent chạy lại lệnh đó: một vòng lặp.
- **Đề xuất:**
  - Adapter báo "tool đang chạy": Claude `tool_use` chưa có `tool_result`; Codex `item.started` chưa có `item.completed`.
  - Khi có tool đang chạy, dùng `tool_idle_timeout_ms` dài hơn.
  - Hoặc kiểm CPU/IO của cây tiến trình trước khi kết luận treo.

### B16 — [vừa] Hủy và gửi thêm lượt giữa chừng: hiện chỉ có `taskkill /F`, nên turn đang chạy bị mất
- **Đề xuất:**
  - **Claude:** chạy `--input-format stream-json --output-format stream-json`, giữ stdin mở, và hủy bằng `control_request{subtype:"interrupt"}`. Như vậy không cần SDK và không cần SIGINT, mà còn gửi được followup **ngay giữa lượt**.
    - [ĐKC một phần: notebook cho biết client của Agent SDK và tiến trình headless trao đổi thông điệp điều khiển có cấu trúc qua stdin, và yêu cầu `interrupt` dừng lượt mà không làm sập tiến trình. Tên trường chính xác cần kiểm khi được phép chạy backend.]
  - **Codex:** cân nhắc `codex app-server` thay cho `exec --json`.
    - [ĐKC: notebook, Bonamy & Choi "Codex as a platform", OpenAI Developers 19/08/2026] Đây là giao diện JSON-RPC chính thức, có thread bền, start turn, **interrupt**, luồng sự kiện và yêu cầu phê duyệt.
    - Ngược lại, `exec` thoát 0 cả khi lượt bị từ chối (#56875). Tôi đề xuất app-server làm driver Codex ở r2, hoặc ít nhất là phương án được đánh giá chính thức.
  - **Hiện tại:** `child.stdin.end()` đóng stdin ngay. Với agy `--input-format stream-json`, đóng stdin có thể bị hiểu là "hết input, hủy" [KC?]. Cần ghi thành giả định.

### B17 — [vừa] Quote cho cmd.exe chèn lệnh được khi đối số chứa `"` và ký tự đặc biệt
- **Bằng chứng:** [ĐKC: P2] Đối số `{"d":"a & echo INJECTED_MARKER"}` đi qua shim `.cmd` thì bị cắt thành `{"d":"a`, và **`echo INJECTED_MARKER` được thực thi**. Dấu cách, `%PATH%` và `""` thì qua đúng.
- **Phạm vi:**
  - `--json-schema` của Claude khi `nativeSchema` bật và Claude là shim npm.
  - `backend_options.*.args`.
  - `model`.
  - Schema của Codex đi qua file nên an toàn.
- **Đề xuất:**
  - Tốt nhất là tránh cmd.exe hoàn toàn: đọc shim npm để lấy đường dẫn JS đích rồi chạy `node <entry.js>`, như `cross-spawn` làm. Nếu không được, escape `^` cho metachar theo thuật toán của `cross-spawn`.
  - Từ chối đối số chứa `"` khi phải đi qua `.cmd`.
  - Dữ liệu JSON luôn đi qua file.

### B18 — [vừa] Quyền mặc định: cần *phát hiện* "thành công mà không làm gì", không chỉ cảnh báo trong tài liệu
- **Đề xuất (không cần thiết kế policy):**
  - (a) Thêm `spec.access: 'read'|'write'` (mặc định `read`).
  - (b) Nếu `access=write` mà `pre_attempt` không trả cờ quyền nào, thì **fail-fast** `config: chưa cấu hình policy ghi`. Không chạy backend.
  - (c) Envelope có `denials[]`, gom từ `permission_denials` trong `result` của Claude [KC?], soft-deny của agy, và item bị từ chối của Codex.
  - (d) Task ghi mà `changed_files` rỗng **và** `git status` không đổi thì thêm `warnings:["no_changes"]`.

### B19 — [vừa] Mặt tiền MCP nhận cả trường không khai báo, nên orchestrator vượt được policy tương lai
- **Bằng chứng:**
  - `callTool('subagent_spawn', a)` chuyển nguyên `a` vào `normalizeSpec`, nên `backend_options.claude.args`, `limits` và `policy` đều nhận được.
  - Các adapter nối `backend_options.*.args` **sau** `extraArgs` của `pre_attempt` (ví dụ `claude-code.mjs:36`).
  - Orchestrator bị prompt injection có thể truyền `--dangerously-skip-permissions`.
- **Đề xuất:**
  - Facade chỉ nhận đúng các trường trong `inputSchema`.
  - `backend_options` chỉ đi qua policy.
  - Policy là bên **cuối cùng** quyết định argv: hook nhận argv đầy đủ và có quyền sửa hoặc xóa.

### B20 — [vừa] Tài liệu và mã chưa khớp
1. QĐ5 viết agy `--json-schema` cho `structured_output` [KC] và ngụ ý đã bật. Thực tế adapter agy khai `nativeSchema:true` nhưng **không bao giờ** thêm `--json-schema`, còn Claude mặc định `nativeSchema:false`. Cần ghi rõ "chỉ Codex bật schema native".
2. §4 ghi lớp `cancelled` có hành động "kết thúc". Trong mã, agy `CANCELED` có lớp `cancelled`, `decide` trả `fail`, nên envelope ra `status:'failed'` thay vì `cancelled`.
3. Bảng §4, dòng `crash`, ghi "resume phiên rồi retry". Trong mã, khi có session thì resume ở **mọi** lượt, không có bước chuyển sang chạy lại từ đầu như comment trong `failures.mjs:8` mô tả.
4. QĐ4 lấy lý do 50 giây là "Claude áp max(60s, …) cho HTTP". Nhưng server là stdio, và ràng buộc thật có lẽ là timeout tool của Codex [KC?].
5. `spec.depth` và `ORCH_PARENT_TASK` được ghi ra nhưng không dùng ở đâu.
6. §2.1 ghi `subagent_list` "kèm việc xả inbox", điều này mâu thuẫn với kênh hook (B6).
7. §2.1 có trạng thái `interrupted`, nhưng `MCP_TASK_STATUS` ánh xạ trạng thái này sang `working` vô thời hạn (liên quan B13).

### B21 — [nhẹ] Trạng thái `WAITING`/`INVALID` của agy bị coi là `crash` và retry 3 lần
- **Đề xuất:**
  - `WAITING` (đang chờ duyệt quyền) ánh xạ sang `needs_attention{class:'permission'}`.
  - `INVALID` ánh xạ sang `config`.
  - `CANCELED` ánh xạ sang `cancelled`.

### B22 — [nhẹ] Phân tích rate limit
- `api_retry.retry_delay_ms` của Claude là backoff nội bộ, không phải thời điểm quota reset.
- `lastApiRetry` có thể đã cũ (một lần retry trước đó đã thành công).
- Thông báo dạng "usage limit reached|<epoch>" của Claude subscription và "try again at 3:45 PM" của Codex chưa được parse [KC?: định dạng chính xác].
- **Đề xuất:**
  - Chỉ dùng `api_retry` nếu nó là sự kiện cuối trước khi thất bại.
  - Parse epoch và giờ địa phương.

### B23 — [nhẹ] `cwd` và `ORCH_HOME` mặc định phụ thuộc vào cwd của MCP server, mà cwd này khác nhau giữa các GUI
- **Đề xuất:**
  - Lấy `cwd` từ MCP `roots/list` của client, hoặc bắt buộc truyền `cwd`.
  - `ORCH_HOME` mặc định đặt theo người dùng (`%LOCALAPPDATA%\subagent-hub\<hash(project)>`), không đặt trong repo. Nếu đặt trong repo, `.orch/` sẽ làm bẩn `git status` mà worker đọc, và cần `.gitignore`.

### B24a — [vừa] `--bare` có thể trở thành mặc định của `claude -p`, khiến worker Claude mất đăng nhập subscription
- **Bằng chứng:** [ĐKC: notebook, trích Claude Code docs "Automate actions with hooks", truy xuất 02/11/2026] Tài liệu viết rằng `--bare` "được khuyến nghị cho lời gọi kịch bản và **sẽ trở thành mặc định của -p**". Tài liệu r1 [KC] cho biết `--bare` không đọc OAuth/keychain.
- **Hậu quả:** khi Claude cập nhật bản mới, mọi worker Claude có thể đồng loạt chuyển sang lớp `auth` rồi bị park, dù người dùng vẫn đang đăng nhập GUI.
- **Đề xuất:**
  - Theo dõi điều này như một rủi ro có tên trong §6.
  - `classifyExit` phân biệt riêng "thiếu API key ở chế độ bare" để thông báo đúng nguyên nhân.
  - `orch doctor` kiểm tra (khi được phép chạy backend) xem `-p` có còn dùng phiên subscription.
  - Chuẩn bị phương án dự phòng: cờ tường minh tắt bare (nếu có), hoặc driver dùng Agent SDK.

### B24 — [nhẹ] Các điểm nhỏ khác
- Slot lock (`runner.mjs:43-60`) chỉ kiểm pid nên lỗi PID reuse có thể làm rò slot. Slot không công bằng (không có FIFO).
- `wall_timeout_ms` tính theo attempt, nên tổng thời gian của task không có trần.
- `append` đọc lại cả journal rồi fold ở mỗi lần ghi, tức O(n²). Chấp nhận được cho r1. Khi đã có lease đúng, nên giữ `seq` và state trong bộ nhớ.
- Validator không kiểm `additionalProperties`. `extractJsonBlock` dò ngược dấu ngoặc bị sai khi chuỗi chứa `}`.

---

## C. Đề xuất bổ sung hoặc đơn giản hóa

1. **Named pipe cho mỗi task** (B3, B4, B13, B16, B24). Một cơ chế thay cho bốn thứ: lease, heartbeat, poll `control/` và kiểm pid của slot.
   - `hub.status` có thể `connect` để hỏi tiến độ thời gian thực.
   - Cancel và followup có hiệu lực tức thời.
   - Vẫn **không có daemon**.
2. **Quy tắc sở hữu một câu:** "chỉ người giữ lease ghi journal; mọi bên khác chỉ ghi `control/` rồi launch runner". Quy tắc này đơn giản hơn mã hiện tại và loại bỏ được B4.
3. **Ma trận giao kết quả theo GUI**, kèm Windows toast cho người dùng (B7). Đây là phần còn thiếu lớn nhất để đạt tiêu chí "mượt".
4. **`subagent_run`** (sync-if-fast), và `wait` trả kèm summary (B7). Giảm số vòng model cho việc ngắn.
5. **`orch doctor`:**
   - Kiểm phân giải lệnh (B1).
   - Đọc cờ Job Object (B11).
   - Kiểm MCP server có được GUI nạp hay không.
   - Thử ghi và đổi tên file trong `ORCH_HOME` (antivirus).
   - Không chạy backend.
6. **Golden transcript:** khi người dùng được phép chạy backend thật, ghi lại `raw.jsonl` mẫu của từng backend (thành công, auth, rate limit, cancel) vào `test/fixtures/` và chạy `parseLine`/`classifyExit` trên đó. Hiện ba adapter thật chỉ được test bằng dòng JSON tự soạn.
7. **Đơn giản hóa r1:**
   - Tạm bỏ nhánh MCP Tasks tự viết cho đến khi có SDK (B8). Mã chết gây hiểu nhầm.
   - Bỏ `fake` khỏi `defaultAdapters()` trong bản phát hành. Hiện `normalizeSpec` vẫn nhận `backend:'fake'` từ MCP.
8. **Không cần thay đổi:** không cần SQLite ở r2 (store file là đủ nếu B3/B4 được sửa), và không cần daemon.

---

## D. Kết quả tôi tự chạy

Môi trường: Windows 11, Node v26.13.0. Script nằm trong scratchpad của phiên, không nằm trong repo.

| Mã | Việc | Kết quả |
|---|---|---|
| T | `node --test test/` trong `src/` (chạy 2 lần) | 28/28 pass, khoảng 10,5–11,5 giây. Khớp README |
| P1 | In `final-schema.json` mà adapter Codex sinh ra | `outputs={"type":"object"}` (không có `additionalProperties`); `artifacts.items` chỉ cho phép `path` (B2) |
| P2 | `resolveCommand('npm')`; spawn `npm`; quote qua shim `.cmd` giả (đường dẫn có "Firstname Lastname") | Trả `C:\Program Files\nodejs\npm` (không đuôi), spawn cho ENOENT (B1). `{"d":"a & echo INJECTED_MARKER"}` bị cắt và **lệnh echo chạy**; dấu cách, `%PATH%`, `""` qua đúng (B17) |
| P3-A | Backend thoát 0 và im lặng | `status=succeeded format=degraded summary="" error=bad_output` (B5) |
| P3-C | `followup` rồi `wait` ngay (launcher trễ 300ms) | `wait` trả ngay `succeeded` và result cũ (B14) |
| P4a | 2 tiến trình × 150 `append` | 301 sự kiện, 40–99 `seq` trùng (3 lần chạy) (B4) |
| P4b | Lease stale (pid chết) và 2 runner đồng thời, 15 lần | 8–11/15 lần **cả hai chạy backend** (3 lần chạy) (B3) |
| P5 | Named pipe: listen trùng tên; connect; `taskkill /F` | `EADDRINUSE`; connected; sau khi kill thì `ENOENT` và listen lại OK (đề xuất C1) |
| P6/P7 | `IsProcessInJob` và `QueryInformationJobObject`; thử `CREATE_BREAKAWAY_FROM_JOB` | Không detached: job 0x3C00 (libuv). Detached: job host 0x0, breakaway bị từ chối (lỗi 5) (B11) |

Kiểm tra bằng cách đọc mã (không chạy): B6, B7, B8, B9, B10, B12, B13, B15, B16, B18, B19, B20–B24.

---

## E. Các điểm bất đồng cần bên thiết kế trả lời, kèm điều kiện để tôi chấp nhận

| # | Điểm | Điều kiện để tôi chấp nhận ("thống nhất") |
|---|---|---|
| E1 | Lease và một writer (B3, B4) | Có cơ chế loại trừ được chứng minh bằng test đa tiến trình: tái chạy P4b ≥ 50 lần cho 0 lần chạy đôi; P4a cho 0 `seq` trùng. Hub không còn append sau `task.created`, hoặc có lập luận vì sao an toàn. Chọn named pipe hay file kèm fencing là quyền bên thiết kế |
| E2 | Thành công giả (B5) | Bất biến `succeeded ⇒ error==null && summary!==''` được thêm vào test; trường hợp exit 0 im lặng cho ra `failed` (sau tối đa 1 lần thử lại) |
| E3 | Phân giải lệnh và quoting (B1, B17) | Test với thư mục shim giả (`x`, `x.cmd`, `x.ps1`) chọn đúng `.cmd`/`.exe`; test chèn lệnh của P2 không còn thực thi lệnh thứ hai |
| E4 | Schema strict cho Codex (B2) | Test bất biến strict pass, `description` được phép trong artifacts, có fallback khi bị từ chối schema. Hoặc bên thiết kế dẫn nguồn cho thấy `--output-schema` không ở strict mode |
| E5 | Kênh thông báo (B6, B7) | Có ma trận giao kết quả theo GUI (đánh thức phiên idle / cần người gõ / orchestrator chặn), inbox không phá hủy với cursor theo người tiêu thụ, và hook không chạy trong worker. Tôi chấp nhận nếu bên thiết kế lập luận được rằng việc người dùng gõ prompt để nhận kết quả là chấp nhận được với Codex/Antigravity, **miễn là** có thông báo cho người (toast hoặc tương đương) |
| E6 | MCP Tasks và phiên bản giao thức (B8) | Server chỉ quảng bá phiên bản mà nó hiện thực. Nếu nhận 2026-07-28 thì phải xử lý `_meta` theo từng request và `server/discover`, nếu không thì từ chối hoặc hạ cấp có kiểm soát. MCP Tasks: hoặc bỏ khỏi r2, hoặc hiện thực bằng SDK có test với SDK client. Bên thiết kế dẫn nguyên văn nguồn cho câu "Claude Code v2.1.304+ hỗ trợ" |
| E7 | Chống đệ quy (B9) | Có ít nhất một lớp không phụ thuộc env cho Codex (cấu hình `-c` hoặc kiểm tổ tiên tiến trình), cộng trần toàn cục `ORCH_MAX_ACTIVE`. Hoặc dẫn nguồn cho thấy Codex truyền nguyên env cho MCP server |
| E8 | Job Object (B11) | Tài liệu cập nhật theo kết quả đo (runner detached thoát khỏi job libuv; host Claude Code có job 0x0 cấm breakaway) và có kế hoạch đo "đóng GUI" cho từng GUI qua `orch doctor`. Tôi **không** yêu cầu launcher breakaway ở r2 nếu đo cho thấy không cần |
| E9 | Backend mồ côi và poison pill (B10, B12, B13) | Khi tiếp quản task, kill cây của pid cũ đã xác thực; trần interruption tính từ journal; `wait` không treo với task `stale` |
| E10 | Followup và turn (B14) | `wait` sau `followup` không bao giờ trả kết quả của lượt trước (thêm test như P3-C) |
| E11 | Quyền và denials (B18, B19) | Có `access` read/write cùng fail-fast khi chưa có policy ghi; facade lọc trường không khai báo; policy quyết định argv cuối cùng |
| E13 | `--bare` thành mặc định của `-p` (B24a) | Có trong danh sách rủi ro §6 kèm phương án dự phòng và cách phát hiện (thông báo `auth` nêu đúng nguyên nhân) |
| E12 | Watchdog với tool dài (B15), interrupt sạch (B16) | Mức "vừa": chấp nhận nếu đưa vào danh sách r2 kèm giả định rõ. Không bắt buộc làm ở r2 |

Những điểm tôi **đồng ý giữ nguyên** và không mở lại: QĐ1, QĐ2 (trừ chi tiết B1/B2/B17), QĐ3 không daemon, QĐ6, QĐ8, QĐ9, QĐ10, QĐ11, QĐ13, trần 50 giây.

---

## F. Đề xuất truy vấn bổ sung cho notebook (người điều phối quyết định)

Notebook đã trả lời được: strict mode của `--output-schema`, hook chạy trong `-p`, `--permission-prompts none`, MCP 2026-07-28 stateless, `codex app-server`, Codex exec thoát 0 khi lượt bị từ chối. Các chỗ còn thiếu nguồn:
1. "MCP Tasks extension schema: tool-level taskSupport annotation and CreateTaskResult exact JSON; which clients (Claude Code version) send task-augmented tools/call".
2. "codex-rs MCP stdio server environment inheritance whitelist (DEFAULT_ENV_VARS) and default tool_timeout_sec / startup_timeout_sec".
3. "Claude Code stream-json control_request interrupt exact message format; result event permission_denials field".
4. "codex app-server protocol reference: turn/interrupt, thread/resume, generate-json-schema, Windows support".
5. "Windows host applications (Electron, VS Code, Claude desktop, Codex app) terminating Job Objects on exit; WMI Win32_Process.Create environment and job behavior".
6. "Antigravity CLI agy headless issue #76 stdout pipe non-TTY; status WAITING semantics; Antigravity IDE MCP config and hooks".
