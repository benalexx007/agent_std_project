# Verify implementation trước khi chạy backend thật

Thực hiện từ thư mục repository bằng Node.js >=24. Các lệnh dưới dùng fixture cục bộ; config mẫu giữ external execution=false.

Tài liệu hướng dẫn verify source v0.6.0 / state v4. [Tiêu chí nghiệm thu v1](v1-acceptance-plan.md) có automated evidence cho các gate và walkthrough; người dùng vẫn cần review trước nghiệm thu. V1 không yêu cầu một pilot tạo tri thức mới để được bàn giao.

Đọc [integration-foundation.md](integration-foundation.md) trước khi bật snapshot/native collect/quota; database v1/v2/v3 cần explicit migrate-state khi idle; v3 có emergency control/reconcile hẹp trước migration. Xem [extensions.md](extensions.md) cho package/profile scope và native acceptance còn pending. Dùng verify-v1.mjs để gom static/suite/demo một lần; không chạy lặp cả bộ nếu batch đã pass trên source hiện hành.

## 1. Kiểm tra source và contract

    node --version
    node scripts/check-project.mjs
    npm test
    node scripts/harness.mjs capabilities --config examples/research.json

Kiểm tra role/skill riêng backend/model, contract strict, schema state/attempt khớp dữ liệu runtime và các giới hạn adapter trong docs/runtime.md.

Nếu môi trường chỉ có Node mà không có npm, dùng lệnh tương đương:

    node --test --test-concurrency=1 test/contracts.test.mjs test/engine.test.mjs test/runner.test.mjs test/recovery.test.mjs test/research.test.mjs test/improvements.test.mjs test/benchmark-policy.test.mjs test/benchmark-preparation.test.mjs test/model-routing.test.mjs test/planning.test.mjs test/operational-review.test.mjs test/native.test.mjs test/workspaces.test.mjs test/foundation.test.mjs

Hoặc chạy trọn gói và lưu evidence: node scripts/verify-v1.mjs. Runner chỉ chạy software fixtures/static checks và mock fallback; không thực hiện benchmark. Xem docs/verification/v1-evidence.json cho số test, source/evidence hashes và gate mapping.

Model policy có ba tầng và planning verification gate: xem [model-routing.md](model-routing.md). Kiểm tra bằng resolve-model (không gọi model) và tests model-routing/planning. Tầng planning completed cần primary checks và research checks mới cho attempt; analysis summary không được dùng thay evidence độc lập.

Để review phần research, làm theo [research-workflow.md](research-workflow.md), đọc tests C1–C4 trong test/research.test.mjs và [báo cáo bàn giao](system-report.md). Kiểm tra paper/proof profile, assumptions/obligations, historical subjects, counterevidence, stale dependencies, overlay/rollback và quy tắc xin phép benchmark. Không coi JSON receipt là chứng minh toán học đã xác thực.

## 2. Chạy trace fallback hoàn toàn tạm thời

    node scripts/verify-demo.mjs

Script tạo workspace tạm, chạy kịch bản hai unit và dọn đúng thư mục do nó tạo. Có thể lưu report:

    node scripts/verify-demo.mjs docs/local-verification.json

Điểm cần thấy: define_contract chỉ có một attempt; parse_results có A lỗi quota không có final answer, rồi mock_backup tiếp quản từ checkpoint; task kết thúc completed với ba attempt. Token/chi phí trong report là số fixture và estimate, không phải hiệu quả model thật.

## 3. Giữ workspace để tự inspect

    node scripts/harness.mjs init --config examples/recovery.json --owner local
    node scripts/harness.mjs register-task --config examples/recovery.json --file examples/task-recovery.json
    node scripts/harness.mjs plan-work --config examples/recovery.json --task parser_recovery
    node scripts/harness.mjs allocate-budget --config examples/recovery.json --task parser_recovery
    node scripts/harness.mjs run-task --config examples/recovery.json --task parser_recovery --owner local --epoch 1 --key review-parser --execute
    node scripts/harness.mjs status --config examples/recovery.json
    node scripts/harness.mjs report-usage --config examples/recovery.json
    node scripts/harness.mjs create-handoff --config examples/recovery.json --out examples/recovery-workspace/handoff.json

Artifacts nằm trong examples/recovery-workspace/.agentic. init/register là một lần; lặp cùng dispatch key không chạy thêm một bản. Muốn kịch bản mới, dùng task/config/workspace mới hoặc revision phù hợp, không ghi đè lịch sử cũ.

## 4. Thử tương tác khi worker bận

Terminal A:

    node scripts/harness.mjs init --config examples/research.json
    node scripts/harness.mjs register-task --config examples/research.json --file examples/task-long.json
    node scripts/harness.mjs run-task --config examples/research.json --task review_long --owner local --epoch 1 --key long-review --execute

Trong terminal B, chọn một hành động:

    node scripts/harness.mjs control-task --config examples/research.json --action status --target review_long
    node scripts/harness.mjs control-task --config examples/research.json --action steer --target review_long --message "Inspect leakage first"
    node scripts/harness.mjs control-task --config examples/research.json --action pause --target review_long
    node scripts/harness.mjs control-task --config examples/research.json --action cancel --target review_long

Pause đợi unit hiện tại tới checkpoint; cancel gửi dừng. ACK tiếp nhận và trạng thái verified là hai mốc khác nhau. Nếu config bị lỗi, đường khẩn cấp dùng workspace:

    node scripts/harness.mjs control-task --workspace examples/workspace --action cancel --target project

