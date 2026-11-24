# 04 — Phản biện vòng 2 cho `03-design-r2.md` và mã `src/` (0.2.0-r2)

> Người viết: phản biện viên. Phạm vi: chỉ `system-by-claude/` (tài liệu 03 và `src/`). Tôi không chạy backend thật nào: không `claude`, `codex`, `agy`, kể cả `--version`. `orch doctor` chỉ phân giải đường dẫn và đọc file shim, không thực thi backend.
> Nhãn dùng trong tài liệu này:
> - **[ĐKC: nguồn]** là đã kiểm chứng, kèm nguồn. Nguồn là phép thử tôi tự chạy (ký hiệu Q1…Q10, xem mục D) hoặc notebook.
> - **[SL]** là suy luận từ việc đọc mã.
> - **[KC?]** là không chắc.
>
> Mức độ giữ như vòng 1: **chặn**, **nghiêm trọng**, **vừa**, **nhẹ**.
> Các lỗi mới do r2 đưa vào được đánh số **N1…N14**. Các mục B của vòng 1 được đối chiếu lại ở mục B.0.

---

## Tóm tắt điều hành

r2 sửa được phần lõi mà vòng 1 coi là chặn hoặc nghiêm trọng. Tôi đã tự chạy lại và xác nhận các điểm sau.

- **Lease bằng named pipe loại trừ thật.**
  - Hai tiến trình tranh một tên: bên thứ hai nhận `null` sau 2 ms.
  - Holder bị kill thì probe trả `ENOENT` ngay và chiếm lại được.
  - 5 vòng, mỗi vòng 30 `runner-main` trên cùng một task `slow` (20 chạy cùng lúc, 10 chen vào giữa chừng): mỗi vòng đúng 1 `attempt.started`, `seq` liền mạch.
  - Nguồn: Q1, Q2.
- **Quy tắc một writer giữ được.** Ngoài `runner.mjs` không có chỗ nào gọi `openJournal` hay `append`.
- **Phân giải lệnh và quoting đúng.**
  - 10/10 ca P2 mở rộng round-trip nguyên vẹn khi đi qua `cmd.exe` thật.
  - 10/10 ca cũng đúng khi đi qua shim npm theo mẫu cmd-shim hiện hành, trong thư mục có tên `orch q6 dir %x% & (y)`.
  - Nguồn: Q6.
- **Schema strict đúng với các dạng thường gặp.** Nguồn: Q7.
- **`npm test`: 56/56 pass**, chạy 3 lần.

Tuy vậy, mã mới của r2 đưa vào bốn lỗi mà tôi coi là nghiêm trọng với tiêu chí "liền mạch". Cả bốn đều tái hiện được bằng phép thử:

1. **N1 — Hủy không hủy được followup đang chờ.**
   - Người dùng gửi followup rồi `cancel`. Runner ghi `task.completed{cancelled}`, nhận followup, rồi **chạy trọn một turn mới** và kết thúc `succeeded` (Q3-A, Q3-B).
   - Lệnh hủy là công cụ an toàn, nhất là với task ghi file.
2. **N2 — Thông báo bị mất hoặc lặp.**
   - Có hơn 10 thông báo chưa đọc thì 5/15 bị mất vĩnh viễn.
   - Ba runner ghi đồng thời và một hook đọc liên tục: mất 8/900.
   - Hai hook cùng phiên đọc đồng thời: lặp 200/200.
   - Nguồn: Q4.
3. **N3 — Runner không khởi động được thì hệ thống lặp vô hạn trong im lặng.**
   - Hub relaunch mỗi 5 giây. `status` báo `queued` và `failure:null`.
   - `orch wait --until-done`, kênh đánh thức Claude Code, **không bao giờ kết thúc** (Q9).
4. **N4 — Tiếp quản có thể giết nhầm cây tiến trình.**
   - Runner mới kill pid của attempt **đã thoát** khi task đang `waiting_retry`.
   - Dung sai 10 giây, trong khi độ lệch đo được là ≤ 7 ms. Với PID bị tái sử dụng, nạn nhân là một tiến trình không liên quan và cả cây con của nó, vì kill dùng `taskkill /T /F` (Q8).

Về D1–D7:
- **Chấp nhận:** D1 (hoãn SDK/Tasks), D2 (hoãn interrupt), D6 (không FIFO).
- **Giữ ý kiến:**
  - D4: điều kiện đóng của bên thiết kế đã đạt. Q10 cho thấy "cháu" của backend sống sót sau `killTree` và sau khi runner thoát.
  - D5: đã có hai kịch bản cụ thể ở Q5.
- **Còn mở, cần nguồn:** D3.
- **D7:** chấp nhận hoãn, kèm biện pháp giảm rủi ro không cần chạy backend (E-D7).

---

## A. Điểm đã thống nhất (đóng, không mở lại)

1. **Kiến trúc tổng thể giữ nguyên** như vòng 1 đã đồng ý: MCP facade, runner detached, store trên đĩa, phân loại lỗi, resume phiên. Không daemon, không SQLite (C8).
2. **B3/C1: lease bằng named pipe** (cả slot). Tôi rút đề xuất lease bằng file kèm fencing.
   - [ĐKC: Q1, Q2] Loại trừ giữa tiến trình đúng. Kill holder thì lease nhả ngay. Holder bị chặn event loop 2,5 giây thì probe trả `unresponsive`, không trả `false`, nên không bị coi là stale. Thiết kế này đúng.
