# Codex điều phối — nền 0.4.0, mở rộng 0.5.0

Ngày: 27/10/2026. Source 0.5.0 bổ sung [integration foundation](integration-foundation.md) với state v3, execution/control roots, collect history và percent quota. Các số liệu 0.4.0 sau đây là lịch sử; evidence hiện hành ở verification/v1-evidence.json. Nhánh native đầu của [plan bản 3 lưu trữ](runtime-integration-plan-v3.md), dùng core Node.js/SQLite và Codex App Server stdio; không thêm runtime/dependency ngoài. Mức bằng chứng: 161 software tests pass (15 tests native/acceptance), static checks 51 file và demo mock pass; [evidence](verification/v1-evidence.json). P0 metadata/static đã có [báo cáo](verification/p0-2026-10-27/report.md); chưa chạy inference Codex hoặc benchmark nghiệm thu thật. [Plan bản 4](runtime-integration-plan.md) là roadmap mở rộng, không thay đổi scope implementation được mô tả ở đây.

## Phạm vi đã triển khai

| Thành phần | Implementation |
|---|---|
| Backend mới | codex-app-server, pin version, model/effort/workspace/permission receipt; cấm provider model fallback |
| Điều phối | run-orchestrator và dynamic tools để đọc scope/nguồn, đăng ký task, chạy worker và điều khiển task thuộc quyền |
| Worker nhiều backend | Giữ register/run-task/driver cũ; mỗi worker có attempt, reservation, quota pools và checkpoint riêng |
| Native lifecycle | initialize -> thread/start -> durable turn intent -> turn/start -> events -> validate/publish -> close; lưu thread/turn/process binding |
| HITL | Steer gắn expected turn, ACK riêng; câu hỏi giữa lượt lưu durable và có deadline, trả lời từ CLI khác; approval nâng quyền bị từ chối |
| Progress | Worker có công cụ read/hash và save checkpoint giữa lượt qua core, không cần quyền ghi trực tiếp SQLite |
| Recovery | Mất reply giữ unknown; inspect-native chỉ đọc metadata, không tự release reservation hoặc chạy lại turn |
| Tối ưu | Heartbeat tách polling; logs có backpressure; RPC giới hạn frame/pending/buffer; native schema ngoài prompt; orchestrator nhận active frontier hoặc task IDs; native reservation thêm input floor/overhead |
| Nghiệm thu | Server giả lập, chuẩn bị L1 pending với source manifest, oracle code và guard xác nhận riêng |

Core sở hữu delegation liên backend. Native children của Codex được tắt bằng agents.enabled=false; renderer chuyển role và instructions vào thread. Không giả gọi công cụ harness là native sub-agent: worker được core mở qua các root attempts riêng.

## Cấu hình và chuẩn bị không inference

Chạy từ research_system trong PowerShell:

    node scripts/harness.mjs validate-config --config examples/codex-native.json
    node scripts/harness.mjs probe-backend --config examples/codex-native.json --backend codex_native
    node scripts/harness.mjs init --config examples/codex-native.json --owner local
    node scripts/harness.mjs register-task --config examples/codex-native.json --file examples/task-orchestrator.json
    node scripts/harness.mjs run-orchestrator --config examples/codex-native.json --task coordinate_research --owner local --epoch 1 --key first-coordinate

Lệnh cuối chưa có --execute nên chỉ chuẩn bị context. Ví dụ luôn giữ execution.allow_external=false và backend.allow_execute=false. Khởi tạo workspace/state là thao tác local, không chạy model.

Trước dùng trên dự án thật: copy config, đặt workspace/objective/inputs và task phù hợp, xem ngân sách/quyền, bật execution và đúng backend được phép trong phạm vi đã chấp nhận. Nếu state đã init, dùng sync-config với owner/epoch và không có active/unknown attempts. Chỉ thêm --execute sau bước xác minh/cho phép live tương ứng; benchmark luôn cần guard riêng.

Pin hiện tại là binary đi kèm desktop: codex-cli 0.164.0-alpha.11.1. Đây là bản đang cài đã xuất schema, không tự thay bằng stable 0.164.0. Sau update binary, probe sẽ từ chối pin cũ; review protocol và cập nhật config có chủ đích. [Protocol pin](verification/codex-protocol-pin.json) ghi field names/hashes từ binary cục bộ; không chứng minh model entitlement.

Mapping cập nhật 31/10/2026: cố vấn synthesis_planning -> Astra High; orchestrator/analysis -> Sol High; automation mặc định -> Antigravity Gemini 3.8 Flash High qua managed cross-backend worker. orchestrator và task-orchestrator.json mặc định analysis, phụ trách giao việc và tổ chức thực hiện. Cố vấn khoa học là task researcher riêng, synthesis_planning, tự research/verify rồi trả kế hoạch và planning_review cho orchestrator; xem examples/task-synthesis-planning.json và [model routing](model-routing.md). Không có lệnh nào tự đổi model của cuộc chat đang mở. Config/task đã đăng ký trước sửa đổi không tự chuyển tầng hoặc backend.

## Điều phối và các giới hạn của tools

Orchestrator được cấp:

- harness_status: frontier có scope; task_ids cho lịch sử cụ thể.
- harness_read: đọc artifact trong workspace hoặc bundle; trả content/hash/timestamp; file quá lớn bị từ chối để chọn nguồn nhỏ hơn.
- harness_register_task: contract task chuẩn; lưu ownership nguyên tử với registration; không tạo đệ quy orchestrator.
- harness_run_task: chạy worker qua admission/benchmark guards hiện có; dispatch key giữ tính idempotent.
- harness_control_task: steer/pause/cancel task do attempt này tạo.
- harness_checkpoint: checkpoint tiến độ của chính attempt.

