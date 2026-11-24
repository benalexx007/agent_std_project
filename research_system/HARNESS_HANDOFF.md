# Bàn giao Research Harness

Cập nhật: 16/11/2026. Đây là bản đồ để người hoặc agent mới hiểu hệ thống từ mục tiêu đến vận hành, kiểm thử và các việc còn mở. Báo cáo kiểm thử là bằng chứng theo thời điểm; kiểm source và state hiện tại trước khi thay đổi.

## 1. Mục tiêu và ranh giới

Research Harness phục vụ các dự án nghiên cứu AI engineering. Agent điều phối chia việc, tương tác với người dùng và tổng hợp. Researcher, implementer, evaluator là ba trách nhiệm logic, có thể được giao cho một hay nhiều worker. `synthesis_planning` là cố vấn riêng: tổng hợp analyses, kiểm tra lại nguồn và đề xuất kế hoạch cho orchestrator. Harness lưu state, kiểm quyền, context, ngân sách, provenance, checkpoint, publication và recovery. Provider hoàn tất, core chấp nhận kết quả và đánh giá khoa học là các kết luận khác nhau.

Đọc [README](README.md) cho tổng quan, [system report](docs/system-report.md) cho quyết định kiến trúc và [research workflow](docs/research-workflow.md) cho cách tiến hành nghiên cứu.

## 2. Bản đồ source

| Vị trí | Trách nhiệm |
|---|---|
| [scripts/harness.mjs](scripts/harness.mjs) | CLI inspect, task, control, recovery, research và GUI. |
| [src/](src/) | Core Node.js/SQLite. Bắt đầu ở `config.mjs`, `store.mjs`, `engine.mjs`, `context.mjs`, `runner.mjs`, `publication.mjs`, `research.mjs`, `gui-service.mjs`. |
| [adapters/](adapters/) | Giao thức với Codex, Claude, Antigravity, command/manual/mock. |
| [schemas/](schemas/) | Hợp đồng config, task, result, record và checkpoint. |
| [domains/research/](domains/research/) và [skills/](skills/) | Vai trò, rubric, hướng dẫn nghiên cứu. |
| [integrations/research-project/](integrations/research-project/) | Entry cho GUI backend; xem [GUI integration](docs/gui-integration.md). |
| [extensions/research/](extensions/research/) | Helpers có scope, manifest và lock; xem [extensions](docs/extensions.md). |
| [test/](test/), [examples/](examples/), [benchmarks/](benchmarks/) | Regression, ví dụ và benchmark có cổng phê duyệt riêng. |

[Runtime](docs/runtime.md) giải thích state machine, ownership và recovery; [model routing](docs/model-routing.md) giải thích task class/backend; [user guide](docs/user-guide.md) hướng dẫn dùng trong project thực. Các plan lịch sử cần đối chiếu với source và báo cáo mới hơn.

## 3. Vòng đời một project

1. Xác định câu hỏi, quyền và giới hạn; tạo config riêng tại project. Inspect và preflight trước khi kết nối hoặc đăng ký task. Config trên đĩa có thể khác snapshot đã đăng ký trong state.
2. Nếu dùng GUI, tạo project connection và kiểm binding/owner epoch. GUI làm orchestrator; managed worker chạy qua runner với attempt logs, còn native subagent do host điều khiển có observation hạn chế.
3. Đăng ký task Research, preview admission, dispatch khi có quyền. Task nhỏ có thể inline; task lớn có thể tách work units và nhiều worker. Chỉ gọi cố vấn planning khi công việc cần.
4. Worker trả result/artifact/evidence. Core kiểm schema, hash, trạng thái và publication; evaluator/người dùng kiểm nội dung. Research records và checkpoint giữ provenance.
5. Khi pause, mất quota hay đổi orchestrator, đọc state/attempt/job trước; owner mới takeover theo epoch và attach lại. Active/unknown jobs cần observation/reconciliation, không retry mù. Xem [GUI integration](docs/gui-integration.md) và [runtime](docs/runtime.md).

Các lệnh đọc từ thư mục này, thay đường dẫn project:

```powershell
node scripts/harness.mjs inspect-project --workspace D:\path\to\project --full
node scripts/harness.mjs gui-catalog
node scripts/check-project.mjs
```

## 4. Phiên bản và kiểm thử

Package hiện ghi `0.7.0`, yêu cầu Node >=24. Shared harness có Research façade; `application` ở registry nhưng `enabled: false`. [Plan đa domain](docs/multi-domain-integration-plan.md) và [Application draft](docs/application-domain-contract-draft.md) để dành đợt sau, chưa phải Application end-to-end.

[Báo cáo foundation](docs/verification/multi-domain-foundation-2026-11-02.md) ghi 235/235 software tests với extension lock **tạm** theo môi trường được kiểm, rồi khôi phục lock tracked. Đây không chứng nhận extension-enabled execution trên checkout nguyên trạng khi Python/Poppler binding đã đổi. Test phần mềm cũng không đo chất lượng khám phá khoa học hoặc live GUI/backend.

Khi nhận bàn giao: xác nhận commit/branch, `git status`, Node/Python, extension lock và file môi trường; đọc [AGENTS.md](AGENTS.md). Chạy `node scripts/check-project.mjs` và test script trong [package.json](package.json), ghi rõ failures/skips và runtime lock. Không tự relock để che drift.

## 5. Pilot run là case study, không phải toàn bộ hệ thống

Một project nghiên cứu pilot (nội bộ, chưa công bố) là lần chạy đầu của Research Harness. Báo cáo sự cố của lần chạy đó (không đi kèm repo này) có chronology, 18 incident và bằng chứng lịch sử; không chứa toàn bộ database, blobs hoặc PDF. Để kiểm một claim, đối chiếu với source hiện tại và state của project pilot read-only.

Các khoảng trống nhận diện trong review source ngày 16/11: Diagnosis13 có corrected result cho ba evidence paths nhưng attempt gốc `failed/settled/unpublished` và chưa có recovery tương ứng; adapter Antigravity có thể chuyển cache counter không phù hợp schema làm rớt result; validation failure có thể làm mất actual usage; SUCCESS kèm `denied_actions`, terminal ERROR và worker-facing `control_root` cần xử lý rõ hơn. Full context preview, SQLite retry hữu hạn và successful helper receipt recovery đã có code/test. Chưa thực hiện các sửa còn mở trong file bàn giao này.

Thứ tự sửa đề xuất: fixture nhỏ cho transport/usage; kiểm scoped workspace của command worker; rồi immutable amendment và publication journal riêng cho settled failure, giữ nguyên lịch sử attempt/ledger. Source intake, deadline và script preparation của project pilot cần phân loại riêng trước khi sửa core. Không sửa live DB hoặc chạy lại model chỉ để hợp thức hóa ba path.

## 6. Quy tắc đọc tài liệu

`docs/*plan*.md` và các báo cáo verification là lịch sử thiết kế/kiểm thử. Source, schema, state và receipt tại đúng phiên bản quyết định hành vi thực tế. Không nạp toàn bộ log hoặc phụ lục của project pilot vào context một lượt; đọc theo task và hash được chỉ ra trong manifest.