3. **B4/C2: một writer.** [ĐKC: grep + Q2] Hub chỉ ghi `task.json` và `control/`. Janitor cho cancel là cách gọn.
4. **B1, B17: phân giải lệnh và quoting.** [ĐKC: Q6, doctor]
   - Thư mục có `tool`, `tool.cmd`, `tool.ps1` thì chọn `.cmd`.
   - Đối số xuống dòng bị từ chối khi đi qua `cmd.exe`. Khi đi qua shim npm, đối số xuống dòng truyền nguyên vẹn vì không còn đi qua `cmd.exe`.
   - `doctor` trên máy này: `claude` → `claude.exe` direct, `agy` → `agy.exe` direct, `codex` không có trong PATH.
   - Còn lại nhánh `.ps1`, xem N8.
5. **B2: strict schema cho các dạng thường gặp.** [ĐKC: Q7]
   - `none`/`simple`/`nested`/`enum` không `type`/`anyOf`-object/`type:['object','null']` đều thỏa bất biến.
   - Round-trip null tùy chọn → `dropOptionalNulls` → validate: OK.
   - Còn lại các dạng ít gặp, xem N9.
6. **B5: bất biến envelope.** [ĐKC: đọc mã + test]
   - `makeEnvelope` ném lỗi khi vi phạm bất biến.
   - Summary chỉ có khoảng trắng bị validator từ chối (Q7).
   - `no_output` thử lại đúng 1 lần.
7. **B8: chỉ quảng bá phiên bản hiện thực được.** `server/discover` trả -32601. `_meta` không hỗ trợ trả -32602 kèm `data.supported`. [ĐKC: test MCP stdio]
8. **B9: lớp tổ tiên tiến trình cộng `ORCH_MAX_ACTIVE`.** Chi phí đo được khoảng 0,9 giây cho một lần CIM. Lần gọi được cache trong Hub nên chấp nhận được (Q8-c).
9. **B11: tài liệu Job Object theo số đo.** [ĐKC: tôi đo lại]
   - Tiến trình tạo qua WMI cũng `inJob=True`, với cha là `WmiPrvSE`. Tôi đồng ý với phát hiện của bên thiết kế.
   - PowerShell 5.1 detached không chạy script: khớp với quan sát của tôi ở vòng 1.
   - Toast chạy không detached và runner chờ `flushToasts` là đúng.
10. **B12 (poison từ journal), B15 (tool_idle), B18 (`access` + fail-fast), B19 (lọc trường + `finalize_argv`), B21, B22, B24a, B24.** Đọc mã khớp với tài liệu. Test có và pass.
11. **D1, D2, D6** (lý do ở mục E).
12. **Tiêu chí hiển thị:** `wait` trả kèm summary; `subagent_run` sync-if-fast; poke qua pipe cho cancel tức thời.

---

## B. Đối chiếu "đã sửa" và lỗi mới

### B.0 — Bảng đối chiếu từng điểm vòng 1

| # | Bên thiết kế | Tôi xác minh | Kết luận |
|---|---|---|---|
| B1 | ✅ | Q6 + doctor | **Đạt** |
| B2 | ✅ | Q7 | **Đạt** với dạng thường gặp; còn lỗ hổng `oneOf`/`allOf`/`$ref`/tuple (N9, nhẹ) |
| B3 | ✅ | Q1, Q2: 5×30 runner, 0 chạy đôi | **Đạt** |
| B4 | ✅ | grep, Q2 | **Đạt** |
| B5 | ✅ | test; đọc adapter | **Đạt.** Lưu ý: lượt Codex bị từ chối mà có text từ chối sẽ ra `succeeded` + `degraded` (N14) |
| B6 | ✅ | Q4 | **Chưa đạt**: cursor mất/lặp thông báo (N2) |
| B7 | ✅ | Q9 | **Đạt một phần**: `--until-done` không có lối ra khi runner không khởi động được (N3) |
| B8 | ◐ | test | **Đạt** cho phạm vi r2 |
| B9 | ✅ | Q8-c | **Đạt** |
| B10 | ✅ một phần | Q8, Q10 | **Chưa đạt**: kill nhầm khi `waiting_retry` (N4); cháu sống sót (N5 = D4) |
| B11 | ✅ | đo lại | **Đạt.** Doctor đo tốt hơn được (N12) |
| B12 | ✅ | Q9 | **Đạt một phần**: không bao phủ việc runner chết **trước** khi ghi journal (N3) |
| B13 | ✅ | Q9 | **Chưa đạt**: tự chữa thì có, nhưng không bao giờ báo lỗi (N3) |
| B14 | ✅ | Q3-D | **Đạt** ở đường thường. Có cửa sổ race nhỏ (N10) |
| B15 | ✅ | test | **Đạt** |
| B16 | ⏭ | — | Chấp nhận hoãn (D2) |
| B17 | ✅ | Q6 | **Đạt** |
| B18 | ✅ | đọc mã | **Đạt** |
| B19 | ✅ | test MCP | **Đạt** |
| B20–B22 | ✅ | đọc mã | **Đạt** |
| B23 | ◐ | Q5, đọc mã | **Chưa đạt**: store dùng chung có va chạm (N6); `ORCH_HOME` fallback lệch (N11) |
| B24a, B24 | ✅ | đọc mã | **Đạt** |

### N1 — [nghiêm trọng] `cancel` không hủy followup đang chờ: sau khi "hủy", subagent chạy tiếp trọn một turn mới

