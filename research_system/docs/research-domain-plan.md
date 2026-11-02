# Kế hoạch xây domain Research

Ngày: 25/10/2026  
Cập nhật: hoàn thiện kế hoạch năng lực nghiên cứu và nghiệm thu v1 theo cơ chế hỗ trợ, kiểm thử phần mềm và review người dùng; tối ưu dần trong sử dụng. Báo cáo chỉ là đầu ra của dự án xây harness, các dự án research vẫn hỗ trợ paper/proof và đầu ra khác.  
Trạng thái: I1–I4, lớp hỗ trợ research và nhánh Codex native điều phối đã có trong source v0.4.0, có software evidence và báo cáo bàn giao, chờ người dùng review/nghiệm thu. Mỗi benchmark phải hỏi riêng kèm protocol; live backend/thí nghiệm theo quyền đã cấp. Không cần benchmark khám phá để nghiệm thu v1. Chi tiết ở docs/implementation-status.md.  
Workspace: D:/Code/AI/agentic_std_proccess

Cập nhật ngày 27/10/2026: nhánh [Codex native điều phối](codex-native.md) của plan cũ đã có trong source 0.4.0, với software fixtures và P0 metadata/static lịch sử source 0.4.0, chưa có inference/benchmark thật. Core quản lý root workers và giữ khả năng đổi backend; native_group chưa bật. [Plan tích hợp bản 4](runtime-integration-plan.md) cùng [khảo sát C01–C18](capability-integration-research.md) đề xuất workspace/publication, recovery/accounting, reuse và native delegation theo lợi ích thực tế; [Lát cắt 0.5.0](integration-foundation.md) đã triển khai workspace/publication, counter baseline và native collect/quota; native groups/session reuse còn conditional. Năng lực nghiên cứu là ràng buộc khi tối ưu. Xem [nghiệm thu tối thiểu](acceptance-minimal-protocol.md).

## 1. Mục tiêu và phạm vi đã thống nhất

Xây bộ công cụ dùng AI agent để tạo và kiểm chứng hiểu biết mới trong các dự án nghiên cứu AI engineering: phát triển giả thuyết, khai triển toán học, thiết kế/hiện thực thực nghiệm và dùng bằng chứng để sửa hoặc bác bỏ nhận định. Domain hỗ trợ đầy đủ chu trình khám phá; việc đọc literature và dùng phương pháp đã có là một phần của chu trình.

Hai loại đầu ra được phân biệt rõ: dự án xây hệ thống agentic này bàn giao source, hướng dẫn, evidence kiểm thử và báo cáo hệ thống; không cần paper về harness. Dự án research sử dụng hệ thống vẫn có thể tạo paper, proof, thuật toán, code/dataset, báo cáo hoặc gói kết quả theo yêu cầu người dùng. Hỗ trợ paper thuộc domain hiện tại, không bị bỏ hay trì hoãn vì lựa chọn báo cáo cho harness.

Đặc tả chi tiết: [năng lực nghiên cứu](research-capability-plan.md). Tiêu chí bàn giao và cải tiến: [nghiệm thu v1](v1-acceptance-plan.md). Implementation và evidence tương ứng được đối chiếu trong [báo cáo hệ thống](system-report.md); không suy ra năng lực khoa học của model từ software checks.

- Hai domain của hệ thống tổng thể là research và application. Tài liệu này đặc tả research.
- Research luôn có ba trách nhiệm: researcher, implementer, evaluator. Điều phối là trách nhiệm vận hành riêng, có thể kết hợp với một vai trò khi tác vụ nhỏ.
- Role, skill, backend, model và quyền thực thi là các thành phần riêng.
- Ba tầng model theo task class, không theo role: synthesis_planning → highest (Codex GPT-6 Astra High), analysis/implementation/trao đổi thường → medium (GPT-6.1 Sol High), automation → low (GPT-6.1 Sol Medium). Provider khác chưa cấu hình. Xem [model policy](model-routing.md).
- Tầng planning phải tự verify và research lại nguồn gốc/claim quan trọng, không tin hoàn toàn analysis. Giữ audit mới gắn attempt, bằng chứng, bất đồng và câu hỏi còn chặn trước khi chốt plan; schema/provenance checks không thay content review.
- Đổi backend điều phối hoặc worker không yêu cầu viết lại nội dung khoa học của skill.
- Vai trò được chọn từ config; yêu cầu trực tiếp của người dùng có thể tạo override có phạm vi cho một lần chạy.
- Tác vụ nhỏ xử lý trực tiếp; tác vụ lớn mở rộng theo phần việc độc lập. Evaluation luôn có mặt nhưng mức kiểm tra tương xứng với tác vụ.
- Nghiệm thu hệ thống dựa trên khả năng hỗ trợ quy trình, tính đúng của phần mềm, kiểm soát và truy vết. Chất lượng/giá trị/tính mới của từng kết quả được xem xét trong dự án sử dụng; không yêu cầu tìm được tri thức mới để bàn giao v1. Kết quả âm hoặc chưa đủ dữ kiện được giữ đúng trạng thái.
- Khó có thước đo phổ quát cho khám phá mở không có nghĩa từng claim không thể kiểm tra. Chứng minh, phản ví dụ, kiểm tra nguồn và thực nghiệm vẫn là nghĩa vụ nghiên cứu phù hợp với từng claim. Không dùng số paper/ý tưởng hoặc điểm LLM tự chấm làm điều kiện phát hành.
- Tối ưu theo chi phí để có kết quả được kiểm chứng, gồm token, compute và thời gian con người; không cắt bằng chứng chỉ để giảm token.
- Người dùng có thể hỏi, bổ sung, đổi hướng, tạm dừng, hủy và tiếp tục khi hệ thống đang chạy. Harness chịu trách nhiệm thực thi quyền điều khiển, không chỉ dựa vào prompt.
- Quyền đã cấp có phạm vi và được kế thừa qua phiên bàn giao; quality gate không mặc nhiên là một lần xin phép.
- Các cơ chế context, budget, control và handoff là phần dùng chung của harness. Domain research bổ sung protocol, claim, provenance và rubric; domain application sẽ được đặc tả riêng.
- Công việc thuộc task/work unit bền vững; sub-agent chỉ là bên được giao thực hiện một attempt. Có thể đổi worker mà giữ acceptance, protocol và phần tiến độ đã kiểm chứng.
- Hạn chế cạn tài nguyên bằng phân bổ có dự phòng và checkpoint sớm; không hứa loại bỏ hoàn toàn lỗi quota/context hoặc khôi phục phần chưa kịp lưu.

Các loại nghiên cứu cần biểu diễn trong cấu hình:
- empirical: phương pháp, hệ thống, mô hình, dataset hoặc benchmark có thực nghiệm;
- reproduction: tái lập hoặc kiểm chứng kết quả đã công bố;
- theoretical: giả định, phát biểu, chứng minh và phản ví dụ;
- survey: chiến lược tìm kiếm, tiêu chí chọn tài liệu và tổng hợp bằng chứng.

Study type mô tả phương pháp, không xác định mức đóng góp. Một dự án có thể kết hợp toán học và thực nghiệm; từng task chọn hướng dẫn phù hợp. Profile nghiên cứu sẽ tách mục tiêu tái lập/mở rộng/khám phá, thành phần suy luận cần dùng và output khỏi backend/model.

Bản đầu dùng fixture/walkthrough để kiểm tra cơ chế hỗ trợ; không bắt buộc pilot tạo kiến thức mới hoặc benchmark nghiên cứu. Sau bàn giao, cải tiến từ công việc thực tế. GPU, baseline, seed hay thống kê chỉ áp dụng khi câu hỏi của dự án cần.

## 2. Đầu vào và đầu ra của một dự án

Đầu vào:
- Câu hỏi hoặc chủ đề; loại nghiên cứu; mức độ mới mong muốn.
- Code, dữ liệu, paper hoặc kết quả đã có.
- Tài nguyên được sử dụng; giới hạn thời gian, compute và chi phí.
- Mục tiêu tri thức và đầu ra của dự án: paper, proof, phương pháp/thuật toán, code/dataset, báo cáo hoặc kết luận nội bộ.
- Người đọc, ngôn ngữ, định dạng và venue nếu dự án research cần. Báo cáo xây harness được quy định riêng ở mục 9.1.

Đầu ra:
- Research brief và bản đồ literature có nguồn kiểm tra được.
- Giả thuyết/lập luận có phiên bản, assumptions, nghĩa vụ chứng minh hoặc dự đoán; protocol và các quyết định thay đổi theo bằng chứng.
- Code/chứng minh/quy trình tổng hợp phù hợp với loại nghiên cứu.
- Kết quả gốc, cấu hình, môi trường và chỉ dẫn tái lập khi có thực nghiệm.
- Liên kết từ claim tới bằng chứng và đánh giá.
- Paper/proof/báo cáo hoặc gói kết quả theo mục tiêu dự án, cùng hình/bảng cần thiết, nguồn tham khảo và giới hạn. Không buộc mọi task phải tạo tài liệu dài.
- Báo cáo evaluator, vấn đề còn mở và bản bàn giao cho phiên/agent tiếp theo.

Thông tin chưa biết được ghi rõ là chưa biết. Không tự tạo yêu cầu khoa học, ngân sách hoặc kết quả.

## 3. Trách nhiệm của ba vai trò

| Vai trò | Trách nhiệm | Đầu ra chính | Ranh giới |
|---|---|---|---|
| Researcher | Phát triển câu hỏi, giả thuyết cạnh tranh, mô hình/lập luận toán học, dự đoán và thiết kế phép kiểm tra; cập nhật hiểu biết và viết theo đầu ra dự án | Brief, hypotheses, derivations/proof obligations, protocol, claim, paper/proof/report | Không khẳng định novelty chỉ vì chưa tìm thấy paper; không nâng conjecture hay kiểm tra số thành chứng minh |
| Implementer | Nối công thức/giả định với code, xây simulator/measurement/verifier khi cần; thực thi protocol và lưu evidence | Code, math–code mapping, run manifest, raw results, verifier output | Không tự thay metric/split/protocol hoặc bỏ giả định để làm kết quả đẹp hơn |
| Evaluator | Rà suy dẫn/proof, thiết kế phép thử, tìm phản ví dụ/giải thích cạnh tranh và kiểm tra scope của claim bằng evidence gốc | Findings, phản chứng, mức evidence và nghĩa vụ chưa giải quyết | Verdict LLM và approval người dùng không thay thế bằng chứng hoặc verifier chuyên biệt |

Điều phối:
- Chọn phần việc tiếp theo theo trạng thái nghiên cứu.
- Quyết định làm trực tiếp, giao một worker hoặc chia các nhánh độc lập.
- Giao task contract; kiểm soát phụ thuộc, tài nguyên và phạm vi sửa file.
- Tích hợp kết quả, xử lý bất đồng bằng bằng chứng và giữ trạng thái bàn giao.

Một agent có thể lần lượt thực hiện nhiều vai trò. Với đánh giá claim chính hoặc kết quả cuối, dùng evaluator có context mới. Context mới nhận protocol và artifact đủ để kiểm chứng; không được mớm kết luận mong đợi. Bất đồng chưa giải quyết được phải giữ trạng thái chưa đủ bằng chứng.

