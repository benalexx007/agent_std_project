# Báo cáo bàn giao implementation research harness v1 candidate

**Bàn giao GUI 29/10/2026:** source **0.7.0**, v4 compatible / GUI schema5. [Báo cáo chi tiết](gui-integration.md) bao gồm kiến trúc, project entries cho ba hosts, catalog/service, migration, config/overlay revisions, async managed/native-observed route, inspect/logs, install/uninstall và deletion ledger. [Evidence hiện hành](verification/gui-evidence.json) là regression/static/recovery, không chạy LLM/benchmark. GUI loader/model/permissions/native lifecycle thực tế còn chờ nghiệm thu; không tuyên bố cả plan live accepted. Các mốc dưới đây được giữ làm lịch sử.

**Bàn giao bổ sung 28/10/2026:** source 0.6.0/state-handoff4, xem [extensions.md](extensions.md) cho phạm vi, package pins, native policy, migration/rescue và acceptance. Báo cáo 0.5.0 bên dưới là baseline lịch sử; live backends và scientific quality vẫn chưa được chứng nhận.

Phiên bản source: 0.5.0 / state v3, cập nhật 27/10/2026. Trạng thái: implementation để người dùng review; nghiệm thu cuối cùng còn pending. Báo cáo này mô tả việc xây hệ thống agentic, không thay thế đầu ra khoa học của các dự án sử dụng nó.

Bổ sung 0.5.0: [nền tích hợp](integration-foundation.md) gồm workspace riêng, publication/recovery, parallel-writer admission, counter baselines, native collect/quota và context optimizations. [Evidence](verification/v1-evidence.json) là software verification; native inference và H0 chưa được nghiệm thu. P0 source 0.4.0 giữ như lịch sử.

## Mục tiêu và phạm vi

Hệ thống cung cấp workflow/skill và CLI cho agent điều phối và worker có thể thay thế. Domain Research có researcher, implementer, evaluator; vị trí điều phối, model/backend, permissions và quota pools được tách riêng. Hỗ trợ dự án có goal discovery/extension/reproduction/synthesis và paper/proof/report/artifact output.

Core dùng Node.js >=24, thư viện chuẩn và SQLite WAL/synchronous FULL, không có dependency cài thêm. Giao diện là CLI/context packet và artifact bền vững. Agent diễn giải prompt, lựa chọn công việc và thực hiện suy luận; core không chạy một LLM điều phối ẩn và không tự đổi model của cuộc chat hiện tại.

model_policy có ba tầng theo task class. Mapping cập nhật 31/10/2026: cố vấn tổng hợp/chốt plan dùng gpt-6-astra/high; orchestrator/analysis/implementation/trao đổi dùng gpt-6.1-sol/high; automation mặc định Antigravity gemini-3.8-flash-high/high. Claude và các tier còn thiếu của Antigravity chưa cấu hình, không mượn mapping Codex. task_class_backends định tuyến mặc định cho task mới; explicit/frozen selection giữ ưu tiên. Snapshot ghi class/tier/model/effort; Codex CLI nhận effort qua -c, AGY qua --effort. Task cũ giữ selection cùng backend; fallback rebind cùng tier, không tự hạ tầng.

Planning có nghĩa vụ độc lập verify và research lại từ nguồn gốc thay vì tin hoàn toàn analysis. Result completed cần planning_review mới cho attempt, primary/research checks có artifact hashes và timestamps, đối chiếu analysis/bất đồng và không còn blocking questions. Hệ thống chặn analysis summary dùng làm primary evidence; tính đúng nội dung vẫn cần reviewer. Xem [model-routing.md](model-routing.md) cho config và giới hạn.

Điều chỉnh phân công 31/10/2026: orchestrator mặc định analysis/medium, làm quản lý nhóm và tương tác người dùng. synthesis_planning/highest là nhiệm vụ cố vấn chuyên môn riêng, thường researcher: tổng hợp analyses, kiểm chứng/research độc lập và trả kế hoạch chi tiết cho orchestrator tổ chức thực hiện. Không thêm runtime/root coordinator hoặc vòng gọi cố vấn cho mọi tác vụ nhỏ; scientific planning contract vẫn giữ nguyên.

## Năng lực nghiên cứu được hỗ trợ

| Năng lực | Cơ chế implementation | Phần vẫn cần phán đoán/công cụ chuyên môn |
|---|---|---|
| Phát triển hiểu biết mới | Hypothesis records, alternatives/prior work/predictions, revision và branch decisions | Giá trị ý tưởng, tính mới trong lĩnh vực, chất lượng suy luận của model |
| Toán học | Definitions/assumptions/steps/obligations, proof levels và receipt có raw evidence | Tính đúng ngữ nghĩa, formalization, verifier thật và phạm vi chứng minh |
| Xây thực nghiệm | Exploratory/confirmatory plan, measurement/controls/analysis, math–code guidance và run manifests | Thiết kế đủ trả lời câu hỏi, confounder và tính đúng của phép đo |
| Kiểm chứng/cập nhật | Evidence updates, counterevidence, review/claim records và dependency invalidation | Độ mạnh bằng chứng, giải thích cạnh tranh, thống kê và giới hạn khái quát |