- **Bằng chứng [ĐKC: Q3].**
  - Q3-A: task đã `succeeded` → `followup('lam them X')` → `cancel` (trả `cancel_requested`) → runner chạy. Journal:
    `task.completed:succeeded > followup.accepted > attempt.started > … > task.completed:succeeded`.
    Cancel bị xóa im lặng: nhánh `TERMINAL → clearCancel` ở `runner.mjs:168-170`, rồi followup chạy.
  - Q3-B: task `slow` đang chạy → `followup` → `cancel`. Turn 1 bị kill đúng (`task.completed:cancelled`). Sau đó `runTaskLoop` thấy `pendingFollowups>0`, chạy **turn 2 đầy đủ**, và kết quả cuối là `succeeded`.
- **Hậu quả.**
  - Orchestrator hoặc người dùng tin là đã dừng, nhưng worker vẫn chạy thêm, có thể ghi file.
  - `wait` trả `succeeded` cho một task đã hủy.
  - Với task `access=write`, đây là lỗi an toàn chứ không chỉ là lỗi trải nghiệm.
- **Sửa.**
  - Định nghĩa: cancel hủy **mọi** yêu cầu có `at ≤ cancel.at`.
  - Khi runner xử lý cancel, cả ở nhánh TERMINAL lẫn nhánh đang chạy:
    - chuyển các `followup-*.json` có `at ≤ cancel.at` sang `control/dropped/`;
    - append `followup.dropped{count}` trước khi `clearCancel`.
  - `hasWork()` phải bỏ qua followup đã bị hủy.
  - Test: hai kịch bản Q3-A và Q3-B phải cho `cancelled`, `turn` không tăng, 1 `attempt.started`.

### N2 — [nghiêm trọng] Cursor thông báo làm mất và lặp thông báo

- **Bằng chứng [ĐKC: Q4].**
  - **(a)** 15 thông báo chưa đọc, `max=10`: lần đọc 1 trả 10 thông báo, lần 2 trả 0. **Mất 5.**
    - Nguyên nhân: `readNotifications` đẩy cursor tới phần tử **cuối của toàn bộ** `fresh`, nhưng chỉ trả `items.slice(-max)`, tức 10 phần tử **mới nhất** (`store.mjs:169-170`).
    - Fan-out 12 task khi người dùng đang bận là đủ để gặp.
  - **(b)** Tên file mang timestamp lúc **sinh tên**, không phải lúc `rename` xong.
    - Thông báo A (t) rename xong sau B (t+5ms) mà reader đã đọc B, thì A nằm dưới cursor và **mất vĩnh viễn**.
    - Stress thật (c): 3 tiến trình ghi tổng 900 thông báo, 1 reader đọc liên tục: **mất 8/900**, không lặp.
  - **(d)** Hai reader cùng consumer chạy đồng thời: tổng 400, khác nhau 200, **lặp 200**.
    - Ví dụ: hook `UserPromptSubmit` và `SessionStart` cùng lúc, hoặc nhiều hook song song của Codex như bên thiết kế nêu.
- **Hậu quả.**
  - Với Codex/Antigravity, hook là kênh giao kết quả chính (§2.6). Mất thông báo nghĩa là orchestrator không bao giờ biết task xong, trừ khi tự `list`.
  - Lặp thông báo gây chèn context trùng.
- **Sửa** (không cần dependency):
  1. Trả **cũ nhất trước** (`items.slice(0, max)`). Chỉ đẩy cursor tới phần tử cuối **đã trả**.
  2. Cursor có thêm `seen`: tên file trong cửa sổ lookback, ví dụ 30 giây. Mỗi lần đọc quét lại các tên `≥ last − 30s` và bỏ qua những tên đã có trong `seen`.
  3. Khóa theo consumer bằng chính named pipe: `acquireLease(root, 'cursor-'+consumer)`. Không chiếm được thì chờ ≤ 300 ms rồi bỏ qua (hook in rỗng).
  4. Test: tái chạy Q4 (a)–(d), yêu cầu 0 mất và 0 lặp.

### N3 — [nghiêm trọng, liền mạch] Runner không khởi động được thì hệ thống relaunch vô hạn và không báo lỗi; `orch wait --until-done` treo mãi

- **Bằng chứng [ĐKC: Q9].**
  - Đặt `ORCH_POLICY` trỏ tới file không tồn tại để `loadHooks` ném lỗi, rồi `spawn` và `wait(16s)`.
  - Kết quả: `timed_out=true`, `status=queued`, `runner_alive=false`, 4 lần launch. `status()` trả `{stale:true, failure:null}`.
  - `runner.log` có 44 dòng lỗi `ERR_MODULE_NOT_FOUND` nhưng không có gì nổi lên tới orchestrator.
  - `orch.mjs:71` có vòng `while (flags['until-done'] && w.timed_out)` **không có deadline**. Đây là kênh đánh thức Claude Code (B7c), nên phiên Claude sẽ không bao giờ được đánh thức.
- **Nguyên nhân gốc.**
  - B12 đếm interruption **trong journal**, mà runner chết trước khi chiếm lease hoặc ghi journal thì không để lại gì.
  - Các nguyên nhân thực tế khác:
    - policy hỏng;
    - `ORCH_HOME` không ghi được;
    - node bị antivirus chặn;
    - EACCES ở pipe (N7);
    - module của `src` bị xóa hoặc đổi chỗ khi đang cập nhật.