Task đã cancel không tự resume/retry. Với pause, resume chỉ mở barrier, sau đó có thể dispatch phần còn lại bằng key mới:

    node scripts/harness.mjs control-task --config examples/research.json --action resume --target review_long

## 5. Review bàn giao và override

    node scripts/harness.mjs prepare-orchestrator --config examples/recovery.json
    node scripts/harness.mjs claim-owner --config examples/recovery.json --owner reviewer --epoch 1

Các dispatch tiếp theo dùng owner=reviewer, epoch=2. Lệnh từ owner cũ bị từ chối. Kết quả đang chạy của owner cũ cần review/adopt với owner mới, không tự thành kết quả hiện hành.

Để thử role override trên task chưa đăng ký:

    node scripts/harness.mjs register-task --config examples/research.json --file examples/task-small.json --override examples/override-evaluator.json
    node scripts/harness.mjs prepare-task --config examples/research.json --task review_scope

Kiểm tra chỉ role evaluator và skill được chọn được nạp; config mặc định không bị ghi lại.

## 6. Chuẩn bị recovery thủ công

    node scripts/harness.mjs prepare-recovery --config examples/recovery.json --task TASK_ID --owner OWNER --epoch EPOCH
    node scripts/harness.mjs recover-task --config examples/recovery.json --task TASK_ID --owner OWNER --epoch EPOCH --key NEW_KEY --execute

Dùng các ID thực từ status; không chạy các dòng placeholder nguyên dạng. Nếu automatic=true, run-task đã thực hiện fallback khi có thể. Không cần recovery cho task completed.

prepare-recovery ghi đề xuất nhưng không dispatch. Đọc source attempt, rejected candidates, checkpoint và nguyên nhân blocked/waiting. Khi job/descendants chưa rõ, thu bằng chứng và reconcile trước; không dùng ghi chú tùy ý để giả lập xác minh thực tế.

examples/quota-snapshot.json có timestamp mẫu cũ, cần thay bằng thời điểm và số liệu quan sát thật trước update-quota. Không nhập số quota bịa để bỏ qua admission.

## 7. State từ bản trước

    node scripts/harness.mjs status --workspace PATH_TO_OLD_WORKSPACE
    node scripts/harness.mjs migrate-state --workspace PATH_TO_OLD_WORKSPACE

Migration tạo backup JSON và giữ unfinished attempts ở unknown. Đối chiếu job/artifact trước khi cho chạy lại; sync-config theo owner/epoch nếu cần. Không sửa schema_version bằng tay để bỏ qua migration.

## Sau khi verify

GUI 0.7.0: `node scripts/verify-v1.mjs --gui` chạy static checks, full software regression và recovery demo, lưu gui-evidence.json/gui-software-tests.tap/gui-static-checks.json/gui-demo.json riêng; không overwrite baseline v1-evidence. Có fixtures cho migration v5, authorization race, config+overlay CAS/rollback, async managed replay, native observations/control, three-host install/uninstall và bounded reads/logs. [GUI guide](gui-integration.md) phân biệt software preview với actual host loader/model/permissions; live benchmark vẫn cần xác nhận riêng. Không cần MCP/plugin để chạy software checks.

Ghi lại các vấn đề cần sửa, hoàn thiện các gate còn thiếu và review phạm vi bàn giao theo v1-acceptance-plan.md. Sau nghiệm thu, dùng hệ thống vào dự án research thực tế với backend/model, quyền, budget, quota pool và đầu ra phù hợp; thu feedback để cải tiến. Kiểm tra tích hợp backend thật được thực hiện khi được phép sử dụng. Không bắt buộc chiến dịch benchmark nghiên cứu; xác nhận implementation không tự bật allow_external hay cho phép mua credit.

## Review cập nhật model tiers

Dùng resolve-model để xem ba cặp Astra High / Sol High / Sol Medium mà không gọi model. Kiểm tra context chỉ nạp planning reference/audit schema cho synthesis_planning, có analysis_input_paths khi nhận handoff analysis. Completed plan cần audit mới; nguồn audit đổi phải làm currentTaskResult=false, kể cả nguồn ngoài inputs. Đọc fixtures model-routing/planning thay vì coi schema pass là nội dung đã đúng.

B01 preparation tests chỉ tạo workspace tạm/pending request, kiểm hashes/mappings/release và từ chối chạy unapproved. Protocol B01 v2 (local, not committed) là tài liệu xin duyệt cho một lần chạy cụ thể; việc đọc protocol/chạy software tests không phê duyệt benchmark. execution_manifest phải giữ nguyên sau approval. supersede-benchmark chỉ dùng với request pending chưa có attempt và không kế thừa approval.

## Review các bản sửa v0.3.1

Xem [báo cáo sửa lỗi](operational-review-fixes.md) và test/operational-review.test.mjs. Bộ regression gồm completion exception/settlement, reopen có giữ progress, declined decisions qua pause/resume, manual handoff/import, output snapshots/publication order, checkpoint liveness, branch selection, timestamp precision, Windows preflight, overlay cleanup, dictionary membership và output hash pinning.

Chạy node scripts/verify-v1.mjs để tái tạo toàn bộ evidence, không chỉ các test mới. Benchmark B01 cũ có fingerprints/path từ trước thay đổi; dùng để đọc lịch sử, không chạy hoặc sửa ngầm protocol. Chuẩn bị request mới kèm xác nhận riêng nếu sau này cần.