Sáu skill dùng references theo nhu cầu; task scope nhỏ không tự nạp toàn bộ hướng dẫn khám phá. Khi profile cần kết hợp toán/thực nghiệm, design/experiment/evaluate nhận các references tương ứng. Các mức execution, scientific support, proof verification và novelty không được đánh đồng.

## Runtime và tính liên tục

Work units/assignments/generation, atomic reservations, quota pool/freshness, reserves, heartbeat/lease, bounded retry/cooldown/no-progress và checkpoint/recovery được giữ từ I1–I4. Thay worker dùng checkpoint và phần còn lại; missing heartbeat không chứng minh job đã dừng. Unknown jobs giữ reservation và chặn khởi chạy bản sao cho tới khi reconcile.

Research records giữ namespace schema 1. Source 0.5.0 dùng state/handoff v3 và yêu cầu migration explicit có backup từ v1/v2; v2 phải giải quyết unsettled attempts trước. Writer guard chặn code cũ cập nhật state mới. Không reset scientific history/budgets trong migration. Record revision bất biến, refs pin ID/revision/hash; task/input/raw artifact thay đổi làm validity cần review, không sửa raw verdict lịch sử.

Dependency refs theo dõi premises hiện hành; subject refs giữ đúng đối tượng lịch sử đã được quan sát. Checkpoint giữ research refs, context giữ scientific state cần thiết và handoff mang history. Role/skill/reference được fingerprint, kể cả overlay trong workspace; policy thay đổi không được blind-reuse checkpoint cũ.

HITL dùng CLI control độc lập với lượt LLM: status, steer notes, pause boundary, cancel, resume; ACK tách terminal confirmation, quyền/decision có revision. CLI một lượt không có native steer/resume chung; tác dụng dừng job con/remote được báo theo evidence hiện có.

## Cải tiến và quyền chạy benchmark

Feedback gắn task/artifact/config/bundle version. Project improvements sao chép skill/domain Markdown thành immutable snapshots; activation yêu cầu checks/evidence và không có công việc chưa giải quyết. Có thể rollback change ID hoặc original; không sửa personal/global skills hay tự tăng model/budget/permissions. Thay đổi code/script vẫn đi qua review và regression của source.

Benchmark được thiết kế tại docs/benchmarks, chưa thực hiện. Mỗi campaign cần protocol được điền đầy đủ và một câu hỏi trực tiếp cho người dùng. Request pin document hash, task/config/bundle và limits; dispatch chặn pending/declined/completed requests, thay scope hoặc vượt limits. confirm-benchmark chỉ ghi lại xác nhận người dùng đã đưa ra. Vì môi trường là local trusted operator, guard không thay thế authentication độc lập.

## Bằng chứng kiểm tra và review

Chạy node scripts/verify-v1.mjs để tạo evidence của đúng source hiện hành. Nó thực hiện static/schema checks, software regression trong workspace tạm và demo fallback mock; không gọi model/backend thật hoặc các benchmark đề xuất.

- docs/verification/v1-evidence.json: số test, source hashes, evidence hashes và gate mapping V1-01–V1-11.
- docs/verification/software-tests.tap: kết quả từng software test, gồm C1–C4 và permission state-machine fixtures.
- docs/verification/static-checks.json: syntax, skill references/metadata và example contracts.
- docs/local-verification.json: trace fallback mock, phần đã hoàn tất không bị làm lại.

Các gate có automated evidence vẫn chờ người dùng review; V1-11 chờ chấp nhận phạm vi và báo cáo. Software fixtures kiểm tra contract/control/provenance, không chứng nhận model tự tìm lỗi toán, khám phá mới hoặc tiết kiệm token. Không có scientific benchmark results trong lần bàn giao này.

## Compatibility và giới hạn

| Interface | Evidence cục bộ | Live status/giới hạn |
|---|---|---|
| Mock | Process E2E, accounting/control/checkpoint/fallback | Chỉ fixture, không LLM |
| Manual | Context/record/result import, review/handoff | Agent/người dùng thực hiện công việc và kiểm tra receipt |
| Codex CLI | Invocation/JSONL parser fixtures, reported usage/error handling | Chưa live-verified; không App Server streaming controls/quota API |
| Codex App Server | Protocol/process fixtures, input/steer/checkpoint, isolated bridge, collect history, percent quota | Chưa inference live-verified; P0 cũ theo source 0.4.0, native groups/reuse chưa bật |
| Claude CLI | Invocation/JSON envelope/error/usage fixtures | Chưa live-verified; không SDK streaming/children management |
| agy CLI | Invocation và text/JSON contract | Chưa live-verified; usage unknown; giới hạn bản CLI đã khảo sát |
| Custom command | shell=false, structured result, cancellation unknown descendants | Operator chọn command/quyền/telemetry; không là OS sandbox |