## 4. Luồng nghiên cứu và điều kiện chuyển bước

Đây là luồng có thể lặp lại và quay về bước trước. Có thể bắt đầu ở giữa khi dự án đã có artifact được kiểm tra.

| Bước | Công việc | Vai trò chủ trì | Bằng chứng/đầu ra | Điều kiện chuyển bước |
|---|---|---|---|---|
| R0. Định hình | Chốt vấn đề, câu hỏi, loại nghiên cứu, phạm vi, nguồn lực và đầu ra | Researcher | Research brief | Câu hỏi đủ rõ và có cách xác định câu trả lời |
| R1. Literature | Tìm và đọc nguồn, so sánh phương pháp, ghi nhận kết quả trái chiều và khoảng trống | Researcher | Evidence map và thư mục tài liệu tham khảo | Nguồn cốt lõi đã kiểm tra; giả định về novelty được giới hạn đúng mức |
| R2. Giả thuyết và suy dẫn | Đề xuất/mở rộng hypotheses, mô hình/toán học, assumptions và dự đoán/proof obligations; thiết kế phép thử phân biệt | Researcher + evaluator | Hypothesis/derivation records và protocol có phiên bản | Nêu rõ phần đã biết, phần đề xuất, điều kiện bác bỏ hoặc nghĩa vụ chứng minh; kiểm tra khả thi trong nguồn lực |
| R3. Kiểm tra khả thi | Hiện thực tối thiểu; kiểm tra dữ liệu, metric và baseline; thử trên phạm vi nhỏ | Implementer | Code và pilot evidence | Pipeline/luận chứng cơ sở đúng; sai lệch với nguồn tham chiếu được giải thích |
| R4. Thu và kiểm tra bằng chứng | Thực nghiệm, kiểm tra symbolic/numerical, proof hoặc tìm phản ví dụ theo protocol; lưu cả thất bại | Implementer + evaluator theo nghĩa vụ | Runs/proof checks/raw outputs và evidence updates | Bằng chứng có phạm vi, provenance và kết quả kiểm tra; khi thiếu/sai quay lại R2/R3 |
| R5. Cập nhật hiểu biết | Đối chiếu dự đoán với evidence, kiểm tra giải thích cạnh tranh/lỗi phép đo; giữ, sửa, bác bỏ hoặc tạm dừng giả thuyết | Researcher + evaluator | Claim–evidence map, review và quyết định bước tiếp theo | Phân biệt supported/contradicted/inconclusive; không thay nghĩa kết luận sau khi xem kết quả mà không ghi revision |
| R6. Trình bày và bàn giao | Viết paper/proof/report theo mục tiêu; rà citation, hình/bảng, gói tái lập và limitations | Researcher + implementer + evaluator | Đầu ra dự án, artifact package, review findings | Claim đúng mức bằng chứng; phần chưa kiểm chứng và nghĩa vụ còn mở được nêu rõ |

Các điều kiện chuyển bước là quality gate. Không yêu cầu con người phê duyệt đủ bảy bước; chỉ chờ khi thiếu quyết định/thẩm quyền theo mục 8.2. Evaluator xác định mức hỗ trợ của bằng chứng; người dùng quyết định đầu tư tiếp hoặc đổi mục tiêu.

Trong dự án research có thể bắt đầu outline, phương pháp và bản thảo sớm; kết quả/kết luận chỉ điền theo bằng chứng. Không áp mốc bàn giao harness lên thời điểm viết paper của dự án sử dụng. Báo cáo xây hệ thống được viết khi hoàn thiện scope v1 ở M6.

Vòng R2–R5 có thể lặp theo bất định thực tế, kết hợp toán và thực nghiệm; không bắt buộc số vòng hay một chuỗi tool call cố định. Nhánh không tiến bộ hoặc hết budget được bàn giao với obligations còn mở. Tối ưu theo lượng bất định được giải quyết có căn cứ, không chỉ theo metric tốt nhất hoặc số ý tưởng.

Với theoretical: protocol mô tả giả định/phát biểu/nghĩa vụ chứng minh; evaluator kiểm tra logic và phản ví dụ. Với survey: protocol mô tả chiến lược tìm kiếm, tiêu chí đưa vào/loại bỏ, cách trích xuất và tổng hợp. Điều kiện thực nghiệm không được áp đặt máy móc lên hai loại này.

Thay đổi protocol sau khi đã xem kết quả phải được ghi phiên bản và lý do; phân biệt phân tích khám phá với đánh giá xác nhận. Dữ liệu dùng để lựa chọn phương án và dữ liệu đánh giá cuối phải được quản lý phù hợp với thiết kế nghiên cứu.

## 5. Danh mục skill dự kiến

Nội dung role quy định trách nhiệm. Skill cung cấp quy trình có thể gọi theo nhu cầu; không đóng gói toàn bộ công việc của một vai trò vào một prompt dài.

| Skill | Khi kích hoạt | Kết quả cần tạo | Phần kiểm tra |
|---|---|---|---|
| research-scope | Chủ đề/câu hỏi còn mơ hồ hoặc cần đánh giá tính khả thi | Brief, câu hỏi, giả định, phạm vi và điều kiện dừng | Câu hỏi có thể kiểm tra và phù hợp tài nguyên |
| research-literature | Tìm/đọc/so sánh paper hoặc kiểm tra nguồn cho claim | Evidence map và citation metadata | Nguồn tồn tại; nội dung thực sự hỗ trợ nhận định |
| research-design | Phát triển giả thuyết, khai triển toán học, thiết kế phép kiểm tra hoặc sửa protocol | Hypotheses, derivations/obligations, predictions và protocol | Assumptions, tính phân biệt giả thuyết, confounder và điều kiện bác bỏ |
| research-experiment | Hiện thực phương pháp, thực nghiệm, proof/tool check khi phù hợp | Math–code mapping, manifests, output và evidence updates | Đúng phép đo/giả định, mức chứng cứ, command/version và tính toàn vẹn |
| research-evaluate | Kiểm tra giả thuyết, suy dẫn, thiết kế, code, evidence và claim | Findings, phản ví dụ/giải thích cạnh tranh, verdict theo scope | Chọn rubric; tách proof/empirical support/novelty; giữ phần chưa biết |
| research-write | Viết/chỉnh paper, proof notes, báo cáo hoặc hình/bảng theo mục tiêu | Đầu ra dự án có trace tới bằng chứng | Claim/citation/số liệu và mức chứng minh nhất quán; venue khi cần |

Giữ sáu skill, thêm references cho hypothesis, mathematical reasoning, experiment design và evidence update theo [kế hoạch năng lực](research-capability-plan.md). References và context routing đã có trong v0.3; chưa được coi là kiểm nghiệm năng lực khoa học của model. Skill dùng định dạng Agent Skills; reference theo study_type và thành phần suy luận được nạp khi cần. Đường dẫn phát hiện skill, metadata UI và cấu hình native thuộc adapter từng công cụ. Chỉ tạo reference/script khi có trường hợp sử dụng cụ thể.

## 6. Các script và hợp đồng dữ liệu

Ưu tiên CLI nhỏ với lệnh rõ, triển khai theo các gate v1 và nhu cầu sử dụng. Tên nhóm chức năng bên dưới là đề xuất; source và mức kiểm tra thực tế được ghi riêng.

| Nhóm chức năng | Trách nhiệm |
|---|---|
| validate-config | Kiểm tra schema, backend, role, skill, capability và override; xuất cấu hình hiệu lực |
| run-task | Chuẩn bị context theo task, workspace, giới hạn và gọi adapter; đăng ký attempt/job trước khi dispatch; thu trạng thái/output |
| control-task | Nhận status/steer/pause/cancel/resume; lưu sự kiện, chặn dispatch theo phạm vi và chuyển yêu cầu tới adapter/job controller |
| reconcile-state | Đối chiếu trạng thái lưu với backend/job thực tế sau reconnect, crash, cancel hoặc đổi điều phối |
| record-run | Ghi manifest, phiên bản code/dữ liệu/model, config, seed nếu áp dụng, môi trường và artifact |
| collect-results | Đọc output, kiểm tra schema; phân biệt failed, missing và completed; tổng hợp theo protocol |
| check-evidence | Kiểm tra liên kết claim–source/run–table/figure; phát hiện nguồn thiếu hoặc artifact thay đổi |
| create-handoff | Đóng gói mục tiêu, quyết định, công việc đang chạy, artifact và bước tiếp theo |
| plan-work / allocate-budget | Chia work unit có điểm dừng; ước tính chi phí/context, kiểm tra quota pool và giữ ngân sách trước dispatch |
| save-checkpoint | Lưu tiến độ từng work unit, artifact/hash, checks, job đang chạy và phần chưa chắc chắn; xác nhận checkpoint đã lưu bền vững |
| recover-task / reassign-work | Phân loại nguyên nhân dừng, đối chiếu side effect/job, chọn worker kế tiếp và chuyển assignment có phiên bản |
| verify-artifacts | Kiểm tra khả năng mở/chạy artifact, liên kết nguồn/bằng chứng, dữ liệu hình/bảng và build paper/report khi định dạng/công cụ dự án yêu cầu |

Scripts kiểm tra tính đầy đủ và nhất quán có thể tự động hóa. Đánh giá novelty, tính hợp lý khoa học hoặc giá trị đóng góp vẫn cần researcher/evaluator và phán đoán chuyên môn.