- **Sửa.**
  1. Hub ghi `control/launch-<ts>` mỗi lần launch. Đây là file của hub, không phải journal, nên không vi phạm một writer.
  2. Runner-main khi khởi động ghi `runner.started` (file riêng, ngoài journal). Nếu lỗi trước khi chiếm lease thì ghi `runner.fatal.json{message}`.
  3. `status()` thấy ≥ 3 lần launch trong 60 giây mà không có `runner.started` mới hơn, hoặc thấy có `runner.fatal.json`: trả `status:'runner_failed'` kèm `error` (đuôi log). `wait` coi đó là "xong với lỗi". Ngừng tự chữa cho tới khi có `resume`.
  4. `--until-done` có deadline mặc định, ví dụ 2 giờ, và in kết quả `timed_out` rõ ràng.
  5. Test: kịch bản Q9 phải trả `runner_failed` trong ≤ 20 giây, và `orch wait --until-done` phải thoát.

### N4 — [nghiêm trọng, xác suất thấp, hậu quả cao] Tiếp quản kill pid của attempt đã kết thúc; dung sai 10 giây quá rộng; kill cả cây

- **Bằng chứng [ĐKC: Q8].**
  - (a) Độ lệch `CreationDate − spawned_at` trên 5 lần spawn: `-7, 0, 0, 0, -2` ms. Dung sai 10 000 ms rộng hơn khoảng 1000 lần mức cần.
  - (b) Tôi dựng journal `attempt.started{pid:P} → attempt.failed → retry.scheduled`, tức trạng thái `waiting_retry`: backend **đã thoát**, runner đang backoff thì chết. P là một tiến trình khác, có thời điểm tạo nằm trong cửa sổ, mô phỏng PID bị tái sử dụng.
  - Runner tiếp quản ghi `orphan:{killed:true}` và nạn nhân bị giết.
  - `runner.mjs:158-159` gọi `killVerifiedOrphan` cho cả `waiting_retry` và `interrupted`, mà journal không có sự kiện "attempt đã thoát".
- **Khi nào xảy ra thật [SL].**
  - Backend lỗi nhanh, ví dụ thoát sau 2–3 giây vì 503 hay 429. Windows cấp lại PID vừa được giải phóng khá sớm.
  - Runner chết trong lúc backoff: GUI đóng và host giết job, hoặc máy sleep.
  - Xác suất thấp, nhưng hậu quả là `taskkill /T /F` lên một tiến trình bất kỳ của người dùng **và cây con của nó**. Tiến trình đó có thể là chính GUI hoặc conhost.
- **Sửa.**
  1. Append `attempt.exited{code}` ngay sau `close`.
  2. Chỉ kill khi `attempt.started` cuối **chưa có** `attempt.exited` tương ứng (tức trạng thái `running`).
  3. Dung sai ≤ 1 giây. Tốt hơn nữa: ghi `creation_time` đo bằng CIM ngay sau spawn (bất đồng bộ, khoảng 0,8 giây, không chặn) và so khớp chính xác.
  4. Không khớp thì **không** kill, chỉ ghi cảnh báo.

### N5 — [vừa] (= D4) "Cháu" của backend sống sót sau `killTree` và sau khi runner thoát

- **Bằng chứng [ĐKC: Q10].**
  - Mô phỏng: runner (node) spawn backend (`cmd`, không detached, giống `spawnInvocation`). Backend chạy một tool qua trung gian `cmd /c start "" /b node sleeper` (trung gian thoát ngay) rồi tiếp tục chạy.
  - Sau `killTree(backend)`: `backend_alive=false`, `sleeper_alive=true`.
  - Sau khi runner **thoát**: sleeper **vẫn sống**.
  - Lý do [SL]: libuv đặt `SILENT_BREAKAWAY_OK` (0x1000; đã đo ở vòng 1: 0x3C00), nên cháu không thuộc job của runner. `taskkill /T` đi theo ParentProcessId, mà liên kết này đã đứt khi trung gian thoát.
- **Hậu quả.** Dev server, watcher hay tiến trình nền do tool của agent mở ra sẽ sống sau cancel, hang hoặc retry, và tiếp tục giữ port hoặc khóa file. Attempt sau xung đột với chúng. Kịch bản thường gặp với agent lập trình, ví dụ `npm run dev`, chạy nền, `start`.
- **Sửa (không cần npm).** Xem E-D4.

### N6 — [vừa] (= D5) Store dùng chung gây va chạm giữa các project

- **Bằng chứng [ĐKC: Q5].**
  - Project A và B cùng dùng `idempotency_key:'lint-1'`. B nhận **task của A** (`created:false`, `cwd` = projA), tức kết quả lint của project khác.
  - `ORCH_MAX_ACTIVE=3`: ba task của A làm B bị từ chối spawn.
  - [SL, đọc `orch.mjs:43-57`] `orch inbox --hook` chỉ lọc theo `run_id`, nên phiên trong project B nhận thông báo `succeeded` của task project A. Đây là ô nhiễm context, và summary là dữ liệu không tin cậy đến từ project khác.
- **Sửa** (giữ store chung, tôi đồng ý lý do 1–3 của bên thiết kế):
  1. Băm idempotency theo `sha256(resolve(cwd).toLowerCase() + '\0' + key)`.
  2. `ORCH_MAX_ACTIVE` giữ toàn cục, thêm trần theo project, ví dụ `ORCH_MAX_ACTIVE_PER_CWD`, mặc định bằng trần toàn cục.
  3. `orch inbox --hook` lọc theo `cwd` của hook. Hook nhận `cwd` trong stdin hoặc có `process.cwd()`. Lọc theo tiền tố đường dẫn của `task.cwd`. Tùy chọn `--all` để xem hết.

### N7 — [vừa] `EACCES` khi `listen` bị hiểu là "lease đang bị giữ"

