# Nghiệm thu tối thiểu — GUI integration và inspect, bản 2

Ngày **29/10/2026**. Đi kèm [kế hoạch kiến trúc](plugin-integration-plan.md), [xác minh nguồn](gui-integration-validation.md) và [implementation 0.7.0](gui-integration.md). Software checks đã mở rộng; kết quả ở [GUI evidence](verification/gui-evidence.json). **Chưa chạy live GUI/model benchmark**. Evidence 204/204 của source 0.6.0 là baseline lịch sử. Plugin/MCP checks không áp dụng vì release chọn project entry + CLI; không suy chúng đã pass. CLI route vẫn qua scope/authorization/service contracts. Host loader/trust/inventory live và human layout review vẫn pending.

## 1. Nguyên tắc chọn kiểm tra

Kiểm tra deterministic cho mất dữ liệu, sai quyền/revision, chạy lặp, publication, accounting và recovery. Chỉ dùng model thật cho ranh giới host mà fake client không xác minh được. Ưu tiên một task thật tạo evidence cho nhiều tiêu chí; không biến task thật thành benchmark ngầm bằng cách thêm các thử nghiệm không phục vụ mục tiêu của người dùng.

Mọi deliberate live benchmark cần protocol cụ thể, source/config/model/environment digest và người dùng xác nhận riêng từng lần. Một approval không bao phủ các host hoặc rerun sau này. Software regression/metadata probe không inference là checks triển khai được phép. Không có ma trận toàn bộ role × model × backend × helper.

## 2. Coverage bắt buộc bằng phần mềm

| ID | Fixture/scenario tối thiểu | Oracle và điều kiện pass |
|---|---|---|
| A01 | Hai project, hai GUI attachments; path traversal/junction và stale owner | Không read/write/dispatch sang project khác; lỗi scope rõ; state đúng project |
| A02 | Attach mới, attach lại, restart MCP; request replay, đổi payload cùng key | Không duplicate execution; intent/job history giữ nguyên; conflict được báo |
| A03 | Defaults/profile/project/task; null/delete/array; attempted permission expansion | Effective values + sources đúng; override không tăng quyền ngoài policy |
| A04 | Hai change requests cùng base; crash giữa stage/activate; rollback | Một revision thắng; không partial config+overlay; rollback revision mới giữ audit |
| A05 | Active worker và idle GUI attachment; đổi instructions/model | Worker giữ binding cũ, thay đổi deferred đúng scope; idle attachment không khóa project mãi |
| A06 | Native/managed provider fake; mất reply ở submit; missing hook/duplicate event | Không blind retry; event dedup; capability thiếu không thành verified; route phù hợp requirement |
| A07 | Pause/cancel/decline/late answer; root stop có child vẫn sống | Desired/observed tách; không dispatch trái decision; giữ unknown reservation đến evidence terminal |
| A08 | Parent counter inclusive children, reset counter, external unknown usage | Không double-count; baseline/epoch đúng; unknown không bằng zero; totals partial |
| A09 | Native output/snapshot output conflict, sửa artifact sau receipt, crash publish | Hash/revision validation và journal recovery đúng; không nhận file bị sửa hoặc kết quả stale |
| A10 | Planning thiếu independent source check; contradictory claim; open proof obligation | Không nhận completed plan thiếu contract; scientific support/proof/novelty không bị transport success nâng cấp |
| A11 | Plugin package/manifest missing path, untrusted/missing hooks, inherited extra tools | Không tự trust, không sửa global policy; loader reports unsupported/degraded chính xác |
| A12 | Helper dùng lại env, profile bị thu hẹp, worker cố dispatch/approve | Không reinstall; đúng operations; quyền role bị giữ; raw receipt còn truy vết |
| A13 | Bootstrap lớn, read pagination, huge stdout, secrets trong lỗi, disk write failure | Không silent context truncation; bounded output; log redaction; failure không giả success |
| A14 | Migrate clone state v4→v5; active/unknown/journal; old writer; restore backup | Migration bị chặn khi chưa an toàn; writer v4 bị chặn; history/receipts không mất |
| A15 | Pack update/uninstall, hai host dùng chung project, binary version drift | State ngoài cache được giữ; owner fencing; stale capability receipt không pass |
| A16 | Inspect uninitialized, valid v4, config drift/broken, DB locked/corrupt, legacy/future schema | Không init/migrate/sync hoặc mutate logical state/schema/config; candidate không thành active; --workspace rescue; partial errors/exit status đúng |
| A17 | Config allowlist/task selection/attempt frozen config; receipt cũ/khác session; hai server cùng tên; native inventory thiếu | Có source/time/scope; configured khác observed; unknown không thành disabled; task history không bị config mới thay; host precedence không suy từ CLI |
| A18 | JSON/terminal cùng snapshot; secrets/env/argv/URL; ANSI/control chars; full/section/summary lớn | Redaction trước mọi renderer; schema/parity đúng; bounded summary có omitted count; full config đầy đủ trong scope, không spawn backend/network/LLM |