Các hợp đồng tối thiểu:
- Task: task_id, domain, study_type, role, objective, inputs, dependencies, acceptance, workspace, capabilities, budget; thêm task_revision, effective_config_ref, context_refs, stop_conditions và quyền đã cấp có liên quan.
- Work unit: work_unit_id, task_id/revision, mục tiêu hẹp, inputs/dependencies, acceptance, ownership/workspace, checkpoint boundary, estimate và trạng thái tiến độ. Task nhỏ có thể chỉ có một work unit.
- Assignment: assignment_id, work_unit_id, worker/backend/model, quota_pool_id, generation, lease/heartbeat và giới hạn đã cấp. Worker lease tách khỏi owner_epoch của điều phối.
- Attempt: attempt_id, task_id/revision, work_unit_id, assignment_id/generation, owner_epoch, backend/session/turn IDs, dispatch_key, trạng thái mong muốn và quan sát được, job_refs, timestamps, failure_reason, retryability, resumed_from_checkpoint, supersedes_attempt_id. Mỗi lần chuyển worker/chạy lại là attempt mới; không sửa lịch sử attempt cũ.
- Result: task_id/revision, attempt_id, protocol_version nếu áp dụng, status, summary, artifacts, evidence_refs, checks, limitations, unresolved, usage; thêm validity và lý do khi output bị stale/invalidated.
- Run: run_id, attempt_id, protocol_version, code_revision và patch/hash nếu code chưa commit, data_version, config, model_version nếu có, environment, start/end, status, outputs.
- Claim: claim_id, statement, scope, supporting/contradicting evidence, evaluation_status; liên kết hypotheses/derivations khi có. Scientific support tách khỏi execution status và nhận định novelty.
- Research records: brief/profile, hypothesis, derivation/proof, experiment plan, evidence update và research review theo mục 5 của [kế hoạch năng lực](research-capability-plan.md). Có version, assumptions, predictions/obligations, raw evidence và phần chưa biết; không mặc định đưa toàn bộ vào state chung hay mỗi context.
- Usage feedback: case/artifact/config version, quan sát của người dùng, bằng chứng, thay đổi đề xuất và kết quả review; dùng cho cải tiến có phiên bản.
- Control event: event_id, người gửi, action, target/scope, expected_revision, timestamp, payload, trạng thái tiếp nhận/áp dụng/xác minh và bằng chứng kết quả. Gửi lại cùng event_id không tạo thao tác mới.
- Decision: decision_id, câu hỏi, lý do phải hỏi, lựa chọn/tác động, khuyến nghị, affected_tasks, context/protocol revision, quyết định và phạm vi hiệu lực; thiếu câu trả lời không phải đồng ý.
- Checkpoint: checkpoint_id/sequence, task/work unit revision, protocol version, assignment generation, completed/remaining units, artifact hashes/code diff, checks đã chạy, pending side effects/job handles, decisions/uncertainties, durable_at, provenance và trust level.
- Budget/quota snapshot: scope, unit, limit/used/reserved, remaining nếu có, quota_pool_id, resets_at/retry_after, observed_at, source, precision và enforcement level; unknown khác 0.
- Recovery record: trigger/classification, checkpoint được chọn, nguồn/đích assignment, kiểm tra tính tương thích, đối chiếu job/side effect, phần công việc được chuyển, chi phí tiếp quản và kết quả.
- Handoff: project state, current owner/epoch, completed/running/blocked tasks/work units, decisions/authorizations, pending control events, job handles, remaining budget/reserves, checkpoint/recovery references, next actions.

Đây là các nhóm dữ liệu logic; task nhỏ có thể ghi chung trong một record. Không bắt buộc tạo một file cho mỗi nhóm. Schema chi tiết và nơi lưu được chốt ở M1–M3, ưu tiên cấu trúc tối thiểu đủ kiểm chứng.

Mỗi loại thông tin có một nguồn chính. Raw output được bảo toàn; bảng/hình là kết quả dẫn xuất có thể tạo lại. Agent session ID được lưu trong metadata backend, không làm ID chung của task.

## 7. Config, prompt override và khả năng thay thế agent

Config phân biệt:
- project: domain, study_type, mục tiêu và đường dẫn;
- role definitions và skill bindings;
- backend/model selection cho điều phối và worker;
- execution: trực tiếp, hỗ trợ hoặc điều phối thích ứng;
- capabilities, workspace access và budget;
- work allocation: đơn vị công việc, dependency graph, tiêu chuẩn checkpoint, estimator và giới hạn fan-out;
- resource pools: nhóm backend/model dùng chung quota, loại giới hạn, tuổi dữ liệu telemetry và giới hạn đồng thời;
- recovery policy: nguồn fallback được phép, điều kiện chuyển, ngân sách tiếp quản, giới hạn số lần chuyển và yêu cầu tương đương của worker;
- context policy: nội dung nền, references theo task, giới hạn output và quy tắc tái sử dụng;
- autonomy policy: việc tự quyết, việc cần người dùng và phạm vi quyền đã cấp;
- control policy: phạm vi pause/cancel, điểm checkpoint, thời gian chờ xác nhận, cách xử lý backend không hỗ trợ;
- rubric, artifact conventions và reporting.

Override từ yêu cầu trực tiếp của người dùng:
1. Phân giải thành thay đổi có cấu trúc.
2. Kiểm tra schema, capability và ràng buộc thực thi.
3. Lưu snapshot cấu hình hiệu lực trước khi chạy.
4. Áp dụng cho lần chạy hoặc phần việc được chỉ định; chỉ ghi lại mặc định dự án khi người dùng yêu cầu.
5. Nếu thay vai trò trong phiên đang chạy, chuyển tại điểm bàn giao rõ; tạo context mới khi cần đánh giá độc lập.

Adapter có giao diện submit/status/collect/cancel và khai báo capability cho steer, pause, resume, streaming, theo dõi usage và quản lý job con. Một phương thức có trong interface không đồng nghĩa backend hỗ trợ; kết quả unsupported/unknown phải rõ. Khi không hỗ trợ resume native, có thể mở phiên mới từ handoff; phải báo đúng là tiếp tục từ artifact, không phải khôi phục nguyên session. Pause workflow tại ranh giới task cũng không đồng nghĩa đóng băng tiến trình đang chạy. Mục 8.3 quy định cách ánh xạ điều khiển; mục 8.4 quy định phòng ngừa cạn tài nguyên và chuyển việc.

Điều phối mới đọc trạng thái ngoài chat. Bảo đảm một chủ sở hữu điều phối tại một thời điểm bằng cơ chế owner/epoch có hiệu lực ở nơi dispatch và tích hợp kết quả; owner cũ không được phát lệnh mới sau bàn giao. Đối chiếu job đang chạy trước khi giao việc lại. Agent ngoài dùng quyền và sandbox riêng; không giả định kế thừa quyền từ điều phối. Prompt override không vượt quyền thực thi của môi trường; quyền dự án được lưu để tránh hỏi lặp nhưng backend vẫn có thể yêu cầu xác nhận riêng.

## 8. Chính sách thực thi: sub-agent, token và human-in-the-loop

- Task nhỏ, rõ và dễ kiểm tra: làm trực tiếp; ghi kết quả trong task record hoặc báo cáo hiện có.
- Có một bất định tách biệt: giao một worker khảo sát hoặc kiểm chứng.
- Có nhiều nhánh độc lập: giao nhiều worker, với phụ thuộc và phạm vi sở hữu rõ.
- Researcher có thể chia theo câu hỏi hoặc nguồn bằng chứng; có bên tổng hợp cuối.
- Implementer chia theo implementation độc lập hoặc module đã có interface; dùng worktree/workspace riêng cho ghi song song.
- Nhiều seed/config được chạy bằng script/scheduler nếu không cần quyết định riêng từ LLM.
- Evaluator mở rộng theo góc kiểm tra khác nhau, không chỉ nhân bản cùng một prompt.
- Giới hạn agent và job compute được quản lý riêng, tránh tranh chấp GPU/API.
- Bắt đầu với một backend chính; thử backend bổ sung ở tác vụ có thể đo được lợi ích. Không gắn cố định vai trò với hãng.


### 8.1. Tối ưu token và chi phí toàn quy trình

Mục tiêu là giảm chi phí để đạt cùng tiêu chuẩn khoa học, không tối thiểu hóa số token của riêng điều phối.

**Context theo nhiệm vụ**
- Phần context nền do dự án quản lý chỉ chứa mục tiêu, ràng buộc chung và catalog role/skill ngắn; system instructions và tool metadata của nền tảng có thể vẫn tạo overhead ngoài quyền kiểm soát của harness. Chỉ nạp role đang dùng, skill liên quan và reference phù hợp study_type.
- Mỗi task nhận brief, acceptance, protocol/decision liên quan, artifact references có phiên bản và phần thay đổi từ lần trước. Không mặc định sao chép toàn bộ chat hoặc toàn bộ literature cho từng worker.
- Output thường gồm kết luận ngắn, bằng chứng/đường dẫn, kiểm tra đã chạy, giới hạn và bước cần xử lý. Raw log, paper, dữ liệu và trace lưu ngoài context, có thể truy xuất khi cần.
- Evaluator độc lập nhận protocol, rubric và bằng chứng gốc đủ kiểm tra; không chỉ nhận bản tóm tắt do implementer chọn. Giữ cả kết quả âm, nguồn trái chiều và vấn đề chưa giải quyết.
- Dùng script để lọc log, tổng hợp metric, kiểm tra schema và tạo bảng/hình xác định được; LLM xử lý diễn giải và phán đoán.

**Tái sử dụng có điều kiện**
- Dùng lại artifact còn hiệu lực khi inputs, code/data/protocol và phương pháp kiểm tra liên quan không đổi. Lưu dependency/version/hash để biết phần nào phải kiểm tra lại.
- Literature ghi thời điểm tìm và phạm vi nguồn; cập nhật khi câu hỏi hoặc yêu cầu về độ mới thay đổi. Không coi bản tóm tắt cũ là nguồn gốc đã được xác minh mãi mãi.
- Khi thay đổi, vô hiệu hóa các kết quả dẫn xuất bị ảnh hưởng; giữ nguyên bằng chứng gốc để truy vết. Compaction/handoff giữ quyết định, bất định, việc đang chạy và quyền đã cấp.
- Prompt caching là tối ưu theo backend/model và prefix tương thích. Không coi cache là bộ nhớ dùng chung giữa các hãng, không coi cached tokens là context được loại bỏ, không suy ra quota thuê bao giảm cùng tỷ lệ với giá API.

**Ngân sách và vòng lặp**
- Phân bổ budget theo project/task/work unit/attempt và quota pool; gồm thời gian, model usage/chi phí khi đo được và compute. Dành riêng phần điều phối, kiểm chứng, checkpoint và tiếp quản. Đặt giới hạn số vòng sửa/đánh giá, retry, fan-out và điều kiện dừng khi không có bằng chứng mới. Quy tắc thực hiện ở mục 8.4.
- Trước khi giao việc, kiểm tra phần ngân sách đã dùng và đã dành cho các job đồng thời. Chạm giới hạn thì chặn dispatch mới trong phạm vi; cách kết thúc job đang chạy phải được cấu hình và khai báo.
- Giới hạn do runner/tool hỗ trợ có thể được cưỡng chế. Với usage trễ hoặc backend không công bố số liệu, ghi mức bảo đảm và sai số; không hứa hard cap chính xác bằng prompt.
- Không spawn agent chỉ để tiết kiệm context điều phối nếu tổng chi phí đọc/viết/tích hợp tăng mà không cải thiện chất lượng. Model/effort mặc định ban đầu dựa trên capability, quyền và ngân sách hiện có, ghi rõ chưa tối ưu; hiệu chỉnh từ evidence sử dụng ở mục 12.
- Khi chờ người dùng, lưu trạng thái; không gọi LLM lặp lại để hỏi tiến độ hoặc hỏi lại cùng câu. Trạng thái job được lấy qua sự kiện hoặc polling xác định được có backoff.

**Đo lường**
- Ghi input/output tokens, cached tokens khi có, usage theo attempt và backend, chi phí thực tế/ước tính có nhãn, compute và thời gian chờ. Không cộng hai lần bộ đếm usage lũy kế; giữ số liệu thiếu là unknown, không thay bằng 0.
- Tách chi phí làm việc, điều phối/context, retry và tích hợp; tính cả lần thất bại. So sánh trong cùng backend/model khi dùng token thô vì tokenizer khác nhau.
- Chỉ kết luận tối ưu khi chất lượng, coverage bằng chứng, lỗi còn sót và khả năng tái lập đạt ngưỡng đã chốt. Không đặt tỷ lệ tiết kiệm làm điều kiện phát hành v1; khi có so sánh từ sử dụng, ghi rõ workload và giới hạn.

