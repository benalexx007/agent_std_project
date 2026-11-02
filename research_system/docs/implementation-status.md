# Tình trạng implementation v0.5.0 — research harness v1 candidate

**Cập nhật 28/10/2026:** source 0.6.0/state-handoff4 đã triển khai [Research extensions EX0–EX5](extensions.md), có môi trường local và fixtures; native/human acceptance pending. Các mốc 0.5.0 bên dưới giữ như lịch sử. Không database người dùng nào được tự migrate, không model benchmark được chạy.

Nền 0.5.0 đã triển khai snapshot workspace, journaled publication/recovery, bounded writer admission, checkpoint rematerialization, scoped usage baseline, native history/quota và bounded context/cache; state/handoff v3 với writer guard. Xem [phạm vi, commands và migration](integration-foundation.md). Software evidence hiện hành ở dưới; model inference/H0 còn pending.

Lịch sử: source 0.4.0 bổ sung nhánh Codex native điều phối trên nền I1–I4 và các sửa lỗi 0.3.1. Có App Server stdio driver, tools phân công worker qua core, checkpoint/input/steer native, intent/binding/usage và tối ưu polling/streams/context. Hướng dẫn và scope: [codex-native.md](codex-native.md). Nghiệm thu cuối cùng vẫn pending; chưa chạy model thật hoặc đo năng lực khoa học.

Cập nhật implementation 27/10/2026: [plan bản 4](runtime-integration-plan.md) đã có lát cắt nền, không đồng nghĩa mọi C01–C18 đã bật. P0 cũ là metadata/static lịch sử source 0.4.0; L1/L2 chưa được duyệt/chạy. Những capability chưa implement được ghi rõ trong integration-foundation.md.

Điều chỉnh kế hoạch ngày 25/10/2026: báo cáo là đầu ra của dự án xây harness; các dự án research sử dụng hệ thống vẫn hỗ trợ paper, proof và đầu ra theo yêu cầu. Không loại bỏ phần viết paper khỏi role/skill. Bổ sung kế hoạch cho phát triển giả thuyết, khai triển toán học, thiết kế thực nghiệm và kiểm chứng/cập nhật bằng chứng tại [research-capability-plan.md](research-capability-plan.md).

Nghiệm thu theo [v1-acceptance-plan.md](v1-acceptance-plan.md): kiểm tra phần mềm, cơ chế hỗ trợ research, walkthrough và review người dùng; không yêu cầu phát hiện mới hoặc benchmark chứng minh năng lực khám phá trước phát hành. Chất lượng và hiệu quả được cải tiến từ các dự án sử dụng. Mọi benchmark cần hỏi riêng người dùng kèm protocol; các [đề xuất](benchmarks/README.md) hiện chỉ được thiết kế, chưa chạy.

Evidence của source hiện hành được tạo bằng node scripts/verify-v1.mjs trên Node.js v24.22.1:
- [v1-evidence.json](verification/v1-evidence.json): số test/pass/fail, source hashes, gate mapping và trạng thái chờ user review.
- [software-tests.tap](verification/software-tests.tap): từng test, gồm I1–I4, C1–C4, provenance, overlay/rollback và benchmark permission fixtures.
- [static-checks.json](verification/static-checks.json): syntax, sáu skill và reference links, config/task/research examples.
- [local-verification.json](local-verification.json): fallback mock gồm hai work units/ba attempts, giữ unit đã hoàn tất và tiếp tục từ checkpoint.

Đây là software verification, không phải benchmark LLM hoặc thực nghiệm tạo kiến thức mới. Bộ 60 test trước đã được giữ và mở rộng; xem evidence cho số lượng cuối thay vì coi số test là chỉ số năng lực research.

Môi trường hiện tại không có npm trong PATH nên đã chạy lệnh node --test tương đương package script. Validator quick_validate.py của Skill Creator không chạy được vì thiếu PyYAML; metadata/độ dài skill và các nguồn liên quan đã được kiểm tra bằng validator Node của dự án. Không cài thêm dependency toàn máy.