A16–A18 dùng một fixture family với các biến thể và spy cấm process/network; đo trước/sau payload/schema/config để xác minh read-only. Không so byte-for-byte mọi WAL/SHM sidecar vì SQLite/OS có metadata riêng. A03/A11 bổ sung host fixture: project config bị ignore vì trust/policy, Claude plugin-agent fields bị ignore và desktop MCP source collision; phải báo unsupported/conflict thay vì success. Host fixture xác minh adapter logic, không thay live host receipt.

Reuse test fixtures hiện có cho A07–A10/A12/A14; thêm test tại ranh giới mới thay vì nhân bản cả suite. Các invariant quan trọng có thể cần nhiều subcases trong một test nhóm; “ít lượt” không phải bỏ race/crash coverage. Chạy full suite/static checks theo AGENTS.md ở mốc runtime; không rerun full chỉ vì sửa prose.

## 3. Metadata/installation checks không inference — M0

Đầu vào: core/binding artifact (plugin nếu được chọn) + exact host/runtime build + test workspace riêng. Lấy capability của đúng surface từ [research](gui-integration-validation.md); không dùng CLI --version làm GUI loader evidence.

1. Validate binding/paths và dependencies được pin; manifest nếu có; Windows paths có khoảng trắng; runtime >= Node24; không ghi protocol logs vào stdout MCP.
2. Negotiate MCP initialize/tools list/resources nếu dùng, schema request/response với fake client và exact supported protocol. Không tự nâng protocol chỉ vì docs mới.
3. Kiểm host loader bằng API/command metadata được hỗ trợ nếu có. Nếu loader chỉ quan sát được trong GUI, tách bước host check và nêu nó có/không kích hoạt inference; không gọi nó “metadata” nếu thật sự mở model turn.
4. Ghi hook trust/load scope, effective plugin/tool inventory, version và environment receipts. Hook không có thì mark unsupported, không tự cho phép để test pass.
5. Xác minh compile/install không thay personal/global model, permission hoặc skills; activation dự án riêng được ghi explicit.

Pass: package hợp lệ và bằng chứng loader có phạm vi. M0 không chứng minh native task/delegation/interrupt hoạt động.

**I0 — inspect manual, không inference:** xem summary/full/section/JSON tại terminal 80 và 120 columns, với Unicode và Windows paths dài. Dùng fixture config drift và receipt lịch sử để kiểm người xem phân biệt active/declared/unknown. Lưu một output mẫu đã redact và kết quả review; không cần chạy mọi backend cho layout. Lệnh mặc định không mở MCP/backend. Đo latency/bytes cục bộ để nhận diện regression, chưa đặt SLA tùy ý khi không có baseline.

## 4. Live coverage tối thiểu — L-Codex

Đây là **protocol template, không phải request đã được duyệt**. Khi implementation sẵn sàng, tạo tài liệu request cụ thể bổ sung mọi trường còn thiếu trước hỏi người dùng.

### Câu hỏi nghiệm thu

GUI có thể attach đúng project qua binding đã chọn, áp dụng một tùy chỉnh có giới hạn, giao công việc đúng model/profile, nhận evidence và tiếp tục sau tương tác người dùng hay không? Terminal inspect có phản ánh đúng config revision và phạm vi observations của cùng công việc đó không?

### Một scenario tích hợp

- Workspace fixture riêng gồm một CSV nhỏ đã có oracle độc lập; không dữ liệu cá nhân, không scholarly network nếu không cần chứng minh route đó.
- Một GUI session Codex. Root analysis dùng `gpt-6.1-sol/high` nếu host cho chọn/xác minh; worker analysis cùng mapping. Không thêm planner chỉ để kiểm routing; planning được kiểm khi task thật cần nó.
- Người dùng yêu cầu đọc dữ liệu, tính một thống kê đơn giản và lưu kết quả; một worker read-only hoặc isolated-writer theo mục tiêu cần kiểm. Chốt output path và oracle số trước chạy.
- Một thay đổi project vô hại, ví dụ output language/format, được áp dụng qua hội thoại; kiểm effective revision và kết quả mới. Không dùng thay đổi budget/quyền để làm smoke test.
- Chạy inspect bằng script sau attach/change/worker result trong cùng scenario; đối chiếu revision và observed scope. Bước này không cần model turn riêng hoặc benchmark mới. Không bắt có deep native inventory nếu host chưa expose; coverage unknown phải đúng.
- Chỉ thêm native subagent khi cần xác minh native delegation. Một worker là đủ; không bắt đủ ba vai trò hay ba backend.
- Nếu kiểm interrupt bắt buộc mà chưa có trace thật: worker chạy helper chờ có giới hạn, người dùng dừng, kiểm event và jobs; không nhận ACK là stopped. Sau đó tiếp quản/đọc status, chỉ resume work khi đã biết trạng thái.
- Hoàn tất bằng evidence refs và acceptance do core; không coi lời agent “done” là oracle.