Cơ sở: [Agent Skills](https://agentskills.io/specification), [Claude Code cost management](https://code.claude.com/docs/en/costs), [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching). Các chính sách cụ thể ở trên là quyết định thiết kế của dự án.

**Ưu tiên kỹ thuật cập nhật 27/10/2026.** [Plan bản 4](runtime-integration-plan.md) giữ năng lực/tính đúng làm ràng buộc, đánh giá benefit trước khi tích hợp từng feature. Lát cắt tiếp theo là contract/accounting/context tối thiểu và workspace/publication, rồi recovery native và mở parallel writers/session reuse/native groups theo task. SDK/runtime ngoài có thể thay phần tự viết nếu giảm tổng chi phí mà giữ contract. Đánh giá time-to-accepted-result, rework, token, CPU/RAM/I/O và bảo trì qua sử dụng; không full rewrite trước khi có lợi ích rõ. Benchmark riêng luôn cần protocol và xác nhận.

### 8.2. Human-in-the-loop và quyền quyết định

Phân biệt hai việc: evaluator đánh giá bằng chứng khoa học; người dùng quyết định mục tiêu, phạm vi và nguồn lực. Người dùng chọn tiếp tục đầu tư không làm một claim thiếu bằng chứng trở thành supported.

| Tình huống | Hành vi mặc định |
|---|---|
| Đọc nguồn, sửa code có thể hoàn tác, kiểm tra và chạy protocol trong quyền/ngân sách đã cấp | Tự thực hiện và ghi kết quả |
| Chọn chi tiết triển khai không đổi câu hỏi, phép so sánh hay tiêu chuẩn thành công | Tự quyết, lưu giả định quan trọng |
| Thay đổi protocol trong phạm vi được ủy quyền | Tạo phiên bản, ghi lý do và đánh giá ảnh hưởng; không âm thầm đổi metric/split sau khi xem kết quả |
| Đổi câu hỏi chính, tiêu chuẩn thành công hoặc mở rộng tài nguyên ngoài quyền đã cấp | Chuẩn bị phương án cụ thể và hỏi quyết định |
| Bất đồng ảnh hưởng claim chính | Evaluator ghi supported/contradicted/inconclusive theo bằng chứng; hỏi người dùng nếu cần chọn hướng hoặc chi thêm nguồn lực |
| Chia sẻ báo cáo, nộp paper hoặc tác động ra ngoài dự án | Kiểm tra quyền cho hành động cụ thể; chỉ hỏi nếu chưa được ủy quyền |
| Thiếu thông tin bắt buộc hoặc gặp ràng buộc thực thi | Chặn nhánh phụ thuộc, giải thích chính xác điều gì thiếu; tiếp tục nhánh độc lập đã được phép |

Quy tắc tương tác:
- Không hỏi lại quyền còn hiệu lực; lưu scope, điều kiện và quyết định thu hồi/thay thế. Phê duyệt ngân sách cho một nhánh không tự mở quyền cho mọi nhánh.
- Một decision packet gồm: phát hiện/bằng chứng, quyết định cần có và vì sao, lựa chọn với tác động, khuyến nghị, việc bị chặn và việc có thể tiếp tục.
- Gom các quyết định liên quan khi có thể, không bắt người dùng đọc trace để tìm điều cần trả lời. Chỉ hỏi những điểm làm thay đổi hành động.
- Chờ câu trả lời cần thiết ở trạng thái waiting_for_user; không coi im lặng, hết timeout hoặc lời hỏi tiến độ là phê duyệt.
- Nếu câu trả lời đến sau khi protocol hoặc hoàn cảnh đã thay đổi, kiểm tra lại phạm vi hiệu lực trước khi dùng. Quyết định cũ không tự áp dụng cho phương án mới.
- Thông báo khi hoàn thành, cần quyết định, có lỗi quan trọng hoặc phạm vi thay đổi; tránh lặp thông báo trạng thái không đổi.
- Đo số can thiệp, câu hỏi lặp, thời gian xử lý của người dùng và thời gian hệ thống bị chặn. Giảm số câu hỏi chỉ có ý nghĩa khi không làm tăng lỗi hoặc hành động vượt quyền.

### 8.3. Người dùng tương tác khi hệ thống đang chạy

Chat là điểm vào chung. Harness chuẩn hóa yêu cầu thành control event có phạm vi; người dùng không cần học cú pháp kỹ thuật. Status/stop/pause rõ ràng có đường điều khiển không phụ thuộc việc LLM hoàn thành lượt hiện tại. Với prompt tự do, cần phân giải ý định; không hứa nhận diện tức thì khi parser/LLM chưa phản hồi. V1 cần lệnh hoặc nút điều khiển rõ để dừng được ngay cả lúc model đang bận.

| Ý định | Ví dụ | Hành vi |
|---|---|---|
| Status | “Tiến độ thế nào?” | Trả snapshot có thời điểm cập nhật; không hủy hay thay mục tiêu |
| Bổ sung/steer | “Ưu tiên kiểm tra leakage trước” | Giữ mục tiêu gốc, cập nhật ưu tiên/context theo capability; báo thời điểm có hiệu lực |
| Thay phạm vi | “Giữ baseline, chỉ đổi phương án B” | Xác định task/artifact phụ thuộc, tăng revision và chỉ sửa phần bị ảnh hưởng |
| Pause | “Xong bước hiện tại thì dừng để tôi xem” | Chặn dispatch tiếp theo trong scope; cho đơn vị công việc đã xác định tới checkpoint rồi xác nhận paused |
| Cancel | “Dừng B ngay” | Chặn dispatch B, gửi hủy tới worker/job thuộc B và xác minh trạng thái thực tế |
| Cancel toàn dự án | “Dừng toàn bộ dự án” | Áp dụng cho điều phối, worker và job thuộc dự án; không tác động dự án khác |
| Resume | “Tiếp tục theo quyết định vừa rồi” | Đối chiếu trạng thái, quyền, budget và revision; tiếp tục từ checkpoint/attempt phù hợp |

“Bước hiện tại” phải được báo rõ là tool call, task hay run nào. Pause có thể chờ lâu nếu backend chỉ có ranh giới cuối task; harness thông báo điều đó và khả năng cancel, không tự biến pause thành kill. “Dừng” không rõ phạm vi được đối chiếu ngữ cảnh; tạm chặn dispatch của phần có thể liên quan và hỏi ngắn nếu cần, không tự hủy job không xác định.

**Đường điều khiển và trạng thái**
- Control handler/event store và scheduler hoạt động độc lập với vòng suy luận điều phối. Bản đầu có thể là một runtime nhỏ có vòng nhận sự kiện riêng; chưa cần hệ thống dịch vụ phân tán.
- Thứ tự: lưu event và khóa dispatch trong scope khi cần; gửi tín hiệu; thu xác nhận; đối chiếu trạng thái thực tế; cập nhật handoff và báo kết quả. Khóa phải có hiệu lực ở bước dispatch cuối, kể cả job đang trong hàng đợi.
- Theo dõi ba tầng: orchestration task, agent attempt và external job như Python/GPU/scheduler. Job registry lưu quan hệ cha–con, owner, backend ID/process identity và cancellation handle. Job không quan sát/điều khiển được phải được khai báo trước.
- Phân biệt desired_state với observed_state. Task có thể queued/running/waiting_for_user/pause_requested/paused/cancel_requested/cancelled/completed/failed; timeout là lý do/sự kiện, không phải bằng chứng job đã dừng. Khi mất xác nhận, observed_state là unknown hoặc trạng thái cuối kèm dấu hiệu stale.
- Phản hồi hai mốc: “đã nhận yêu cầu” và “đã xác minh kết quả”. ACK từ API không tự chứng minh worker/job con đã kết thúc. Chỉ báo dừng toàn scope khi mọi thành phần thuộc scope đã được xác minh; báo rõ thành phần chưa xác minh.
- Kết quả completed và cancel có thể đến sát nhau: ghi đúng job đã hoàn thành trước khi hủy hay bị hủy, không đổi lịch sử thành cancelled cho thuận tiện. Artifact từng phần không tự trở thành kết quả đạt acceptance.
- Event có ID chống xử lý trùng, target và revision để tránh áp dụng vào attempt khác. Stop/pause chưa được giải quyết không bị một tin nhắn status/steer vô tình xóa; resume phải là ý định tiếp tục có phạm vi.
- Hủy không tự hoàn tác file, xóa evidence hoặc hoàn chi phí đã phát sinh. Dùng checkpoint/ghi artifact an toàn; phần ghi dở phải kiểm tra trước khi tái sử dụng.
- Nếu dừng mềm quá thời gian cấu hình, chỉ chấm dứt process/job thuộc quyền quản lý khi policy đã cho phép, xác minh đúng owner và phạm vi. Không kill theo tên process chung; job chia sẻ phải có cơ chế dừng riêng.
- Khi crash/reconnect/đổi điều phối, reconcile job và pending events trước dispatch. Không thấy phản hồi không đồng nghĩa được chạy lại. Retry side effect cần dispatch key/idempotency hoặc kiểm tra kết quả cũ; resume không tự tạo lần thí nghiệm thứ hai.

**Bảo toàn tính đúng khi đổi hướng**
- Gắn task_revision, protocol_version và attempt_id vào output; kiểm tra trước khi tích hợp. Kết quả cũ vẫn được lưu nhưng phải đánh giá lại độ phù hợp, không tự nhập vào claim của protocol mới.
- Ví dụ: người dùng yêu cầu dừng B vì sai split, giữ baseline. Harness dừng B; kiểm tra baseline có dùng cùng split sai không. Baseline có thể giữ để tham khảo nhưng chưa đủ để xác nhận phép so sánh mới nếu chịu cùng lỗi. Cập nhật protocol và chỉ chạy lại phần phụ thuộc bị ảnh hưởng.
- Evaluator và người dùng thấy rõ kết quả nào còn hợp lệ, cần kiểm tra lại hoặc đã bị vô hiệu hóa. Nhánh độc lập tiếp tục khi không mâu thuẫn phạm vi dừng và quyền đã cấp.

**Capability theo backend — kiểm tra tài liệu ngày 25/10/2026**

| Backend/interface | Điều tài liệu hỗ trợ | Áp dụng vào plan |
|---|---|---|
| Codex App Server | turn/steer thêm input cho lượt đang chạy với expectedTurnId; turn/interrupt yêu cầu hủy và có trạng thái kết thúc interrupted | Dùng ID lượt để định tuyến; đổi model/cwd/sandbox không đi qua steer; đối chiếu external job riêng |
| Claude Agent SDK Python | ClaudeSDKClient interrupt trong streaming; stop_task cho background task; buffer cũ còn sau interrupt | Tách hủy lượt với hủy task nền; drain/định tuyến output cũ trước khi nhận kết quả yêu cầu mới |
| Antigravity CLI headless trong tài liệu hiện hành | Stream nhiều lượt; hướng dẫn chờ result trước prompt tiếp; control_request/control_response không được hỗ trợ trong stream này | Không coi streaming là mid-turn steer/cancel tương đương Codex; chọn cơ chế dừng tiến trình hoặc checkpoint đã kiểm chứng |
| Backend chỉ hỗ trợ one-shot | Không có tương tác giữa lượt qua interface đã chọn | Hoãn thay đổi tới ranh giới task hoặc cancel có kiểm soát rồi mở phiên từ handoff; công bố giới hạn |

Nguồn trực tiếp: [Codex App Server](https://learn.chatgpt.com/docs/app-server), [Claude SDK Python](https://code.claude.com/docs/en/agent-sdk/python), [Antigravity headless](https://antigravity.google/docs/cli/headless/). Đây là khả năng được mô tả trong tài liệu, chưa phải kết quả kiểm thử tích hợp trên máy. agy 1.0.14 đã kiểm tra trước đó chưa liệt kê các cờ streaming trong help; phải probe lại bản cài trước khi dùng. Không mặc định nâng cấp/cài thêm backend để đáp ứng bảng này.

Checkpoint và chờ quyết định có thể tham khảo [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts), gồm lưu state và tránh lặp side effect khi resume. Plan chưa chọn LangGraph làm framework bắt buộc.


### 8.4. Phân bổ công việc, dự phòng token và fallback sub-agent

Phần này là thiết kế bổ sung sau khi phiên làm việc bị gián đoạn. Cơ chế phục hồi áp dụng cả cho cạn ngân sách/quota và mất điện/crash, nhưng phải phân loại nguyên nhân trước khi chọn hành động. Việc mất pin không tự chứng minh đã xảy ra lỗi token.

**a. Phân biệt các giới hạn**

| Giới hạn/sự cố | Phạm vi thực sự | Hướng xử lý |
|---|---|---|
| Context gần đầy/ContextWindowExceeded | Cửa sổ context của một request/session; gồm instructions, tools, history và chỗ cho output theo model | Thu hẹp context, compact khi còn khả dụng hoặc mở worker mới từ checkpoint |
| Output/reasoning token cap hoặc max-turns | Một lần sinh hoặc vòng agent theo API cụ thể | Lưu phần hợp lệ, kết thúc attempt với lý do rõ; tiếp tục phần còn lại trong giới hạn đã cấp |
| Budget của task/attempt/project | Ngân sách do harness hoặc backend đặt | Chỉ cấp thêm từ phần đã được cho phép; không tạo worker mới để vượt trần tổng |
| Rate limit ngắn hạn | Nhóm request/model/account/API project, như RPM/TPM | Tôn trọng retry-after/reset, giảm concurrency, backoff có giới hạn |
| Quota thuê bao/credits/spend limit cạn | Pool tài nguyên có thể dùng chung giữa điều phối và nhiều worker | Chờ phục hồi hoặc chuyển sang pool còn khả dụng đã được phép |
| Process/session mất kết nối, host mất điện | Trạng thái thực thi có thể chưa rõ; job từ xa có thể vẫn chạy | Reconcile trước, phục hồi từ checkpoint bền vững, tránh phát lại side effect |

Tổng input/output tokens qua nhiều lượt không phải dung lượng context hiện tại. Một phiên mới có thể giải phóng context nhưng không khôi phục quota tài khoản. Phần trăm quota thuê bao không được đổi tùy ý thành số token chính xác. Budget/limit của provider và budget nội bộ phải được theo dõi riêng.

Cơ sở: [Claude context windows](https://platform.claude.com/docs/en/build-with-claude/context-windows), [Codex App Server](https://learn.chatgpt.com/docs/app-server), [Claude agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop). Các nguồn mô tả giới hạn khác nhau; harness cần adapter phân loại theo interface và phiên bản.

**b. Giao việc theo phần có thể bàn giao**

- Cấu trúc logic: project → task → work unit → assignment → attempt. Đây không phải yêu cầu tạo năm file hoặc năm agent; task nhỏ gộp record, chỉ có một unit khi phù hợp.
- Mỗi unit có đầu ra quan sát được và checkpoint hữu ích: một nhóm tài liệu cho một câu hỏi, một module cùng kiểm tra nhỏ, một baseline sanity check, một lemma có assumptions/obligations rõ hoặc một mục paper/report gắn claim–evidence. Tránh giao trọn “đọc hết literature, implement và viết paper” cho một worker.
- Chỉ tách ở ranh giới giữ được ý nghĩa/acceptance. Proof, phân tích liên kết chặt hoặc refactor dùng chung nhiều file có thể cần unit lớn hơn; chi phí đọc lại, tích hợp và mất ngữ cảnh phải được tính.
- Lập dependency graph và phạm vi ghi trước khi chia song song. Độ rộng song song phụ thuộc cả quota còn lại, khả năng checkpoint, workspace và compute; không chỉ phụ thuộc số slot agent.
- Thu bằng chứng lâu như training/GPU job được giao cho job runner có ID riêng; agent chỉ thiết lập, giám sát và phân tích. Đổi agent không tự khởi động lại job đang chạy.
- Nếu worker được phép tạo sub-agent con, mọi descendant phải đăng ký vào cùng cây task/budget/pool. Ngân sách con được chia từ phần đã cấp cho cha; không có nhánh tự tạo budget hoặc recovery vô hạn.
- Chọn số lượng/độ dài unit để giới hạn lượng công việc mất giữa hai checkpoint. Backend one-shot không có checkpoint giữa lượt cần unit nhỏ hơn và giới hạn thời gian/output tương ứng.

**c. Phân bổ ngân sách trước khi chạy**

Giữ các đại lượng độc lập: dung lượng context, token tích lũy, chi phí, số lượt, thời gian, quota theo pool và compute. Không gộp mọi giới hạn thành một biến “tokens remaining”.

1. Ước tính cho unit tiếp theo: context khởi động, input lặp/tool output, output/reasoning khi được báo, phần thực hiện, kiểm tra, checkpoint và sai số. Lưu nguồn ước tính, backend/model, loại task và độ tin cậy.
2. Khi chưa có lịch sử, dùng ước tính bảo thủ và unit nhỏ; không bịa phân vị. Khi có đủ dữ liệu tương đồng, dùng phân vị cao (ví dụ P90) cho chi phí và độ tăng context; định kỳ hiệu chỉnh từ số đo.
3. Chỉ nhận unit mới khi ngân sách còn lại đủ chi phí dự kiến của unit cộng checkpoint và biên dự phòng. Kiểm tra riêng: context headroom phải đủ mức tăng dự kiến đến checkpoint cộng không gian kết thúc; quota/time/compute cũng phải đạt yêu cầu.
4. Reservation được cập nhật nguyên tử ở project/task và pool trước dispatch. Cùng lúc phải giữ phần điều phối, kiểm chứng và recovery đã cấu hình. Phần dự phòng recovery dành cho đọc checkpoint, kiểm tra hiện trạng và hoàn thành ít nhất unit kế tiếp theo estimate; không nhất thiết đủ làm lại toàn task.
5. Trong khi chạy, cập nhật usage từ telemetry; cập nhật reservation theo phần việc còn lại, quyết toán một lần khi có số liệu đáng tin. Ghi rõ counter theo lượt/lũy kế, child usage đã nằm trong parent total hay chưa để tránh đếm hai lần.
6. Dùng token thô để điều khiển trong pool/model có đơn vị tương thích; chi phí và các thước đo chất lượng để so sánh xuyên backend. Model reasoning/context overhead không quan sát được phải ghi unknown hoặc estimate, không ghi 0.

Ví dụ minh họa, không phải mặc định đo được: attempt còn 12.000 token ngân sách; unit kế tiếp dự kiến tốn 9.000, checkpoint 2.000 và biên dự phòng 2.000. Vì cần 13.000, worker nên checkpoint/chia nhỏ trước khi bắt đầu unit đó. Context headroom và quota vẫn phải kiểm tra riêng.

quota_pool_id biểu diễn pool thực sự chia sẻ hạn mức (ví dụ account + model group + cửa sổ), không đơn thuần là tên agent. Một backend có thể chịu nhiều cửa sổ đồng thời. Nếu điều phối và worker cùng pool, harness ưu tiên giữ khả năng điều phối/recovery; việc dùng ngoài harness vẫn có thể tiêu hao phần dự tính, nên local reservation không bảo đảm quota phía provider.

Telemetry gồm observed_at và độ tin cậy. Khi provider không cho phép đọc quota qua API phù hợp, dùng unknown, giới hạn đơn vị công việc và concurrency bảo thủ; không hứa phát hiện cạn quota trước mọi lần gọi. Không lấy lời agent tự đoán usage làm số liệu backend.

**d. Checkpoint chủ động trước ngưỡng cạn**

- Trước mỗi unit và sau các bước có chi phí lớn, tính lại khả năng đi tới checkpoint kế tiếp. Nếu không đủ, chuyển attempt sang yielding, dừng nhận việc mới và ghi checkpoint khi còn đủ tài nguyên.
- Checkpoint khi hoàn thành unit, có quyết định quan trọng, thay artifact hoặc trước side effect dài. Với API/hook hỗ trợ, ghi delta sau tool completion; với CLI one-shot, checkpoint ở ranh giới unit và giữ raw log/file artifacts bên ngoài session.
- Không chỉ dựa vào cảnh báo “đã dùng 80%/90%”: chi phí bước kế tiếp có thể lớn hơn phần còn lại. Soft threshold theo dự báo; hard limit theo backend/runner khi thực thi được.
- Harness lưu task state, tool/job events và artifact metadata không cần thêm lời gọi LLM. Bản tóm tắt của worker là bổ sung hữu ích khi còn ngân sách, không phải điều kiện bắt buộc duy nhất để cứu tiến độ.
- Checkpoint manifest có sequence/hash và chỉ được đánh dấu durable sau khi artifact tương ứng được lưu nhất quán. Nếu crash giữa ghi file và manifest, dùng checkpoint hợp lệ trước đó và đánh dấu file dở cần kiểm tra; không coi một file tồn tại là unit đã hoàn thành.
- Gói bàn giao trung lập gồm mục tiêu/acceptance, role/skill versions, protocol/input/code versions, completed/remaining units, artifact paths/hashes/diff, checks và kết quả, quyết định/quyền, bất định, pending job/side effects, budget/quota snapshot và next action.
- Phân biệt tiến độ do worker báo, artifact đã kiểm tra cấu trúc và kết quả đã được evaluator xác nhận. Không yêu cầu sao chép suy luận nội bộ; lưu kết luận, lý do quyết định cần thiết và bằng chứng có thể kiểm chứng.
- Native session/compaction có thể hỗ trợ tiếp tục cùng backend; bản ghi opaque hoặc session ID của hãng không phải hợp đồng bàn giao xuyên nền tảng. Checkpoint phải dùng được khi phiên gốc không còn truy cập.
- Compaction giảm context nhưng có chi phí và có thể bỏ mất chi tiết. Giữ các constraints, quyền đã cấp, phản chứng và artifact gốc ngoài bản tóm tắt.

Nguồn hỗ trợ: [OpenAI compaction](https://developers.openai.com/api/docs/guides/compaction), [Agents SDK results/state](https://developers.openai.com/api/docs/guides/agents/results), [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence). Chính sách checkpoint trung lập và dự phòng của dự án là thiết kế bổ sung, không phải bảo đảm tự có của các SDK này.

**e. Fallback khi worker đã bị cắt**

| Nguyên nhân đã xác minh | Thứ tự hành động đề xuất |
|---|---|
| Context cạn, quota còn | Chọn checkpoint → compact/native continuation nếu phù hợp → hoặc worker mới cùng backend với context tối thiểu |
| Max-turns/output cap | Kiểm tra phần đã lưu → chia phần còn lại → tiếp tục bằng attempt mới trong trần tổng; không tự tăng trần tổng |
| Rate limit tạm thời | Chờ retry-after với backoff/jitter có giới hạn, giảm fan-out; chuyển pool nếu policy cho phép và có lợi |
| Quota/spend limit cạn | Đóng nhận việc mới vào pool đó → chọn pool khác đã được phép/còn tài nguyên; nếu không có thì waiting_for_capacity |
| Attempt budget hết, project còn phần được phép cấp | Cấp lại từ phần dự phòng cho unit còn lại; ghi quyết định phân bổ, không reset bộ đếm task/project |
| Project budget hết | Dừng dispatch; chờ quyết định nếu cần tăng ngân sách, hoặc kết thúc với phần hoàn thành và giới hạn |
| Crash/mất điện/timeout chưa rõ side effect | Reconcile; khi chưa rõ thì chỉ cho worker phục hồi đọc/kiểm tra, chưa cho tái thực hiện cùng side effect |
| Lỗi quyền, auth hoặc thiếu capability | Báo nguyên nhân và chọn ứng viên tương thích đã được cấp quyền; nếu không có thì chờ xử lý |

Quy trình chuyển A → B:

1. Lưu failure/recovery event với evidence từ backend, exit/stop reason, thời gian và retry_after/reset nếu có; phân biệt lỗi xác minh được với suy đoán.
2. Chặn dispatch mới của assignment A. Reconcile các job/tool call đã phát ra, kiểm tra checkpoint và file dở. Nếu GPU/job từ xa còn chạy thì giữ job đó và chuyển quyền giám sát; không chạy lại.
3. Chọn các unit còn thiếu; giữ completed units còn hiệu lực. Phần chưa có checkpoint có thể phải làm lại, sau khi kiểm tra side effect; công khai lượng tiến độ có thể mất.
4. Chọn B từ fallback chain đã cấu hình, thỏa role/skill/tool/data-access/workspace, context và resource pool. Ước tính cả chi phí B đọc lại/kiểm tra/integrate; có thể chờ A phục hồi nếu chuyển đắt hơn và deadline cho phép.
5. Chuyển assignment bằng thao tác nguyên tử, tăng generation/fencing token và reserve ngân sách B. Tách worker generation khỏi owner_epoch của điều phối. Backend thay đổi không tự đổi task revision; đổi mục tiêu/input/protocol mới cần revision.
6. B nhận checkpoint cùng phần việc còn lại, xác nhận phiên bản/artifact và liệt kê việc sẽ tiếp tục. Khi chỉ cần tiếp tục từ artifact, báo rõ điều đó; không gọi là khôi phục nguyên phiên.
7. B ghi progress/checkpoint/result với attempt_id và generation mới. Output A đến muộn vẫn được lưu với nguồn gốc nhưng không tự tích hợp vào kết quả hiện hành; tiếp nhận lại cần kiểm tra.
8. Hạch toán chi phí A và B, quyết toán reservation theo bằng chứng và chạy acceptance/evaluator ở mức phù hợp trước khi đóng task.

Fencing phải được kiểm tra ở nơi dispatch/tích hợp và nơi ghi có thể kiểm soát. Một lease hết hạn hoặc heartbeat mất không chứng minh process A đã chết. Nếu tool ghi trực tiếp không hỗ trợ fencing, phải xác minh A đã dừng hoặc dùng workspace riêng và chỉ tích hợp output sau kiểm tra; không cho hai writer ghi cùng workspace. Không hứa exactly-once cho side effect bên ngoài không có idempotency/reconciliation API.

Fallback không phụ thuộc A còn đủ token để “nhờ” B. Runtime/điều phối đọc trạng thái bền vững và tạo gói phục hồi từ checkpoint/artifact đã lưu. Nếu cả điều phối bị cắt, chủ sở hữu mới chạy recovery sweep trước khi dispatch.

**f. Chính sách chọn worker và giới hạn vòng phục hồi**

- Mặc định ưu tiên worker tương thích cùng backend cho lỗi context/session; ưu tiên pool độc lập còn khả dụng cho lỗi quota. “Khác model/agent” không mặc nhiên là “khác pool”.
- Giữ nguyên role, acceptance và nghĩa vụ evidence. Không giảm tiêu chuẩn evaluator/novelty/reproducibility để làm fallback được xem là thành công.
- Không cấp toàn bộ ngân sách còn lại cho B. Cấp cho unit kế tiếp cùng checkpoint/dự phòng, sau đó cập nhật theo tiến độ.
- Khởi điểm để review: tối đa 1 retry cùng backend cho lỗi tạm thời và 2 lần đổi worker tự động trên một work unit; các ngưỡng phải cấu hình được. Planned yield có bộ đếm riêng nhưng vẫn chịu trần tổng segments/handoffs, thời gian và chi phí của task.
- Đếm cả retry ngầm của SDK nếu quan sát được; khi không quan sát được, công bố giới hạn và phối hợp timeout/cap của adapter. Không nhân một retry loop ở mọi tầng.
- Pool lặp lỗi quota có circuit breaker/cooldown; các worker cùng pool không cùng retry tức thì. Hết giới hạn hoặc không có tiến độ mới thì chờ điều phối/người dùng theo quyền đã cấp, không chuyển vòng A → B → A vô hạn.
- Cho phép chuyển tự động trong danh sách backend/model và ngân sách đã được ủy quyền. Cần quyết định nếu phải tăng tổng budget, mở quyền dữ liệu, dùng dịch vụ chưa cho phép hoặc giảm yêu cầu chất lượng.
- Fallback không tự mua credits, dùng reset, đổi tài khoản, bật tính phí vượt hạn mức hoặc khởi động thực nghiệm chưa được cho phép.
- Pause/cancel của người dùng ưu tiên hơn mọi policy tự phục hồi. Chỉ lệnh tiếp tục có phạm vi mới cho phép dispatch lại nhánh đã pause; cancel không bị diễn giải thành cần retry.

Config đã có work_allocation, quota_pools, budget_reserves, checkpoint_policy và recovery_policy. Mỗi nguồn fallback khai báo capabilities, pool mapping, quyền và tình trạng đã kiểm chứng. Phần này đã có implementation/fixture; khả năng quota/native streaming của các backend thật và chất lượng sau chuyển vẫn cần kiểm chứng ở bước được cho phép.

**g. Mức hỗ trợ thực tế của adapter**

- Codex App Server có sự kiện usage, API rate-limit và loại lỗi context/usage riêng. CLI adapter hiện có trong workspace chưa khai thác đầy đủ các tín hiệu đó; cần adapter mapping và kiểm thử sau khi tiếp tục implementation.
- Claude Agent SDK có max-turns/budget và subtype khi chạm giới hạn; tài liệu nêu budget bao gồm sub-agent con và có yêu cầu phiên bản. Phải kiểm tra phiên bản thực tế, input mode và accounting trước khi ánh xạ vào ledger chung.
- Antigravity có tài liệu /usage dạng TUI. Điều này không chứng minh agy 1.0.14 có API quota/streaming tương ứng; khả năng đọc quota tự động của bản cài vẫn là unknown.
- Khi không có usage giữa lượt, harness chỉ có thể dùng unit ngắn, timeout/cap được hỗ trợ và checkpoint giữa units. Không cam kết gửi cảnh báo cuối cùng trước hard cutoff.

Tham chiếu: [Codex App Server](https://learn.chatgpt.com/docs/app-server), [Claude agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop), [Claude rate limits](https://platform.claude.com/docs/en/api/rate-limits), [Antigravity model quotas](https://www.antigravity.google/docs/cli/commands/usage). Không suy diễn mọi 429 là lỗi tạm thời hoặc mọi budget failure đều có final answer để lấy.

**h. Ví dụ bàn giao trong domain research**

Implementer A đang làm unit U2 “parser kết quả”, đã lưu schema U1 và checkpoint C7; còn sửa parser và kiểm tra case thiếu output. A chạm quota, không trả lời cuối:

- Runtime giữ U1 và C7, lưu partial diff của U2 nhưng chưa coi U2 hoàn thành; xác minh A/job con đã dừng hoặc cách ly phạm vi ghi.
- B nhận role implementer, đúng protocol và checkpoint, được giao phần parser/checks còn thiếu với budget riêng. Nếu B dùng cùng quota đang cạn thì chưa được dispatch.
- B kiểm tra diff và test evidence, hoàn thiện U2, ghi checkpoint C8. Evaluator nhận artifact C8 và acceptance bằng context độc lập khi cần.
- Nếu A có kết quả gửi muộn, kết quả đó gắn generation cũ và không đè lên C8. Nếu không có B đủ điều kiện, task giữ waiting_for_capacity cùng gói bàn giao đã lưu.

## 9. Lộ trình xây hệ thống

### Hiện trạng và phạm vi cập nhật

I1–I4 cùng lớp hỗ trợ research đã có source và software checks trong v0.3. [Trạng thái implementation](implementation-status.md), [workflow](research-workflow.md) và [evidence](verification/v1-evidence.json) ghi phạm vi hiện có. M1–M6 bên dưới giữ các yêu cầu; implementation/report sẵn để người dùng review.

Kế hoạch lần này sửa hai điểm: báo cáo là đầu ra của việc xây harness, không loại bỏ paper khỏi domain; nghiệm thu v1 tập trung vào cơ chế hỗ trợ và chất lượng vận hành, không chờ một benchmark chứng minh khả năng tạo kiến thức mới.

Giữ I1–I4 làm nền, không làm lại chỉ để đổi số milestone. M1–M6 dưới đây thay thế phạm vi milestone cũ. Các gate chi tiết ở [nghiệm thu v1](v1-acceptance-plan.md). Việc cập nhật plan không tự mở quyền chạy model/backend hoặc thí nghiệm.

### M1. Đặc tả domain và hợp đồng năng lực research

- Giữ role/skill/backend/model/permissions/pools độc lập; tách mục tiêu tri thức và output profile.
- Đặc tả hypothesis, derivation/proof, experiment plan, evidence update, review và feedback; quy tắc reference/version, trạng thái thiếu bằng chứng, invalidation.
- Tách scientific support, proof verification, novelty assessment và trạng thái thực thi.
- Chốt phần nào là kiểm tra schema/runtime, phần nào cần reviewer/verifier/chuyên môn; xác định tương thích/migration trước khi sửa record đang lưu.

Đầu ra: schema/artifact conventions và ví dụ hợp lệ/không hợp lệ. Hoàn thành khi hợp đồng biểu diễn đủ bốn năng lực và case nhỏ, không phụ thuộc hãng. Source ở schemas/research-*.schema.json và src/research.mjs, có fixtures để review.

### M2. Hoàn thiện role, skill và reference nghiên cứu

Phụ thuộc: M1.

- Mở rộng sáu skill theo [kế hoạch năng lực](research-capability-plan.md): phát triển hypothesis, toán học, thiết kế phép thử phân biệt và cập nhật theo evidence.
- Cho phép nạp đồng thời hướng dẫn toán/thực nghiệm khi dự án cần; không áp toàn bộ workflow cho task nhỏ.
- Giữ paper/proof/report theo đầu ra dự án. Venue và công cụ trình bày là lựa chọn theo nhu cầu.
- Chuẩn hóa context cho evaluator, bàn giao assumptions/obligations/phản chứng; walkthrough các case C1–C4 và task nhỏ.

Đầu ra: bundle portable và references. Hoàn thành khi nội dung/hướng dẫn và nạp context được kiểm tra, người dùng review được ranh giới trách nhiệm. Không dùng metadata pass để khẳng định model đã có năng lực khoa học.

### M3. Tích hợp record và vòng nghiên cứu vào harness

Phụ thuộc: M1–M2, tái sử dụng I1–I4.

- Lưu/validate/reference các record research; ghép vào task/result/checkpoint theo nhu cầu.
- Tiếp tục được nhánh hypothesis, nghĩa vụ proof và experiment còn mở qua worker mới.
- Giữ dependency/revision, raw evidence và control barriers; artifact completion không tự nâng scientific verdict.
- Thử bằng fixtures/manual: thêm phản chứng, sửa giả định, stale dependencies, ngắt không final answer và takeover.

Đầu ra: luồng lưu → context → evidence update → review → handoff có thể kiểm tra cục bộ. Hoàn thành khi các gate về record, provenance, tài nguyên, recovery và HITL pass trong scope v1. Không cần pilot nghiên cứu mới.

### M4. Gói kiểm chứng, đầu ra dự án và feedback

Phụ thuộc: M3.

- Hoàn thiện trace claim–derivation–code–run/source–hình/bảng và kiểm tra reference bị thiếu/stale.
- Xuất gói evaluator với scope, levels of evidence và unresolved obligations.
- Đường viết paper/proof/report giữ citation và limitations; chỉ build định dạng khi có công cụ được chọn, khai báo rõ chưa hỗ trợ.
- Ghi feedback gắn artifact/config/skill version; lưu thay đổi, regression evidence và cách rollback.

Đầu ra: công cụ/record kiểm tra, mẫu đầu ra và bộ case walkthrough. Hoàn thành khi người dùng truy được evidence, thấy phần chưa kiểm chứng và ghi được vấn đề để cải tiến. Không đòi phát hiện mới hoặc một paper hoàn chỉnh để pass.

### M5. Khả năng thay backend và điều phối có phạm vi rõ

Phụ thuộc: M3; dùng artifact M4 cho handoff.

- Kiểm tra command/parse/capability contracts offline cho ít nhất hai adapter ngoài; mock/manual E2E cho dispatch, kết quả và chuyển quyền.
- Config/prompt override tạo snapshot; đổi điều phối giữ owner/epoch, decisions, quyền và scientific state.
- Capability matrix tách offline-checked, live-verified, unsupported và unknown; chỉ công bố tính năng có evidence đúng mức.
- Preflight/smoke check backend thật khi được phép dùng hoặc ở lần sử dụng đầu tiên; ghi limitations và cập nhật matrix.

Đầu ra: adapters, handoff và compatibility evidence. Core v1 không phụ thuộc hai hãng chạy thật hoặc native API tương đương. Nếu chưa live-verified, bàn giao ghi rõ giới hạn và không claim tương thích thực tế đã được chứng minh.

Mở rộng M5 theo [RT0–RT8 bản 4](runtime-integration-plan.md): core/provider contracts, workspace/publication và recovery/accounting trước khi mở các capabilities phụ thuộc; Claude/Antigravity theo nhu cầu và model/auth mapping. Ma trận C01–C18 nêu lợi ích, chi phí, route native/custom và gate. Giữ cross-backend delegation, thêm native groups khi quan sát/kiểm soát đủ. Bàn giao theo slice và retire code trùng khi đủ evidence. [Protocol nghiệm thu](acceptance-minimal-protocol.md) quy định S0/P0/L1, L2 có điều kiện và user walkthrough; trace thật hợp lệ có thể thay run riêng, không bắt ma trận mọi hãng/model.

### M6. Nghiệm thu và bàn giao research harness v1

Phụ thuộc: các phần bắt buộc của M1–M5.

- Chạy kiểm tra phần mềm tương ứng implementation cuối; tập hợp gate V1-01–V1-11, walkthrough và unresolved list.
- Sửa lỗi bắt buộc; deferred/unsupported chỉ dành cho phần tùy chọn, không che lỗi core.
- Người dùng review phạm vi, cách vận hành và evidence; viết báo cáo xây hệ thống sau khi hoàn thiện scope bàn giao.
- Chốt quy trình bắt đầu sử dụng, thu feedback và cải tiến có phiên bản.

Đầu ra: source/bundle/config mẫu/hướng dẫn, báo cáo hệ thống, capability matrix và evidence nghiệm thu. Hoàn thành khi gate bắt buộc pass và người dùng nghiệm thu; không yêu cầu benchmark nghiên cứu, novelty score, phát hiện mới hay số đo tiết kiệm token.

### 9.1. Báo cáo xây hệ thống

Dự kiến docs/system-report.md, tạo khi hoàn thiện scope v1. Mô tả mục tiêu/kiến trúc, bốn năng lực được hỗ trợ bằng cơ chế nào, cách sử dụng, quyền/HITL, budget/recovery, phiên bản và kết quả kiểm tra, capability matrix, giới hạn và quy trình cải tiến.

Báo cáo phân biệt rõ tính năng đã implement, cơ chế đã test, tích hợp chưa live-verified và chất lượng nghiên cứu chưa đo. Chưa có thực nghiệm khoa học không chặn báo cáo bàn giao. Đây không phải output template bắt buộc cho các dự án research; chúng vẫn có thể viết paper hoặc đầu ra khác theo yêu cầu.

## 10. Nghiệm thu

Các gate bắt buộc, cách kiểm tra, trạng thái và quy tắc bàn giao được quy định tại [nghiệm thu v1](v1-acceptance-plan.md). Các checklist kỹ thuật bên dưới là ca tham chiếu cho những gate đó, áp dụng theo capability/scope; không phải yêu cầu chạy một chương trình đánh giá khám phá trước phát hành.

### Cơ chế hỗ trợ nghiên cứu

- Lưu và bàn giao được hypotheses/assumptions/prior work, derivation/proof obligations, experiment design/predictions và evidence updates.
- Walkthrough các case có đáp án cho cơ chế: phản chứng, proof chưa hoàn tất, failed run/kết quả âm, đổi giả định và takeover.
- Giữ mức bằng chứng và findings còn mở; không tự biến chưa kiểm tra thành supported hoặc novelty đã xác nhận.
- Reference/version/hash sai được phát hiện; kiểm tra tính đúng khoa học của nội dung được ghi riêng theo reviewer/tool và scope.
- Task nhỏ không bị ép thành dự án discovery; paper/proof/report đều có đường sử dụng theo mục tiêu.
- Các case này kiểm tra cơ chế lưu/truyền/kiểm tra trạng thái, không chứng minh model tự khám phá hoặc tự tìm mọi lỗi.
- Trong dự án sử dụng thật, citation, logic toán, metric/split, bằng chứng âm và khả năng tái lập vẫn phải được kiểm chứng theo claim; chưa kiểm tra thì giữ nhãn tương ứng.

### Tính đúng của harness

- Task nhỏ không tạo worker hoặc bộ artifact dư thừa.
- Config và prompt override tạo ra snapshot có thể kiểm tra.
- Backend không đáp ứng capability bị báo rõ, không âm thầm giả lập thành công.
- Job thất bại, output thiếu, timeout và cancel có trạng thái phân biệt.
- Đổi điều phối tại checkpoint giữ nguyên việc đang chạy và quyết định.
- Ghi song song không đè lên workspace của worker khác.
- Tiếp tục job không gây khởi chạy trùng thí nghiệm có tác dụng phụ.

### Human-in-the-loop và điều khiển giữa tác vụ

- Hỏi tiến độ/bổ sung context không hủy mục tiêu gốc; override có scope/revision được lưu và báo thời điểm có hiệu lực.
- Quyền đã cấp không bị hỏi lại vô cớ; thiếu câu trả lời không cho phép hành động phụ thuộc. Nhánh độc lập được tiếp tục đúng phạm vi.
- Quyết định đến muộn được kiểm tra theo phương án/protocol hiện tại; quyền cho phương án cũ không bị áp sai.
- Pause chặn dispatch tiếp theo, chỉ xác nhận paused sau checkpoint phù hợp; giới hạn backend được báo đúng.
- Cancel B dừng đúng worker/job con thuộc B, chặn cả job đang xếp hàng; baseline và dự án khác không bị dừng nhầm.
- Cancel toàn dự án kiểm tra đủ ba tầng; mất phản hồi hoặc timeout không bị báo thành đã dừng.
- ACK và terminal state tách biệt; job completed đồng thời cancel, output đến muộn và event lặp được xử lý nhất quán.
- Đổi protocol không đưa kết quả phiên bản cũ vào claim mới mà chưa kiểm tra ảnh hưởng.
- Crash/reconnect/đổi điều phối giữ pending events và quyền đã cấp, kiểm tra job thật trước retry; owner cũ không dispatch thêm.
- Khi chờ người dùng không phát sinh vòng gọi LLM để tự hỏi lại. Reviewer đo thời gian nhận lệnh và thời gian xác minh riêng.
- Backend không có mid-turn control/resume được báo giới hạn; thử tiếp tục từ handoff và kiểm tra artifact dở dang.

### Token, context và budget

- Task nhỏ chỉ nạp thông tin cần thiết; context packet của evaluator vẫn đủ truy vết nguồn và phản chứng.
- Artifact còn hiệu lực được tái sử dụng; đổi input/code/data/protocol làm các kết quả phụ thuộc cần kiểm tra lại.
- Vòng sửa không tiến bộ hoặc vượt budget dừng theo policy; không tự tăng retry/fan-out.
- Hai job đồng thời không cùng dùng phần budget còn lại mà không tính reservation; số liệu trễ và giới hạn bảo đảm được công bố.
- Bộ đếm lũy kế không bị cộng trùng; usage thiếu giữ unknown; cached tokens/giá API/quota thuê bao không bị đánh đồng.
- Tối ưu không làm giảm coverage bằng chứng hoặc che kết quả âm; chất lượng được kiểm tra bằng nguồn/ground truth độc lập phù hợp.


### Phân bổ tài nguyên và phục hồi worker

Các ca dưới đây là checklist fixture/fault injection cho nghiệm thu cơ chế. I1–I4 đã kiểm tra một phần; record khoa học mới cần bổ sung test tương ứng. Không dùng các ca này làm số đo chất lượng khám phá.

| Ca kiểm tra | Kết quả cần quan sát |
|---|---|
| Unit kế tiếp không vừa budget/context còn lại dù chưa chạm hard cap | Không dispatch unit; lưu checkpoint/chia nhỏ hoặc waiting_for_capacity theo policy |
| Hai worker và điều phối cùng quota pool | Tổng reservation giữ phần dự phòng, giảm fan-out khi pool gần cạn; worker mới không được coi là có quota riêng |
| Telemetry thiếu hoặc đã cũ | Hiện unknown/estimate có timestamp, không báo chính xác token còn lại; dùng policy bảo thủ |
| A chạm budget/context cap không có final answer | Giữ partial evidence, không báo task completed; phục hồi từ checkpoint đã durable |
| A cạn quota, B cùng pool cũng cạn | Không chuyển rồi retry mù; chờ reset hoặc chọn pool độc lập đã được phép |
| B tiếp quản từ C7 | Kiểm tra hash/revision/permissions; chỉ nhận remaining units; không làm lại completed units còn hiệu lực |
| Crash giữa ghi artifact và checkpoint manifest | Không nhận checkpoint dở; dùng bản hợp lệ trước đó và đánh dấu phần cần kiểm tra |
| GPU/job từ xa còn chạy sau khi A mất kết nối | B nhận job handle để theo dõi; không launch bản sao |
| A còn sống/heartbeat trễ và gửi output sau takeover | Fencing hoặc cách ly workspace ngăn ghi/tích hợp đè; output cũ được lưu với generation cũ |
| Crash trong khoảng dispatch chưa nhận backend ID | Reconcile intent/idempotency key; không suy đoán chưa chạy để phát lại side effect |
| Retry/SDK retry/fallback nhiều tầng | Có giới hạn toàn task/pool; không reset budget hoặc nhân số lần thử ngoài policy |
| Pause/cancel trong lúc transfer_pending | B không được dispatch; quyền điều khiển người dùng được giữ qua recovery |
| Project budget hết hoặc B cần quyền/model chưa được cho phép | Giữ checkpoint và decision packet; không tự tăng ngân sách hay đổi dịch vụ |
| Resume làm provider trả counter lũy kế/đã gồm child usage | Không cộng trùng; giữ usage thiếu là unknown và reservation chưa quyết toán phù hợp |
| Đổi backend làm thay tokenizer/context/capability | Rebuild context và estimate cho backend đích; acceptance/role không bị hạ |
| B tiếp tục được về kỹ thuật nhưng chưa kiểm chứng khoa học | Không ghi recovery/task scientific success chỉ dựa trên exit code hoặc lời worker |

### Hiệu quả sử dụng sau bàn giao

Theo dõi evidence trong công việc thực tế: ích lợi/lỗi lập luận, chất lượng phép thử, công sức sửa, token/compute/thời gian, can thiệp và recovery. Không gộp thành điểm khám phá, không đặt cải thiện so với baseline làm gate v1. Khi có nhu cầu so sánh đối chứng hoặc benchmark, xác định phạm vi/quyền riêng; không tự chạy vì hệ thống được nghiệm thu.

## 11. Tổ chức file và thứ tự implementation tiếp theo

Các thành phần bên dưới đã có source/tài liệu trong v0.3; đây là bản đồ bàn giao để review.

- docs/research-domain-plan.md: plan tổng thể.
- docs/research-capability-plan.md: năng lực, workflow, record, tooling và cơ sở tham khảo.
- docs/v1-acceptance-plan.md: gates, walkthrough và cải tiến trong sử dụng.
- domains/research/ và skills/: role/rubric/reference có thể dùng lại giữa các backend.
- schemas/, src/, scripts/: research records, validation, context, evidence và feedback theo thiết kế; giữ core runtime trung lập.
- adapters/, examples/, test/: adapter contracts, fixture/walkthrough và regression, ghi rõ kiểm tra offline.
- Workspace của từng dự án research: tài liệu, derivations, protocol, code/runs và paper/proof/report theo mục tiêu.
- docs/system-report.md: báo cáo xây harness khi hoàn thiện v1.

Thứ tự đã triển khai: research records/profile tương thích dữ liệu cũ → role/skill/reference/context → evidence/checkpoint/handoff và feedback/rollback → gate fixtures/walkthrough/evidence runner. Tiếp theo là người dùng verify và nghiệm thu; mỗi benchmark cần xác nhận riêng kèm protocol.

Không trộn raw data, credentials hoặc log cục bộ vào gói skill.

## 12. Sử dụng thực tế và cải tiến liên tục

Sau nghiệm thu, chọn dự án research theo nhu cầu thực của người dùng. Chốt câu hỏi/phạm vi tri thức, tài nguyên, đầu ra (kể cả paper), backend/model được phép, quota pools, quyền tự quyết và điểm cần con người. Những quyết định của dự án không chặn implementation hay nghiệm thu core v1.

Trong sử dụng, agent thực hiện cả suy dẫn và thực nghiệm khi câu hỏi đòi hỏi; giữ các giả thuyết chưa chắc chắn và kiểm tra claim theo evidence. Người dùng quyết định ưu tiên/đầu tư; evaluator/verifier ghi phạm vi kiểm chứng. Không bỏ nghĩa vụ khoa học vì v1 không có benchmark khám phá.

Thu feedback tại các checkpoint hữu ích hoặc khi phát hiện vấn đề, gắn task/artifact/config/skill version. Chuyển lỗi tái hiện được thành regression; giữ nhận định định tính có bằng chứng cho phần chưa có oracle. Thay đổi có changelog, kiểm tra phù hợp và rollback; không tự điều chỉnh global model/quyền/ngân sách.

Chỉ so sánh token/chi phí hoặc chất lượng khi có điều kiện đủ tương đồng và nêu limitations. Case đã dùng tinh chỉnh không còn là held-out. Các benchmark, số lần lặp và so sánh agent/nền tảng là tùy chọn về sau theo nhu cầu, không phải điều kiện phát hành hoặc một lịch chạy ngầm.

Bước tiếp theo là verify/review source v0.3 theo gates. Plan không tự cho phép external backend, chi tiền, thí nghiệm hay xuất bản. Benchmark đã được phép thiết kế, nhưng mỗi campaign thực hiện cần hỏi riêng kèm protocol; confirmation cũ không áp dụng cho lần chạy mới. Với dự án cụ thể, công việc trong phạm vi/quyền đã cấp được tiếp tục mà không hỏi lại từng bước.

## 13. Cơ sở tham khảo

Các workflow, milestone, tên skill và schema trong tài liệu là đề xuất thiết kế cho nhu cầu đã thống nhất.

- [Agent Skills specification](https://agentskills.io/specification): dùng cấu trúc SKILL.md cùng scripts/references/assets và nạp chi tiết theo nhu cầu; khả năng thực thi vẫn tùy client.
- [NeurIPS Paper Checklist](https://neurips.cc/public/guides/PaperChecklist): tham khảo các chiều claim, giới hạn, tái lập và mô tả thực nghiệm. Đây là nguồn xây rubric; không áp toàn bộ quy định của một venue lên mọi nghiên cứu.
- [Towards a Science of Scaling Agent Systems, v3](https://arxiv.org/abs/2512.08296): cơ sở cho việc kiểm nghiệm cấu trúc phân công theo tác vụ thay vì mặc định tăng số agent.
- [Anthropic: Demystifying evals for AI agents](https://www.anthropic.com/research/demystifying-evals-for-ai-agents): tham khảo phân biệt task, trial, grader, trace và kết quả thực tế.

Các nguồn bổ sung cho lần cập nhật ngày 25/10/2026:
- [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching): tái sử dụng prefix tương thích; lợi ích cần đo theo model/backend.
- [Claude Code: Manage costs effectively](https://code.claude.com/docs/en/costs): context, nạp skill khi cần và xử lý xác định được bằng công cụ.
- [Codex App Server](https://learn.chatgpt.com/docs/app-server): steer và interrupt là thao tác khác nhau, có turn ID và sự kiện kết thúc.
- [Claude Agent SDK Python](https://code.claude.com/docs/en/agent-sdk/python): interrupt, stop_task và xử lý message buffer.
- [Antigravity headless](https://antigravity.google/docs/cli/headless/): giới hạn streaming input và control events; không suy ra khả năng bản cài từ tài liệu mới.
- [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts): tham khảo checkpoint và side effect khi resume, không phải quyết định chọn framework.

Phân biệt mức bằng chứng: tài liệu chính thức xác nhận API được mô tả; kiểm tra CLI trước đó xác nhận phiên bản/help tại máy. I1–I4 và phần record/context/feedback/benchmark guard có source và software checks; nghiệm thu cuối vẫn chờ người dùng review. M3/M5 kiểm tra cơ chế/contract; live integration chỉ được ghi đã xác minh khi có evidence thật. M6 là bàn giao v1, chất lượng/hiệu quả nghiên cứu được theo dõi trong sử dụng theo mục 12. Không suy ra tiết kiệm token hay năng lực khám phá từ mock pass.

Nguồn bổ sung cho phân bổ tài nguyên và phục hồi worker:
- [Claude context windows](https://platform.claude.com/docs/en/build-with-claude/context-windows): phân biệt context đang sử dụng với usage tích lũy; input/tool/output cùng ảnh hưởng cửa sổ.
- [Claude Agent SDK: agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop): giới hạn turns/spend, sub-agent accounting và failure không có final result.
- [Claude API rate limits](https://platform.claude.com/docs/en/api/rate-limits): retry-after và phân biệt rate limit với spend cap; không giả định mọi lỗi quota có cùng cách retry.
- [OpenAI compaction](https://developers.openai.com/api/docs/guides/compaction): context compaction, state opaque và yêu cầu dùng đúng cơ chế continuation.
- [OpenAI Agents SDK results/state](https://developers.openai.com/api/docs/guides/agents/results): lịch sử, interrupted state và bề mặt tiếp tục phiên; không bảo đảm mọi hard failure đều trả snapshot đầy đủ.
- [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence): checkpoint lưu bền vững khác checkpoint chỉ nằm trong RAM.
- [Antigravity model quotas](https://www.antigravity.google/docs/cli/commands/usage): giao diện quan sát quota; chưa xác nhận API tự động phù hợp với bản cài tại máy.

Thiết kế work unit, budget reserves, assignment fencing và recovery sequence là tổng hợp cho nhu cầu dự án. Các giá trị retry/fallback khởi điểm là chính sách đề xuất để review, chưa có benchmark chứng minh là tối ưu.

Nguồn và phân tích cho năng lực nghiên cứu, giới hạn đánh giá novelty và quyết định tối ưu trong sử dụng được ghi tại mục 2 của [kế hoạch năng lực nghiên cứu](research-capability-plan.md). Tiêu chí phát hành v1 là quyết định thiết kế cho nhu cầu người dùng, không phải kết luận rằng tri thức mới hoàn toàn không thể đánh giá.