| Hạng mục | Source hiện có | Mức kiểm tra |
|---|---|---|
| I1: contracts/state | Work unit, assignment, checkpoint, recovery, pool/telemetry, state v3, migration v1/v2 có backup và old-writer guard | Schema và fixture kiểm tra dữ liệu runtime |
| I2: allocation | Unit dependency, estimate có nhãn, phân vị sau đủ mẫu, reserves, pool admission và ledger | Local tests; số liệu mock, chưa có calibration từ workload thật |
| I3: recovery | Durable checkpoint manifest, failure classification, generation, fallback, cooldown, bounded retries/no-progress | Fault injection cục bộ; CLI thật còn chưa được live-verify |
| I4: verification | Test suite, local demo/report, hướng dẫn verify và capability matrix | Người dùng có thể chạy lại trước khi cấp quyền bước tiếp theo |
| Năng lực nghiên cứu | Profile; hypotheses/derivations/experiment/evidence/review/claim/feedback có revision, validity, input snapshots và reference semantics; sáu skill/reference mở rộng | Record/context/checkpoint/handoff, positive/negative fixtures và C1–C4 được kiểm tra cục bộ; không chứng nhận model tự khám phá |
| Cải tiến trong sử dụng | Feedback gắn config/bundle, immutable project overlays, activation/rollback và event history | Kiểm tra evidence, owner/liveness, hash tamper, rollback và policy fingerprints |
| Quyền benchmark | Protocol/request hash, task/config/bundle fingerprint, xác nhận riêng từng campaign và aggregate limits | Permission state-machine fixtures; chưa chạy benchmark nào |
| Nghiệm thu | Gates V1-01–V1-11, verify-v1 runner, hướng dẫn và báo cáo hệ thống | Automated evidence sẵn để review; người dùng chưa nghiệm thu |
| Model tiers | model_policy, task_class/model_tier, explicit override, Codex effort argv, same-tier fallback và snapshot | Local routing/adapter tests; Astra High, Sol High và Sol Medium chưa được live-verified |
| Planning độc lập | Primary-source/research checks mới theo attempt, phân biệt analysis input, blocking questions và audit | Fixtures kiểm tra thiếu evidence, analysis-only, audit cũ và trạng thái chưa sẵn sàng; không chứng nhận LLM tự research đúng |

Sáu skill và role profiles là source dùng chung; chưa cài vào thư mục skill toàn máy hay tự sửa cấu hình cá nhân của Codex/Claude/Antigravity.

Các giới hạn còn rõ:
- Có Codex App Server adapter với usage events và control/input/checkpoint trong fixtures; chưa live-verified bằng inference. Có Codex percent quota read; Claude SDK/Antigravity native mới và quota API chung chưa triển khai.
- Tách prompt thành work units và chọn estimate_key do agent điều phối thực hiện.
- Snapshot quota thủ công/connector phải có nguồn và thời điểm; local reservation không giữ quota trên dịch vụ bên ngoài.
- Artifact/diff lệch hash cần kiểm tra; chưa có tự restore/merge filesystem.
- Job scheduler/GPU từ xa cần driver hoặc operator theo dõi/hủy và cập nhật bằng chứng; không có relaunch tự động khi trạng thái chưa rõ.
- Native children chưa đăng ký, OS sandbox, live auth/version compatibility và chất lượng khoa học chưa được nghiệm thu.

Xem [runtime](runtime.md), [hướng dẫn research](research-workflow.md), [verify](verify.md) và [báo cáo bàn giao](system-report.md). Live compatibility được xác minh khi backend được phép dùng; chưa có chiến dịch benchmark nghiên cứu không cản trở nghiệm thu core theo scope mới. Không cài/sửa personal skills hoặc chạy model/backend thật trong đợt implementation này.

Đồng bộ model policy ngày 25/10/2026: cả sáu skill, bốn role, domain, capability/acceptance plans và workflow dùng cùng ba task classes. Planning reference chỉ nạp khi cần; audited sources theo dõi drift kể cả ngoài task inputs. Context điều phối giữ model selection; runtime từ chối bỏ effort hoặc mượn mapping chưa có. Software tests gồm routing, stale planning sources, manifest tamper, pending/superseded requests và release probe từ final planner.

B01 chuẩn bị lại tại [b01_20261025_02](../benchmark-runs/b01_20261025_02/protocol.md): 17 calls dự kiến, 4 Astra High + 13 Sol High, 380.000 reservation tokens, 65 phút; script driver không gọi model low. Request mới pending, 0 attempts; request cũ superseded và giữ nguyên protocol/history. Chưa có benchmark/model call trong đợt cập nhật này.

Sau review: [operational-review-fixes.md](operational-review-fixes.md) ghi từng finding, hành vi đã sửa, regression và giới hạn. Bộ test hiện gồm 110 ca nền cùng regression mới; lấy số cuối từ verification/v1-evidence.json. Ở bản 0.3.1, state v2 được mở rộng có tương thích đọc lịch sử; bản 0.5.0 cần migration explicit sang v3; không reset budgets hoặc scientific evidence khi reopen.

B01 v2 trong benchmark-runs là artifact lịch sử pending, chưa chạy. Source fingerprints đã cũ sau sửa code và đường dẫn thay đổi; nó không còn run-ready. Chưa tạo/duyệt campaign thay thế và không sửa ngầm protocol/manifest đã pin.