Tối đa thiết kế: một GUI session, một worker đầu tiên, thêm tối đa một recovery attempt nếu case interrupt nằm trong request. Số model turns thực tế phụ thuộc host và tương tác, không hứa chỉ một turn. Khi coverage interrupt đã có từ sử dụng thật, bỏ phase này. Cold attach và tiếp quản có thể kiểm cùng project, không cần dựng benchmark thứ hai.

### Budget và dừng

Request phải có con số cụ thể cho max elapsed time, max worker attempts, token/cost reservation nếu telemetry có, snapshot quota 5h/weekly và minimum remaining margin do người dùng chọn. Chưa có workload/host receipt nên không đặt token estimate giả ở plan này. Request thiếu số hoặc model/build cụ thể chưa đủ điều kiện chạy.

Default no automatic retry. Dừng ngay khi sai workspace/model, permission escalation, unknown process tree, publication conflict, evidence mismatch hoặc vượt envelope. Provider không hỗ trợ hard in-flight token cap phải nêu rõ trước duyệt. Không quy đổi phần trăm quota thành số token hoặc USD.

### Evidence và pass

Lưu request approval ref, source/package digest, effective config/profile, native IDs nếu quan sát được, task/attempt/events, changed config revision, raw output/receipt, oracle result, usage precision và limits. Pass chỉ cho những route đã thực thi. Nếu native usage không available, budget observability ghi partial; không giả route đáp ứng hard budget requirement.

L-Codex không chứng minh scientific novelty, chất lượng GUI dài hạn, full native tool isolation hoặc mọi model tier. Không lấy model tự chấm chất lượng làm điểm pass.

## 5. Live liên backend — chỉ khi bắt đầu dùng

Một request riêng cho host/worker đích. Dùng một subtask thật hoặc fixture tương đương đơn giản, xác minh mapping, dispatch/result, handoff references và shared quota identity. Không cần test tất cả directed pairs; kiểm mỗi provider boundary và một đường end-to-end thực tế, bổ sung pair-specific case chỉ khi khác protocol/behavior.

Chưa có mapping Claude/AGY được chấp nhận thì chưa dispatch tiered work. Nếu có một trace công việc thật đủ evidence, dùng trace đó thay benchmark. Không tuyên bố tất cả hosts accepted khi chỉ Codex pass.

## 6. Phần đánh giá trong sử dụng

Không làm benchmark bắt buộc cho: khám phá tri thức mới, chất lượng ý tưởng/proof, mức dễ sử dụng qua nhiều tuần, số agent tối ưu, lợi ích warm session, token cache dài hạn hoặc hệ thư viện chuyên ngành rộng. Thu feedback và evidence theo dự án; không tự tạo vòng đánh giá bằng model nền.

Theo dõi bootstrap size, retries, config-change friction, recovery losses, latency, unknown usage và kết quả người dùng chấp nhận. So sánh trước/sau chỉ khi workload đủ tương đồng; không suy plugin tốt hơn từ ít dòng code hoặc một smoke run.

## 7. Điều kiện bàn giao

- Software checks áp dụng pass; không còn unresolved data-loss/authorization/duplicate-dispatch defect.
- Một host GUI usable route có evidence thực tế hoặc phát hành rõ là software-only preview chờ verification.
- Tùy chỉnh project bền vững, không lan sang project khác; người dùng không cần CLI thường ngày.
- Inspect có summary/full/JSON, source/time/scope, redaction và rescue khi config lỗi; không đòi plugin/GUI đang chạy để đọc project state.
- Unsupported native capability hiển thị rõ và có fallback phù hợp; CLI cứu hộ được tài liệu hóa.
- Không xóa managed route trước khi replacement cover yêu cầu của task.
- Báo cáo cuối ghi source/build/schema, checks đã chạy/chưa chạy, limitations, migration/rollback và deletion ledger.

Các protocol L1/L2/X1–X8 cũ là lịch sử/nguồn coverage, không cộng thành backlog phải chạy hết. Khi tạo request mới, đối chiếu tiêu chí đã có bằng chứng và chỉ chạy phần thiếu. Không tái sử dụng approval cũ cho artifact/config mới.

Coverage→phase: PG0→M0 metadata; PG1a→A16–A18/I0; PG1b→A01–A05/A14; PG2→A02/A11/A13/M0; PG3→A06–A09; PG4→A10/A12; PG5→L-Codex phần chưa có trace; PG6→A15 và live provider boundary khi sử dụng; PG7→regression/deletion ledger. Không chạy cả suite mỗi lần sửa docs; runtime changes tuân AGENTS.md.
