# Research domain

Research dùng ba trách nhiệm researcher, implementer, evaluator; điều phối chọn việc, quản lý nguồn lực và tích hợp. Position, role, skill, model, backend và quyền được cấu hình riêng. Một agent có thể đổi role theo task; claim chính cần evaluator với context độc lập.

Model policy phân theo công việc, không theo ba role: orchestrator mặc định analysis/medium (Sol High), làm tương tác người dùng và quản lý nhóm. synthesis_planning là cố vấn chuyên môn riêng ở highest (Astra High): tổng hợp analyses, tự kiểm chứng nguồn gốc/research lại rồi trả kế hoạch chi tiết cho orchestrator thực hiện; không tiếp quản điều phối. Automation cần agent mặc định low qua Antigravity Gemini 3.8 Flash High; explicit backend/task đã đóng băng giữ nguyên. Quy trình xác định chạy bằng script khi phù hợp. Planning lưu audit mới cho attempt trước khi chốt plan; việc nhỏ không bắt gọi cố vấn.

Luồng R0–R6: brief → literature → hypotheses/derivations và protocol → feasibility → evidence → cập nhật hiểu biết → paper/proof/report theo mục tiêu. Toán và thực nghiệm có thể bổ trợ nhau, quay lại giả định hoặc đổi hướng khi có phản chứng. Quality gate kiểm tra bằng chứng, không mặc định yêu cầu người dùng duyệt mỗi bước.

Năng lực cần hỗ trợ: đề xuất/so sánh giả thuyết; phát triển mô hình và suy dẫn toán học; thiết kế phép thử phân biệt; kiểm chứng/bác bỏ/cập nhật theo bằng chứng. Tái lập là bước hữu ích, không tự chứng minh khám phá. Research profile tách goal, reasoning_modes và output khỏi study_type/backend. Không ép một task nhỏ dùng đủ bốn năng lực.

Báo cáo xây harness là đầu ra riêng của dự án công cụ. Dự án nghiên cứu sử dụng harness vẫn có thể tạo paper, proof, thuật toán, code/dataset hoặc báo cáo. Không tự bỏ yêu cầu paper vì harness được bàn giao bằng báo cáo.

Empirical/reproduction dùng dữ liệu, baseline, metric và uncertainty phù hợp. Theoretical dùng giả định, nghĩa vụ chứng minh và phản ví dụ. Survey dùng chiến lược tìm, tiêu chí chọn và tổng hợp nguồn. Đọc rubric tương ứng với study_type, không áp mọi điều kiện thực nghiệm lên mọi nghiên cứu.

Claim có trạng thái supported, contradicted hoặc inconclusive. Hoàn thành task hay exit code 0 không tự xác nhận claim. Bằng chứng âm và nguồn trái chiều phải được giữ. Đổi protocol sau khi xem kết quả phải ghi phiên bản, lý do và phân biệt exploratory/confirmatory.

Record research có revision bất biến. Ref dependency phải còn hiệu lực; ref subject giữ đúng phiên bản đối tượng đã được quan sát/review. Dùng record-research/read-research/review-research/export-research để lưu, đọc và bàn giao. Conjecture, proof sketch, numerical check và verified proof có mức bằng chứng khác nhau. Trạng thái novelty tách riêng, không tự xác nhận tính mới toàn cầu.

Nghiệm thu công cụ kiểm tra cơ chế và vận hành; chất lượng nghiên cứu được cải tiến từ sử dụng có feedback gắn phiên bản. Mọi lần chạy benchmark cần hỏi trực tiếp người dùng kèm protocol, phạm vi, chi phí và điều kiện dừng. Không tự phê duyệt request hoặc coi local software tests là số đo khám phá.

Task nhỏ dùng một task record và output có thể kiểm tra. Chỉ chia worker khi bất định hoặc phần việc tách biệt có lợi. Nhiều seed/config dùng script/scheduler; không cần một LLM cho mỗi run. Code writers cần workspace riêng; runtime v1 chặn nhiều writer trong một project.