- `lease.mjs:65-66`: `EACCES` được đối xử như `EADDRINUSE` và trả `null`. Runner trả `skipped:'lease_held'` rồi thoát im lặng. Phía hub, `probeLease` gặp lỗi connect khác `EBUSY` thì trả `alive:false`, nên hub relaunch mãi (rơi vào N3).
- Khi nào [KC?]: GUI chạy MCP server trong sandbox. Codex trên Windows dùng AppContainer/MXC cho lệnh, nhưng tôi không chắc MCP server có nằm trong sandbox hay không. Ngoài ra có chính sách bảo mật chặn named pipe.
- **Sửa.** `EACCES` thì ném lỗi `lease_permission` và ghi `runner.fatal.json` (N3). `doctor` đã có bước lease, nên chỉ cần thêm một dòng giải thích khi bước này thất bại.

### N8 — [nhẹ] Nhánh `.ps1` của `planSpawn` không bao giờ tới được, và nếu tới thì quote sai

- [ĐKC: Q6] `planSpawn('...\\tool.ps1')` với PATHEXT mặc định ném ENOENT, vì `.ps1` không có trong PATHEXT nên `resolveCommand` thử `tool.ps1.COM`, …
- Thêm `.PS1` vào PATHEXT để đi được nhánh này thì **5/10 ca sai**: PowerShell 5.1 bỏ `"` trong đối số và bỏ đối số rỗng. Ví dụ `{"a":"b c"}` thành `{a:b c}`.
- **Sửa.** Bỏ nhánh `.ps1`. Hoặc đọc shim `.ps1` của npm (cùng target như `.cmd`) để chạy `node <entry>`. Nếu người dùng chỉ định `.ps1` không phải shim npm thì từ chối và nêu lý do.

### N9 — [nhẹ] `isStrictable` bỏ lọt `oneOf`, `allOf`, `$ref`/`$defs` và tuple `items:[…]`

- [ĐKC: Q7]
  - `oneOf` và `allOf` còn nguyên trong schema strict. Hai từ khóa này không được strict mode hỗ trợ.
  - Object trong `$defs` không được strictify (thiếu `additionalProperties:false` và `required`).
  - Tuple `items:[{…}]` bị biến thành `{"0":{…}}`, tức schema rác.
- Hậu quả: Codex từ chối schema. Có fallback `native_schema.disabled`, nhưng tốn một attempt, và phụ thuộc regex `classifyExit` bắt được thông điệp lỗi. Nếu regex trượt thì task bị park `config`.
- **Sửa.** `isStrictable` trả `false` khi gặp `oneOf|allOf|not|if|$ref|$defs|definitions|patternProperties|prefixItems` hoặc `Array.isArray(items)`.

### N10 — [nhẹ] Cửa sổ race nhỏ quanh followup và snapshot

1. `takeFollowups` **xóa file trước** khi append `followup.accepted` (`runner.mjs:176-181`). Runner chết đúng giữa hai bước thì followup mất mà không có dấu vết.
   - Sửa: append `followup.accepted{files:[…], prompts}` trước, xóa file sau. Lúc khởi động, bỏ qua các file đã có trong journal.
2. `hub.followup` đọc `state.turn` **trước** khi enqueue (`hub.mjs:178-182`). Nếu runner nhận đợt followup trước đó đúng lúc này, `turn` trả về thấp hơn 1.
   - `pending_followups` che được phần lớn trường hợp. Còn hở cửa sổ giữa lúc xóa file và lúc append.
   - Sửa: trả `followup_id` (tên file) và cho `wait` nhận `until_followup`. Envelope liệt kê các `followup_id` đã xử lý.
3. `store.state()` luôn ưu tiên `state.json` (`store.mjs:92-95`), trái với chú thích "ưu tiên fold khi snapshot cũ hơn".
   - Runner chết sau khi append `task.completed` nhưng trước khi ghi snapshot: hub thấy `running` mãi.
   - Runner tiếp quản đi nhánh "đã kết thúc", không append gì nên không ghi lại snapshot.
   - Sửa: `Journal` constructor luôn ghi lại `state.json`, hoặc `state()` so `last_seq` với dòng cuối của journal.

### N11 — [nhẹ] `defaultRoot()` trên Windows rơi về `~/.local/state` khi thiếu `LOCALAPPDATA`

- Antigravity không truyền env cho MCP server stdio. Bên thiết kế ghi điều này ở §2.5. Nếu người dùng quên khai `LOCALAPPDATA`/`ORCH_HOME`:
  - MCP server dùng `C:\Users\<u>\.local\state\subagent-hub\default`;
  - hook `orch inbox` (có env) dùng `%LOCALAPPDATA%\…`.
  - Hai store tách nhau, và hook không bao giờ thấy thông báo.
- **Sửa.** Trên `win32`, fallback về `path.join(os.homedir(), 'AppData', 'Local')`, vì `os.homedir()` vẫn đúng khi thiếu env. `doctor` in `orch_home` và cảnh báo khi `LOCALAPPDATA` vắng. Ngoài ra env thiếu `PATH`/`SystemRoot` sẽ làm `resolveCommand` hỏng, nên `doctor` nên kiểm cả hai.

### N12 — [nhẹ] `doctor` đo được job của host, ngược với nhận định "không đo được từ bên trong"

- [ĐKC: tôi chạy lại P7 vòng 1 hôm nay] Chạy `cmd.exe /d /c powershell … jobinfo.ps1` **detached** thì PowerShell nằm trong job của host (không qua libuv). Kết quả đọc được qua `QueryInformationJobObject(NULL, BasicLimitInformation)`:
  `LimitFlags=0x0 KILL_ON_JOB_CLOSE=False`, `CREATE_BREAKAWAY_FROM_JOB` bị từ chối (lỗi 5).
