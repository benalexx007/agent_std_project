# Application domain — bản nháp cho đợt sau

Trạng thái: **chưa tích hợp runtime, chưa được nghiệm thu**. Tài liệu này giữ lại phần chuẩn bị trong quá trình refactor shared harness; không phải hợp đồng Application đang hoạt động. Registry hiện khai báo Application là `enabled: false`.

Application hướng tới các dự án AI engineering và sản phẩm thực tế. Ba trách nhiệm logic vẫn là researcher, implementer và evaluator; evaluation bắt buộc nhưng dùng tiêu chí sản phẩm, không dùng mặc định nhãn proof/novelty của Research.

Đồ thị bản ghi dự kiến gồm `requirement`, `design_decision`, `implementation`, `verification`, `issue` và `acceptance`. Một task nhỏ có thể chỉ tạo một implementation artifact và một verification record; không phải tạo đủ sáu loại. Bản ghi pin revision, input/evidence/artifact hashes và quan hệ dependency/subject. Khi requirement, code, dữ liệu hoặc test evidence đổi, verdict phụ thuộc phải được kiểm tra lại.

Verification có `passed`, `failed`, `inconclusive`, `not_run`; acceptance có `accepted`, `rejected`, `needs_review`. Attempt hoàn thành không tự nâng thành acceptance. Acceptance cần bằng chứng hiện hành cho từng điều kiện và xử lý các blocking issues. Waiver, deploy, gửi dữ liệu và mở quyền thực thi vẫn cần authorization riêng.

Cố vấn `synthesis_planning` kiểm tra lại requirement, source code, data và tài liệu kỹ thuật gốc theo attempt hiện tại rồi trả kế hoạch cho orchestrator `analysis`. Nguồn Research chuyển sang Application bằng artifact import có provenance/hash; không dùng live record ID xuyên project.

Trước khi kích hoạt cần chốt schema chi tiết, state format và writer guard, GUI entry, context/rubric, extension routing, checkpoint/handoff và workflow mock với negative tests. Xem [plan đa domain](multi-domain-integration-plan.md) để biết gate nghiệm thu.