Worker nhận harness_read/harness_checkpoint, không nhận quyền phân công. Chúng vẫn dùng công cụ native theo sandbox của backend. Delegated job được ghi trước chạy worker; parent không được nhận final result khi jobs do nó giao còn chưa rõ. Mỗi worker tính usage riêng, parent không cộng lại usage của worker vào số token native của nó.

Không expose công cụ đổi config, budget, owner, cấp quyền hoặc confirm-benchmark cho model. Benchmark orchestration không được tự mở rộng frozen task scope. Đây không là xác thực danh tính cho mọi chương trình trên máy; operator CLI vẫn là boundary tin cậy như phiên bản trước.

Task có backend workspace-write bắt buộc khai writes_workspace=true, để writer admission không bị bypass. Shared workspace hiện vẫn chỉ một writer. Muốn quyền shell khác trên native profile phải tạo root phù hợp; custom agent prompt không thay OS sandbox.

## Khi người dùng tương tác giữa lượt

Theo dõi binding/câu hỏi:

    node scripts/harness.mjs native-requests --config examples/codex-native.json --attempt ATTEMPT_ID

Tạo answers.json theo các question ID đang pending, ví dụ:

    { "answers": { "choice": { "answers": ["A"] } } }

Sau đó trả lời từ terminal khác:

    node scripts/harness.mjs answer-native-input --config examples/codex-native.json --attempt ATTEMPT_ID --request REQUEST_ID --file answers.json

Câu trả lời chỉ hợp lệ cho request/turn còn active, chưa hết deadline và không bị barrier. Câu hỏi runtime không biến thành phê duyệt project/benchmark. Permission escalation bị decline trong profile này; thay quyền phải qua cấu hình và review riêng.

Steer dùng control-task như cũ. Native ACK có nghĩa backend đã nhận, chưa chứng minh agent đã áp dụng. Pause giữ boundary cuối unit; không hứa suspend process. Cancel/timeout yêu cầu interrupt, đối soát descendants; nếu chưa chứng minh đã dừng đầy đủ thì unknown và giữ reservation.

## Khi mất kết nối hoặc nguồn điện

    node scripts/harness.mjs reconcile-state --config examples/codex-native.json
    node scripts/harness.mjs inspect-native --config examples/codex-native.json --attempt ATTEMPT_ID

inspect-native mặc định chỉ đọc binding local; --execute khởi động observer và đọc thread metadata, không gọi turn/start hoặc inference. notLoaded/completed trong metadata không chứng minh các subprocess đã kết thúc. Dùng evidence và reconcile-state/import-result theo contract hiện tại trước recovery. Không gửi lại turn/start chỉ vì RPC timeout.

Checkpoint giữa lượt giữ summary, remaining actions, uncertainty cùng pinned artifact/research refs. Chỉ tiến độ đã checkpoint được bảo vệ; không hứa khôi phục mọi bước kể từ checkpoint cuối. Không chuyển native session nguyên trạng sang hãng khác.

## Nghiệm thu và chi phí

Software check tổng: node scripts/verify-v1.mjs. Runner gồm static checks, toàn suite và demo mock, không gọi model. Tests native dùng test/fixtures/codex-server.mjs, không dùng Codex thật để giải fixture.

Chuẩn bị L1: benchmarks/native/prepare.mjs nhận --directory NEW_PATH --config FILE --max-cost-usd N --reservation-cost-usd N và --backend nếu cần. Đây là preparer, không chạy worker. Nó tạo fixture/spec/protocol, request pending, config chỉ bật profile đã chọn, manifest ghim source và một task analysis. Không dùng nó để tự xác nhận.

Sau xác nhận riêng của người dùng và chạy L1 trong scope đã chấp nhận, grade.mjs WORKSPACE kiểm oracle và primary evidence hiện hành bằng code. Chi phí native có thể unknown; reservation cost là ước tính operator, không phải hóa đơn đo được. Token cap/admission không bảo đảm hard provider cap trong request đang chạy.

## Phần giữ disabled/deferred và lý do

- Native_group: chưa có evidence đủ cho accounting/cancel toàn cây; harness_workers vẫn hỗ trợ nhiều worker/backend. Không bật nesting ẩn để hoàn thành một checkbox.
- Warm session reuse và tự resume turn: chưa có gate usage-baseline/effective-config/reconnect được live-verified; phiên mới theo attempt, portable checkpoint là đường chính.
- Tự quyết toán sau cancel/process tree chưa rõ: cần evidence; hiện giữ unknown. Observer không tự biến heartbeat thiếu thành đã chết.
- Writers song song/worktree, runtime ngoài, Claude/Antigravity native mới: nhánh có điều kiện; không thuộc activation Codex đầu tiên. Adapter cũ vẫn có mức bằng chứng cũ.
- Hash/snapshot lớn ngoài transaction, delta cursor và chuẩn hóa hot tables: chưa chuyển khi chưa có snapshot/race evidence phù hợp. Bản này giảm write frequency nhưng vẫn đọc JSON state blob; không hứa RAM/thời gian độc lập tổng lịch sử.

Chỉ công bố lợi ích tốc độ/token sau quan sát workload thật. Năng lực nghiên cứu, proof và novelty vẫn cần đánh giá theo dự án; software fixtures không chứng nhận chúng.