- `Breakaway()` hiện tại của doctor chạy trong PowerShell **không detached**, nên chỉ thoát được job libuv (0x3C00 cho phép breakaway) và luôn ra `still_in_job`. Phép đo này không phân biệt được trường hợp nào.
- **Sửa.** `doctor` chạy script job qua `cmd /d /c powershell -File … -Out <file>` detached, rồi đọc file. Kết quả cho verdict rõ ràng:
  - `KILL_ON_JOB_CLOSE=false` thì runner sống khi host đóng handle;
  - còn rủi ro host chủ động gọi `TerminateJobObject`, rủi ro này vẫn cần kiểm thủ công.

### N13 — [nhẹ] Chi phí đồng bộ của CIM/PowerShell

- [ĐKC: Q8] `procCreationTime` mất khoảng 0,8 giây, `processAncestry` khoảng 0,9 giây. Cả hai dùng `spawnSync`, chặn event loop.
- Với runner: chỉ khi tiếp quản, chấp nhận được.
- Với `orch spawn` qua CLI (mỗi lần một tiến trình mới) khi có task đang chạy: mỗi lệnh +0,9 giây.
- Với hub MCP: một lần.
- **Sửa (khuyến nghị).** Dùng bản bất đồng bộ (`spawn` + await). Hoặc lọc `Get-CimInstance -Filter "ProcessId=…"` theo chuỗi cha từng bước, thay vì liệt kê mọi tiến trình.

### N14 — [nhẹ] Lượt bị model từ chối nhưng có text từ chối thì ra `succeeded/degraded`