Trước khi dùng backend thật, kiểm tra phiên bản/auth/permissions/capability trong phạm vi đã được người dùng cho phép. Chưa có live run không bị báo thành đã chứng minh tương thích. Hai adapter có offline contract checks không đồng nghĩa mọi hãng có tính năng tương đương.

Giới hạn còn giữ rõ:

- Không có oracle phổ quát cho novelty/scientific validity; reviewer/verifier receipts là attestations cần kiểm tra thật.
- Không có automatic proof assistant installation hoặc semantic proof checking trong core. Numerical checks không được nâng thành proof chỉ vì exit code 0.
- Không có tokenizer/quota API chung hoặc hard cap trên model đang gọi; estimates/reservations là kiểm soát nội bộ, subscription quota khác API cost.
- Không theo dõi native subagents chưa đăng ký, không có driver remote scheduler/GPU hoặc tự restore/merge filesystem. Unknown giữ chặn thay vì đoán.
- Handoff JSON và checkpoint manifest không phải backup đầy đủ môi trường; cần database/artifacts/bundle tương ứng.
- Điều phối phân giải prompt và chọn work units; chưa có chat server hay UI thống nhất. Nghiên cứu thực tế vẫn cần người dùng định hướng và kiểm tra đúng mức.

## Bắt đầu sử dụng

Đọc docs/verify.md cho kiểm tra runtime và docs/research-workflow.md cho research records/feedback. Sau review, dùng hệ thống vào đề tài thực với phạm vi/quyền/budget rõ; ghi vấn đề hoặc ích lợi quan sát được, sửa hẹp và kiểm tra hồi quy. Benchmark chỉ chạy khi người dùng thấy cần và xác nhận từng campaign kèm protocol.

## Đồng bộ model policy và chuẩn bị diagnostic

Sáu skill, role profiles, domain/capability/acceptance plans cùng workflow đã đồng bộ task classes theo model policy; không cố định role vào một tier. Planning reference chỉ nạp cho synthesis_planning, sources trong audit đưa vào evidence_refs để source drift làm kết quả cần review. Context điều phối hiển thị selection của task. Software verification có regression cho nguồn ngoài inputs, manifest tamper và superseded requests.

B01 cũ chưa chạy được giữ lịch sử; [protocol v2](../benchmark-runs/b01_20261025_02/protocol.md) mới pending separate approval. Bốn closed cases, analysis → independent plan → calculate → review, C3 thêm update: 4 Astra High + 13 Sol High, tối đa 380.000 reservation tokens/65 phút. Driver script không dùng LLM; không đo Sol Medium hay open literature research. Manifest/source/config/input/executable pin bằng hash, derived inputs có journal; C2 release probe của final planner. Chưa có kết quả model/benchmark và chưa thay đổi trạng thái nghiệm thu.

## Sửa lỗi sau review vận hành

Bản 0.3.1 sửa các lỗi state machine, completion exception, artifact reuse, checkpoint liveness, context selection và Windows preflight; bổ sung reopening có audit, snapshots output bất biến và guarded output hash pinning. Mapping từng finding và regression nằm trong [operational-review-fixes.md](operational-review-fixes.md). Evidence đã được tái tạo cho source mới; automated pass vẫn chờ người dùng review.

Trong bản 0.3.1 chưa có native SDK/control channel. Nhánh 0.4.0 bổ sung [Codex App Server điều phối](codex-native.md), vẫn giữ mapping ba tầng, quyền theo profile và không chạy scientific benchmarks. Protocol B01 đã chuẩn bị trước đó cần request mới theo source/path hiện hành nếu sử dụng; mỗi run hỏi riêng. Benchmark không là điều kiện bắt buộc nghiệm thu core.

## Nhánh Codex native 0.4.0

Core điều phối các root workers qua tools có kiểm soát; native delegation của backend giữ disabled. Mỗi worker có budget/checkpoint/owner riêng, có thể chọn backend khác khi được map và cấp quyền. Parent không publish final result khi delegated jobs chưa rõ. Worker exit và external job completion được lưu riêng; reservation chỉ quyết toán khi job đã đối soát.

Driver ghi intent trước turn/start, lưu IDs/config receipt, normalize usage từ backend, tách steer ACK và native user questions khỏi project approval. Mất reply/process descendants chưa rõ giữ unknown; observer không tự coi metadata là bằng chứng đã dừng. Có công cụ checkpoint giữa lượt và kiểm source manifest của L1. Fixtures không xác nhận quyền truy cập model hoặc tương thích inference thật.

Tối ưu đã có gồm heartbeat riêng polling, logs backpressure, bounded RPC, scoped orchestration context và native input-aware admission. Warm reuse/native_group, parallel workspace isolation, delta cursors và tối ưu storage sâu còn deferred theo gate; chưa có số liệu tốc độ/token để tuyên bố lợi ích.
