# 08 – Phản biện vòng 3.1 (xác nhận chốt)

Nhãn: [ĐKC: nguồn] = đã kiểm chứng (số đo của tôi hoặc dòng mã); [SL] = suy luận; [KC?] = cần kiểm thêm.
Mức: chặn / nghiêm trọng / vừa / nhẹ.
Phạm vi: đọc `07-design-r3.1.md` và mã `src/` bản 0.3.1-r3.1, tự chạy lại test và probe. Không chạy backend thật, không sửa mã hay tài liệu của bên thiết kế.
Probe nằm ở `scratchpad\probes\r3\` (j2, j2c2, j3–j8, j10, j10b, j11–j14, f4, t1).

## 0. Kết luận

**ĐÃ THỐNG NHẤT chốt kiến trúc.**

- F1–F5 đều đã đóng; tôi tự đo lại, không dựa vào báo cáo.
- r3.1 có đưa vào lỗi mới, nhưng không lỗi nào ở mức chặn hay nghiêm trọng:
  - P1 (vừa): `.bad` giữ 24h kể cả khi lỗi chỉ là tạm thời.
  - P2–P4 (nhẹ).
- Cả bốn đều là tham số hoặc heuristic của phần cài đặt, không đụng đến kiến trúc. Nên sửa trong một bản vá nhỏ (r3.2) hoặc gộp vào r4.

## 1. Kết quả tự chạy

| Kiểm | r3 (06) | r3.1 (tôi đo) |
|---|---|---|
| `npm test` ×3 | – | **104/104 ×3** (60.1 s / 52.9 s / 52.4 s) |
| J4: pipe có DACL hạn chế thật (PowerShell `PipeSecurity`) | `null`+EPERM, 3 launch/16 s, kẹt `queued` | `probeLease → {alive:'foreign', code:'EPERM'}`; `wait` trả `runner_failed` sau **6 ms**, **0 launch**, `error.class=lease_permission` |
| J2-c / j2c2: exe 0 byte trong cache | `failed`, EFTYPE ×3 | `ensureJobrun` biên dịch lại (843 ms, 9216 B, `exec_ok:true`). Exe hỏng lúc chạy thì task `succeeded` sau 160 ms, kèm `warnings:["jobrun_unavailable"]` và `.bad`; 0 `attempt.failed` |
| J10 / J10b: xong → followup → cancel → `wait(min_turn:2)` | treo tới timeout | trả về sau 4–5 ms, `min_turn_unreachable:true`, có `cancel:{at,dropped}` |
| j14: các biên của F2 | – | Followup B mới đang chờ: **không** báo nhầm unreachable (`pending=1`). Sau khi B chạy: turn 2, `cancel=null`. `until_followup(B)` đạt. Followup C bị bỏ rồi `min_turn:3`: unreachable đúng |
| f4 (của bên thiết kế, tôi chạy lại) | – | 6/6 đúng mô tả: không có mục thì không có `-c`; dự án chưa trusted thì không tính `.codex` |
| j11a: JOB_LIST, `ORCH_HOME`/cwd/script Unicode + khoảng trắng | – | stderr `[jobrun-debug] joblist`; exit 3 giữ nguyên; cháu detached **bị giết**. Với `NO_JOBLIST=1`: `suspended`, cháu cũng bị giết |
| j11b: exe rác (không 0 byte), đường dẫn có khoảng trắng | – | Tự kiểm hỏng → xóa → biên dịch lại → `exec_ok:true` (1.7 s) |
| j11c: **khóa exe tạm thời 6 s** (mở không chia sẻ, giả lập AV đang quét) | – | **`.bad` ngay (15 ms, EBUSY)**, không biên dịch lại. Hết khóa, tiến trình mới vẫn nhận `exe:null` → **P1** |
| j12: cwd mất, jobrun tốt | – | Lớp `config` (ENOENT), **không** ghi `.bad`, không lùi: không che lỗi thật |
| j11e/f: thứ tự sự kiện | progress sau `attempt.exited` | `progress@1` luôn đứng **trước** `attempt.exited@1` (0 vi phạm). Lỗi spawn đồng bộ thì `jobrun.unavailable` đứng trước `attempt.started` duy nhất, không bị trùng |
| J5: normCwd 8.3/junction | 3 kết quả khác nhau | 1 kết quả; idem chỉ tạo 1 lần |
| J6a: runner chậm 7 s / 12 s | `runner_failed` giả | không còn `runner_failed`; 2–3 launch (có throttle) |
| J8c / J8d | `ensureJobrun` ném lỗi; `denied:87` | `exe:null` kèm lỗi có cấu trúc, doctor không crash. Thiếu ComSpec vẫn trả JSON đúng |
| J3, J7 (hồi quy) | đạt | vẫn đạt |
| t1: TOML, 20 dạng | – | 13 đúng, 7 sai → P2/P3 |

## 2. F1–F5

| # | Trạng thái | Bằng chứng |
|---|---|---|
| F1 lease `foreign` | **Đóng** | J4 [ĐKC: số đo]; `hub.mjs:164`, `runner.mjs:78-81`. Ngữ nghĩa còn một điểm nhẹ, xem P4 |
| F2 `min_turn` | **Đóng** | J10b, j14 [ĐKC]. MCP schema đã bỏ `min_turn` (`r31.test.mjs:142`) |
| F3 jobrun tự kiểm + đường lùi | **Đóng**, còn P1 | j2c2, j11b–c, j12 [ĐKC] |
| F4 `-c` chỉ cho mục có thật | **Đóng** với dạng chuẩn (`codex mcp add` ghi `[mcp_servers.X]`), còn P2/P3 | f4, t1 [ĐKC] |
| F5 `ensureJobrun` không ném | **Đóng** | J8c/d [ĐKC] |

Đường lùi **không che lỗi thật của backend** [ĐKC: `jobrun.mjs:103-110`, `runner.mjs:540-543`, j12]:

- Exe backend hỏng hoặc bị chặn trả 126/127, nằm ngoài 120–123, nên không lùi.
- cwd không tồn tại trả ENOENT trong khi exe vẫn còn, nên không lùi.
- Lỗi jobrun chỉ xảy ra **trước** khi backend chạy lệnh đầu tiên (spawn lỗi; 120–123 xảy ra trước Resume hoặc trước khi tạo tiến trình), nên chạy lại không lặp tác dụng phụ.

## 3. Lỗi mới do r3.1

**P1 – vừa – `.bad` 24h với lỗi tạm thời.**
- Bằng chứng [ĐKC: j11c]: lỗi `EBUSY` lúc tự kiểm dẫn tới `unlinkSync` thất bại (file đang bị khóa), rồi `markJobrunBad` ngay (`jobrun.mjs:215-216`). Hết khóa, `ensureJobrun` vẫn trả `exe:null` trong 24h.
- Cùng lối đó áp dụng cho `spawnSync` timeout 15 s, chẳng hạn Defender "block at first sight" giữ exe mới [SL]. Lúc chạy, `EACCES`/`EPERM`/`UNKNOWN` cũng ghi `.bad` 24h.
- Hậu quả: trong 24h, cancel/timeout **không giết** tiến trình nền của backend, tức lỗi Q10 quay lại. Dấu hiệu duy nhất là warning `jobrun_unavailable`.
- Cách sửa:
  - Tách hai loại lỗi.
    - **Tất định** (EFTYPE, biên dịch lỗi, tự kiểm trả exit ≠ 7 kèm `[jobrun]`): giữ TTL 24h.
    - **Tạm thời** (EBUSY, ETIMEDOUT/timeout, EAGAIN, EACCES/EPERM/UNKNOWN lúc chạy): TTL ngắn, khoảng 10 phút, kèm `count` để lùi dần. Hoặc thử lại một lần sau 1–2 s trước khi ghi.
  - `doctor` in ra `reason` và cách xóa (đã có trong thông điệp lỗi).

**P2 – nhẹ – heuristic `/mcp-server\.mjs/` dương tính giả.**
- Bằng chứng [ĐKC: t1-m, t1-n]: regex chạy trên **toàn bộ** thân mục, kể cả comment. Hai trường hợp đều nhận nhầm:
  - một server khác có comment nhắc tới `mcp-server.mjs`;
  - một server khác có script tên trùng (`.../github-mcp/dist/mcp-server.mjs`).
- Hậu quả: worker Codex mất lặng lẽ một MCP server không liên quan. `codex exec` không hỏng, vì mục đó có thật.
- Cách sửa:
  - bỏ comment trước khi so;
  - so với đường dẫn tuyệt đối thật của `src/bin/mcp-server.mjs` của hệ này (lấy từ `import.meta.url`, chuẩn hóa `/` và `\`, không phân biệt hoa thường);
  - ghi danh sách tên đã tắt vào `invocation.json` hoặc warning để người dùng thấy.

**P3 – nhẹ – dạng TOML chưa đọc, hoặc đọc sai** [ĐKC: t1].

Đã đọc đúng các dạng sau:
- khóa bare, `"…"`, `'…'`;
- khoảng trắng trong header; comment cuối header;
- bảng con `.env`; inline dưới `[mcp_servers]`; khóa chấm ở gốc;
- `args` nhiều dòng; CRLF+BOM; `[[…]]`.

| Dạng | Kết quả | Hậu quả |
|---|---|---|
| (i) khóa chấm **dưới** `[mcp_servers]` | bỏ sót | thiếu `-c`; chặn đệ quy chỉ còn tầng tổ tiên |
| (j) `mcp_servers = {…}` ở gốc | bỏ sót | như (i) |
| (s) inline nhiều dòng (TOML 1.1) [KC? Codex có nhận không] | không nhận ra mục hub | như (i) |
| (q) hub chạy qua wrapper (`orch.cmd mcp`) với tên khác | bỏ sót | như (i); đã có lối thoát `ORCH_CODEX_HUB_NAMES` |
| (o) chuỗi nhiều dòng `"""` chứa dòng `[mcp_servers.fake]` | tạo mục **ma** | `-c` cho mục không có thật, đúng kiểu hỏng mà F4 muốn tránh. Rất hiếm |
| `projects` inline hoặc khóa chấm | bỏ sót (bên thiết kế đã nêu) | thiếu `-c` |

Cách sửa rẻ:
- `doctor` cảnh báo khi có dòng chứa `mcp_servers` mà bộ đọc không tiêu thụ;
- bỏ qua nội dung nằm trong `"""`/`'''` khi quét header.

Không cần viết bộ đọc TOML đầy đủ.

**P4 – nhẹ – `foreign` bị coi là kết thúc.**
- Khi runner elevated **vẫn đang chạy tốt** mà hub thường hỏi, `wait` coi `runner_failed` là xong và trả ngay (`hub.mjs:164-168`, `done()`). Orchestrator có thể kết luận "hỏng" rồi spawn trùng.
- `ORCH_HOME` mặc định (`%LOCALAPPDATA%`) **giống nhau** cho GUI elevated và GUI thường của cùng user [SL; J4 đo bằng DACL tự dựng, không phải GUI elevated thật].
- Cách sửa: chọn một trong hai.
  - Thêm hậu tố mức quyền vào `ORCH_HOME` mặc định, ví dụ `default-admin`, để loại hẳn tình huống này.
  - Hoặc trả `status:'runner_foreign'`, không kết thúc, kèm `journal_status`.

**Đã kiểm, không phải lỗi:**
- `attempt.started` trùng không xảy ra khi spawn lỗi đồng bộ. Với spawn lỗi bất đồng bộ thì mỗi lần chạy có cặp started/exited riêng, và `lastAttemptExited` vẫn đúng.
- Progress được ghi trước `attempt.exited`.
- JOB_LIST hoạt động với đường dẫn Unicode.

## 4. Bất đồng còn lại

Không có điểm nào chặn chốt. Còn lại các điểm nhỏ tôi đề nghị đưa vào r3.2/r4:

- **P1:** phân loại lỗi tạm thời, TTL ngắn.
- **P2:** so đường dẫn thật thay cho regex trên thân mục.
- **P3:** doctor cảnh báo dòng `mcp_servers` không đọc được.
- **P4:** `ORCH_HOME` mặc định theo mức quyền.

Tôi chấp nhận các điểm bên thiết kế để lại ở §8: R1, `doctor` xét theo cwd của chính nó, M8-e, GC r4.

## 5. Danh sách kiểm tay cuối cùng

Giữ nguyên §7 của `07-design-r3.1.md`, cộng thêm 4 mục (★):

| GUI | # | Việc kiểm | Đạt khi |
|---|---|---|---|
| Mọi GUI | 0 | `subagent_doctor` trong chính GUI | `jobrun.exec_ok:true`, `codex_hub` đúng, `job_limits` ghi lại |
| Claude Code | 1 / 1b | Task `codex` ngắn khi config không có mục hub, rồi khi có mục hub (M4) | `succeeded`; `-c` chỉ xuất hiện ở 1b; worker không gọi `subagent_*` |
| | 2 | Đóng hẳn Claude Code 30 s, mở lại, `subagent_status` (R3) | `runner_alive:true` hoặc đã xong |
| | 3 | `orch wait --until-done` chạy nền, rồi cancel | Lệnh nền kết thúc, có lượt mới |
| | 4 | Hook `orch inbox --hook` | Đúng project, không lặp |
| Codex Desktop | 1 | Đóng thread/app, mở lại, `subagent_status` (R3) | Như trên; fail thì gửi `runner.log` |
| | 2 | Mục hub đặt tên khác | `disabled_for_workers` có tên đó |
| | ★2b | Có một MCP server **khác** mà script tên `mcp-server.mjs`, hoặc comment nhắc tới nó (P2) | `invocation.json` **không** có `-c` cho server đó |
| | ★2c | So `codex mcp list` (tự chạy tay) với `doctor.codex_hub.names` (P3) | Mục hub trong danh sách Codex nằm trong `names` |
| | 3 | Hai hook song song | Không lặp |
| Antigravity | 1 | Đóng/mở lại, `subagent_status` (R3) | Như trên |
| | 2 | `ORCH_CAPTURE_GOLDEN` với task antigravity (R4) | Không có `unknown_events` |
| | 3 | `ORCH_HOME` hỏng | Hook không chặn lượt |
| Mọi GUI | 1 | `start /b ping -n 600 127.0.0.1`, rồi cancel (AV thật) | Không còn `ping.exe` |
| | 2 | Lần chạy đầu: có `.exe` + `.ok`, không có `.bad` | Không có `jobrun_unavailable` |
| | ★2b | Nếu có `.bad`: đọc `reason`. Nếu là EBUSY hoặc timeout (P1), xóa `.bad` rồi chạy lại `doctor` | `exec_ok:true` sau khi xóa thì là lỗi tạm thời; báo lại cho bên thiết kế |
| | 3 | GUI elevated và GUI thường dùng chung `ORCH_HOME` | `runner_failed/lease_permission`, không kẹt `queued` |
| | ★3b | Như 3, nhưng task do GUI **elevated** spawn và đang chạy, GUI thường `wait` (P4) | Ghi lại: GUI thường có báo `runner_failed` trong khi task vẫn chạy và xong không |
| | 4 | Subagent khởi động dev server | Server dừng khi subagent xong (M7) |