- [SL, đọc `codex.mjs`] Nếu lượt từ chối (Codex #56875, exit 0) phát một `agent_message` chứa lời từ chối, `parseFinalMessage` sẽ hỏng. Runner repair một lần, rồi `finishDegraded` → `succeeded` + `warnings:['unverified_format']`.
- Orchestrator thấy `succeeded`.
- **Sửa.** `degraded` sau một repair thất bại thì để `status:'failed'`, `error.class:'bad_output'`, có `summary` là text thô. Hoặc ít nhất `wait`/`result` phải đưa `warnings` lên dòng đầu. Đây là quyết định chính sách; tôi chỉ yêu cầu ghi rõ trong tài liệu.

---

## C. Đề xuất bổ sung hoặc đơn giản hóa

1. **Một "sổ khởi động" cho runner** (N3): `control/launch-*` do hub ghi, `runner.started`/`runner.fatal.json` do runner-main ghi. Cùng một cơ chế giải quyết N3, N7 và phần còn hở của B12/B13.
2. **Khóa ngắn bằng named pipe cho mọi thao tác read-modify-write ngoài journal**, ví dụ cursor (N2) và idem. Đã có sẵn `acquireLease`, không cần thêm cơ chế.
3. **`attempt.exited`** (N4) cũng giúp `status` hiển thị đúng "đang backoff" hay "đang chạy".
4. **Hủy có ngữ nghĩa theo thời điểm** (N1): mọi yêu cầu trong `control/` có `at`. Cancel hủy những yêu cầu có `at ≤ cancel.at`.
5. **Canary parser** (giảm rủi ro D7, không cần backend):
   - mỗi attempt đếm số dòng không nhận dạng được và số `type`/`event` lạ, ghi vào envelope `warnings:['unknown_events:n']`;
   - attempt `exit 0` mà parser không nhận được sự kiện nào thì giữ `raw.jsonl` và ghi cảnh báo `parser_unrecognized`.
6. **Thu golden transcript từ lần dùng thật đầu tiên, khi người dùng cho phép:** `ORCH_CAPTURE_GOLDEN=1` chép `raw.jsonl` của attempt đầu tiên mỗi phiên bản backend vào `test/fixtures/golden/<backend>/<version>/`.

---

## D. Kết quả tôi tự chạy

Môi trường: Windows 11, Node v26.13.0. Script nằm trong scratchpad của phiên (`…/scratchpad/probes/r2/q*.mjs`), không nằm trong repo. Không phép thử nào chạy backend thật.

| Mã | Việc | Kết quả |
|---|---|---|
| T | `node --test "test/*.test.mjs"` (3 lần) | 56/56 pass mỗi lần, khoảng 40 giây |
| Q1 | Lease pipe: holder ở tiến trình khác; kill; 50 acquire song song; holder bị chặn 2,5 giây | null sau 2 ms; sau kill `ENOENT` và chiếm lại được; 1/50 thắng; `unresponsive` |
| Q2 | 5 vòng × (20 đồng thời + 10 chen giữa) `runner-main` trên một task `slow` | 5/5 vòng: 1 `attempt.started`, 1 `task.created`, `seq` liền, `succeeded` |
| Q3 | followup + cancel (A: sau khi xong; B: đang chạy); C: cancel task `needs_attention`; D: 2 followup | A, B: **turn 2 chạy, kết quả `succeeded`** (N1). C: `cancelled` đúng. D: `turn=2` đúng |
| Q4 | Cursor: (a) 15 > max; (b) rename trễ; (c) 3 writer × 300 + 1 reader; (d) 2 reader cùng consumer | (a) **mất 5**; (b) **mất**; (c) **mất 8/900**; (d) **lặp 200/200** (N2) |
| Q5 | Store chung: idem cùng key ở 2 project; MAX_ACTIVE | B nhận task của A; B bị chặn bởi task của A (N6) |
| Q6 | resolve/plan/quote: `tool`/`tool.cmd`/`tool.ps1`; shim npm mẫu cmd-shim; 10 bộ đối số; thư mục `%x% & (y)` | `.cmd` được chọn; cmd 0/10 sai; npm-shim 0/10 sai; xuống dòng: cmd ném lỗi, shim npm truyền đúng; `.ps1`: ENOENT, với PATHEXT+.PS1 thì **5/10 sai** (N8) |
| Q7 | Bất biến strict với 11 dạng schema; round-trip null | 8 dạng OK; `oneOf`, `allOf`, `$defs` vi phạm; tuple thành `{"0":…}`; dạng "object bất kỳ" tắt native đúng (N9) |
| Q8 | Độ lệch CreationDate; tiếp quản ở `waiting_retry` với pid "tái sử dụng"; chi phí CIM | lệch −7…0 ms; **nạn nhân bị kill** (N4); 0,8–0,96 s / 0,93 s |
| Q9 | `ORCH_POLICY` hỏng, `wait` 16 giây | `queued`, `failure:null`, 4 lần launch, 44 dòng lỗi chỉ có trong `runner.log` (N3) |
| Q10 | Cháu qua `cmd /c start /b` | sống sau `killTree` **và** sau khi runner thoát (N5/D4) |
| J | WMI `Win32_Process.Create` + `IsProcessInJob`; chạy lại P7 vòng 1 | WMI: `inJob=True`, cha `WmiPrvSE` (đồng ý với bên thiết kế). Detached qua cmd: host job `0x0`, breakaway lỗi 5 (N12) |
| Dr | `orch doctor --root <tmp>` | chạy được; `claude`/`agy` direct `.exe`, `codex` ENOENT; lease OK; job "không kết luận được" |

Kiểm tra bằng cách đọc mã (không chạy): N7, N10, N11, N14, B5 (adapter), B18–B22.

---

## E. Bất đồng còn lại và điều kiện chấp nhận

### E.1 — D1…D7 (tiền đề: vẫn **không** chạy backend thật, **không** thêm dependency npm)

| # | Lập trường của tôi | Lý do | Rủi ro còn lại nếu vẫn bị chặn | Giảm rủi ro tối thiểu (không cần quyền) |
|---|---|---|---|---|
| D1 SDK + MCP Tasks → r3 | **Chấp nhận.** Rút yêu cầu nêu kịch bản | Tôi không tìm được kịch bản mà Tasks giải quyết còn `run` + `wait` + Bash nền + hook thì không. Khoảng trống thật là **đánh thức phiên Codex/Antigravity đang idle**, và Tasks cũng không lấp được: client chỉ poll task trong lúc đang có lượt | Client tương lai bỏ fallback `initialize` (chỉ còn stateless 2026-07-28) thì hub mất kết nối | (1) Giữ test `server/discover`→-32601 và `_meta`→-32602. (2) Thêm fixture JSON-RPC viết tay theo spec 2026-07-28: request có `_meta` phiên bản hợp lệ, `tools/call` không qua `initialize`. Kiểm hub trả lỗi có cấu trúc chứ không treo. (3) Ghi R-tasks: "Tasks không giải quyết wake-up" |
| D2 interrupt sạch → r3 | **Chấp nhận** | Đổi Claude sang `--input-format stream-json` là đổi giao thức nhập prompt. Không có transcript thật thì rủi ro làm hỏng đường chính lớn hơn lợi ích | Cancel và hang = kill cứng; turn đang chạy mất (Claude 143); task ghi có thể để lại file dở | (1) Envelope `cancelled` của task `access=write` có `git status --porcelain` trước/sau (đã có `gitSnapshot`) và cảnh báo `killed_mid_write` khi khác nhau. (2) Tài liệu ghi rõ "cancel = kill cứng" |
| D3 `-c mcp_servers.<n>.enabled=false` | **Còn mở**, chờ nguồn | Đồng ý không thêm khi chưa có nguồn: sai khóa thì mọi lần chạy Codex hỏng. Lớp tổ tiên tiến trình đang làm thay và đo được (B9) | Worker Codex thấy hub, gọi được `subagent_*`; bị chặn bởi tổ tiên + MAX_ACTIVE | Đã có `finalize_argv`. Xem kết quả notebook ở mục F |
| D4 Job theo attempt → r3 | **Giữ ý kiến.** Điều kiện đóng của bên thiết kế **đã đạt** (Q10) | Cháu sống sau `killTree` và sau khi runner thoát | Tiến trình nền rò rỉ, giữ port/khóa, xung đột retry | **Không cần npm:** `Add-Type -OutputAssembly jobrun.exe -OutputType ConsoleApplication` (csc của .NET Framework có sẵn trên Win10/11) biên dịch một launcher C# khoảng 60 dòng. Launcher tạo job `KILL_ON_JOB_CLOSE` không cho breakaway, gọi `CreateProcess` với std handle kế thừa và dòng lệnh gốc giữ nguyên (lấy phần đuôi của `GetCommandLineW`, không quote lại), chờ, rồi trả nguyên exit code. Runner spawn `jobrun.exe <file> <args>` thay cho `<file>`. Kill `jobrun` thì OS đóng handle và giết cả job. Biên dịch một lần, cache theo hash nguồn. Fallback khi `Add-Type` bị chặn: quét cây bằng CIM theo chu kỳ (15–30 giây) trong lúc attempt chạy, rồi kill theo danh sách đã thấy [SL; cần thử] |
| D5 Store dùng chung | **Chấp nhận giữ store chung; giữ yêu cầu sửa N6** | Kịch bản bên thiết kế yêu cầu đã có (Q5): idem đụng nhau, MAX_ACTIVE chặn chéo, inbox lẫn project | Kết quả của project khác lọt vào context; task không chạy | 3 sửa đổi ở N6 |
| D6 Không FIFO slot | **Chấp nhận** | Quy mô ≤ 8 task, backoff ngẫu nhiên. Tôi không có số đo starvation | Một task chờ slot lâu bất thường | Ghi `slot.waiting{since}` một lần khi chờ quá 30 giây để `status` hiển thị được |
| D7 Golden transcript | **Chấp nhận hoãn**, với biện pháp tối thiểu | Không chạy được backend | Parser lệch định dạng thật: tool_start/end sai (B15), không nhận `final`, dẫn tới `no_output` hàng loạt | (1) Canary parser (C5). (2) Chế độ thu golden khi người dùng bật (C6). (3) Dùng các dòng ví dụ **nguyên văn** trong tài liệu chính thức (notebook trích được) làm fixture tạm, ghi rõ nguồn và nhãn "doc-derived" |

### E.2 — Điều kiện để tôi chấp nhận vòng 3

| # | Điều kiện | Gắn với |
|---|---|---|
| E1 | Q3-A và Q3-B cho `cancelled`, `turn` không tăng, 1 `attempt.started`; có sự kiện `followup.dropped` | N1 |
| E2 | Tái chạy Q4 (a)–(d): 0 mất, 0 lặp. Stress (c) chạy ≥ 3 lần | N2 |
| E3 | Kịch bản Q9 trả `runner_failed` kèm lỗi trong ≤ 20 giây; `orch wait --until-done` thoát; `EACCES` của lease không còn bị coi là "đang giữ" | N3, N7 |
| E4 | Có `attempt.exited`. Q8-b **không** kill. Dung sai ≤ 1 giây hoặc so khớp chính xác `creation_time` | N4 |
| E5 | Q10: cháu chết sau cancel. Hoặc bên thiết kế đo cho thấy `jobrun` không khả thi trên máy này và ghi rủi ro kèm phương án quét CIM | N5/D4 |
| E6 | Q5: idem tách theo cwd; trần theo project; inbox lọc theo cwd | N6/D5 |
| E7 | `isStrictable` từ chối `oneOf`/`allOf`/`$ref`/`$defs`/tuple; nhánh `.ps1` bỏ hoặc đi qua shim | N8, N9 |
| E8 | `followup.accepted` ghi trước khi xóa file; `state()` không kẹt ở snapshot cũ | N10 |
| E9 | `defaultRoot()` win32 fallback `AppData\Local`; `doctor` cảnh báo env thiếu; doctor đo LimitFlags của job host bằng đường detached qua cmd | N11, N12 |
| E10 | Tài liệu ghi chính sách `degraded` (N14) và "cancel = kill cứng" (D2) | N14, D2 |

Những điểm **chưa thống nhất** chỉ còn N1–N7 (bắt buộc), D3 (chờ nguồn) và D4 (đã đủ điều kiện, chờ phương án). Mọi điểm khác ở mục A coi như đã đóng.

---

## F. Truy vấn notebook

Tôi đã gửi hai câu hỏi bằng `chat_start` thường, không dùng research, trên notebook `61848f50…`. Sau khoảng 8 phút cả hai vẫn ở trạng thái `generating`, có lẽ vì notebook đang bận với research của người điều phối. **Chưa có câu trả lời**, nên D3 và các nhãn [KC?] liên quan vẫn để mở. Người điều phối có thể lấy kết quả bằng `chat_status` trong khoảng 30 phút, hoặc hỏi lại:

- `Q_WL0W6bArk` (Codex):
  1. khóa tắt một MCP server, và có override được bằng `-c mcp_servers.<n>.enabled=false` không (**đóng D3**);
  2. env mà Codex truyền cho MCP server stdio;
  3. giá trị mặc định của `tool_timeout_sec`/`startup_timeout_sec` (trần 50 giây);
  4. các trạng thái của `item.completed` (`declined`/`failed`/`rejected`), cần cho denials ở B18;
  5. hook `UserPromptSubmit`/`SessionStart`: stdout có được chèn vào context không, stdin có `session_id`/`cwd` không, có chạy song song không (N2-d, N6);
  6. sự kiện hoặc exit code khi model từ chối lượt (N14).
- `HJXR8xC63qM` (Antigravity):
  1. tên hook, stdin của hook (`conversationId`, `cwd`), stdout có được chèn vào context không;
  2. MCP server stdio là con của tiến trình `agy` hay của một daemon/language server, và có kế thừa env không. Câu này quyết định lớp chống đệ quy dựa trên tổ tiên tiến trình (B9) và N11;
  3. hình dạng **nguyên văn** của `step_update` cho tool, cần cho B15 và D7;
  4. cách hủy một lượt headless trên Windows, nơi không có SIGINT (D2).

Đề xuất thêm (người điều phối quyết định):

1. "Windows libuv `uv_spawn` job object flags `JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK`: grandchildren not in job". Câu này xác nhận lý do của Q10/N5.
2. "Claude Code: does `claude -p` spawn its MCP servers as direct children (process tree)". Câu này dùng cho B9 tổ tiên tiến trình.
3. "PowerShell `Add-Type -OutputAssembly -OutputType ConsoleApplication` availability on Windows 11 and Windows Defender/SmartScreen behavior for locally compiled exe". Câu này dùng cho phương án `jobrun.exe` của D4.
