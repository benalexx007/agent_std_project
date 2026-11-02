# Kế hoạch năng lực nghiên cứu

Ngày rà soát: 25/10/2026. Đặc tả đã có implementation hỗ trợ trong source v0.3; đây không phải chứng nhận năng lực khoa học của model. Tài liệu bổ sung [plan chính](research-domain-plan.md); tiêu chí phát hành nằm trong [nghiệm thu v1](v1-acceptance-plan.md).

## 1. Mục tiêu và hai loại đầu ra

Research hỗ trợ tạo và kiểm chứng hiểu biết mới: câu hỏi, giả thuyết, mô hình, thuật toán, suy dẫn, chứng minh, phản ví dụ hoặc phát hiện thực nghiệm. Literature, reproduction và implementation là công việc cần thiết trong quá trình đó; hoàn thành riêng các công việc này chưa chứng minh năng lực khám phá.

- Dự án xây harness: bàn giao phần mềm, hướng dẫn, bằng chứng kiểm thử và báo cáo hệ thống. Không yêu cầu viết paper về harness.
- Dự án research chạy trên harness: đầu ra theo mục tiêu người dùng, có thể là paper, proof, code, dataset, báo cáo hoặc gói kết quả. Khả năng hỗ trợ paper vẫn thuộc domain; venue chỉ được nạp khi dự án cần.

Bản đầu phải có cơ chế hỗ trợ bốn năng lực bên dưới. Mức độ hữu ích và chất lượng thực tế được ghi nhận khi sử dụng. Không yêu cầu mỗi task nhỏ hay mỗi loại nghiên cứu phải dùng đủ cả bốn; không tự thêm bài toán toán học vào một task chỉ kiểm tra citation.

## 2. Cơ sở nghiên cứu và lựa chọn thiết kế

Đã đối chiếu paper, tài liệu tác giả và repo công khai; chưa cài hoặc chạy các hệ thống tham khảo. Cơ chế đề xuất cho harness là tổng hợp thiết kế, không suy ra hiệu quả tương đương với kết quả các tác giả báo cáo.

| Nguồn | Quan sát từ nguồn | Áp dụng có giới hạn |
|---|---|---|
| [AI Scientist-v2](https://arxiv.org/html/2504.08066v1), [repo](https://github.com/SakanaAI/AI-Scientist-v2) | Có sinh giả thuyết và tìm kiếm các nhánh thí nghiệm với experiment manager | Giữ lịch sử nhánh và lý do chọn/dừng; không bắt buộc cây tìm kiếm lớn hoặc sinh paper cho mọi tác vụ |
| [Towards an AI co-scientist](https://arxiv.org/html/2502.18864v1) | Sinh, phản biện, xếp hạng và phát triển giả thuyết; tác giả phân biệt đánh giá chuyên gia với ground truth | Dùng phản biện để định hướng kiểm tra; điểm ưu tiên nội bộ không xác nhận tính đúng hoặc tính mới |
| [AI-Researcher](https://arxiv.org/html/2505.18705v1), [repo](https://github.com/HKUDS/AI-Researcher) | Có phân tích khái niệm/công thức và liên hệ implementation | Lưu liên kết từ giả định/công thức đến code và phép kiểm tra; chưa đủ để chứng minh công thức mới hoặc đúng |
| [FunSearch](https://www.nature.com/articles/s41586-023-06924-6), [repo](https://github.com/google-deepmind/funsearch) | Ghép sinh chương trình với bộ đánh giá thực thi | Ưu tiên verifier độc lập khi có thể; hàm điểm chỉ kiểm tra đúng phạm vi được định nghĩa |
| [AlphaEvolve](https://arxiv.org/abs/2506.13131), [verification repo](https://github.com/google-deepmind/alphaevolve_results) | Có tìm kiếm thuật toán và mã kiểm chứng các kết quả toán học | Tách ứng viên khỏi certificate/verifier. Repo dẫn ở đây chứa kết quả kiểm chứng, không phải toàn bộ agent |
| [Discover and Prove](https://aclanthology.org/2026.acl-long.3/) | Tách việc khám phá đáp án khỏi chứng minh đáp án được phát biểu | Tách conjecture, derivation và proof; không dùng thành công trên bài cho sẵn kết luận để khẳng định khả năng tự khám phá |
| [FIRE-Bench](https://arxiv.org/html/2602.02905v1), [DiscoveryBench](https://github.com/allenai/discoverybench), [ScienceAgentBench](https://github.com/OSU-NLP-Group/ScienceAgentBench) | Cung cấp các cách kiểm tra tái khám phá hoặc tác vụ khoa học có bằng chứng tham chiếu | Tham khảo dạng lỗi và tình huống regression; không bắt buộc chạy benchmark để phát hành v1 |
| [Can LLMs Generate Novel Research Ideas?](https://arxiv.org/abs/2409.04109) | Dùng chuyên gia đánh giá ý tưởng; nêu khó khăn của đánh giá novelty và giới hạn tự đánh giá của LLM | Giữ novelty ở mức phán đoán có nguồn/phạm vi/thời điểm; không coi đánh giá ý tưởng là bằng chứng đã tạo ra tri thức đúng |
| [Demystifying evals for AI agents](https://www.anthropic.com/research/demystifying-evals-for-ai-agents) | Đánh giá kết quả quan sát được; phát triển bộ kiểm tra từ lỗi thực tế và hiệu chỉnh đánh giá bằng con người | Kiểm thử cơ chế trước phát hành; bổ sung regression từ sử dụng, không buộc agent đi đúng một chuỗi tool call |

Không có một thước đo tự động phổ quát đủ để chứng nhận khả năng tạo tri thức mới trên mọi đề tài. Từng phát biểu vẫn có thể được kiểm tra bằng proof, phản ví dụ, phép đo hoặc đánh giá chuyên môn. Quyết định cho v1 là nghiệm thu công cụ và quy trình hỗ trợ; giá trị và độ mới của kết quả được xem xét trong từng dự án sử dụng.

## 3. Bốn năng lực và artifact tối thiểu

### 3.1. Phát triển tri thức và giả thuyết

Researcher xác định điều đã biết, bất định thực sự và câu hỏi có giá trị. Khi cần khám phá, đề xuất các giả thuyết khác nhau về nội dung hoặc cơ chế, tránh chỉ đổi tên cùng một ý tưởng. Số ứng viên tùy câu hỏi/ngân sách; không bắt buộc fan-out hay quota ý tưởng.

Mỗi giả thuyết chính cần phát biểu có phạm vi, giả định, nguồn gốc, quan hệ với công trình gần nhất, dự đoán hoặc nghĩa vụ chứng minh, và điều gì có thể làm nó không còn đứng vững. Với mô tả dữ liệu chưa có cơ chế giải thích, ghi đúng là quan sát/thăm dò.

Theo dõi ba chiều độc lập:

- Nguồn gốc: lấy từ nguồn, tái lập, suy ra/mở rộng hoặc ứng viên do agent/người dùng đề xuất.
- Bằng chứng: chưa kiểm tra, có hỗ trợ trong phạm vi, bị phản bác, chưa kết luận được, hoặc cần kiểm tra lại do dependency đổi.
- Tính mới: chưa khảo sát, có công trình liên quan, hoặc ứng viên mới trong phạm vi tìm kiếm đã ghi. Không có trạng thái tự động “mới đối với toàn bộ khoa học”.

Xếp ưu tiên theo giá trị câu hỏi, khả năng phân biệt giả thuyết, chi phí và khả năng kiểm tra. Có thể giữ nhiều giải thích hoặc dừng ở chưa đủ dữ kiện. Ý tưởng bị bác bỏ vẫn lưu cùng lý do, tránh tái khám phá vòng lặp ở phiên sau.

### 3.2. Phát triển và kiểm tra toán học

Cho phép định nghĩa mô hình/đối tượng mới, suy dẫn phương trình hoặc bound, đề xuất lemma/conjecture, phân tích độ phức tạp và tìm phản ví dụ. Đây phải là công việc có thể giao và tiếp tục qua checkpoint, không chỉ nhắc “kiểm tra toán” trong prompt.

Mỗi lập luận chính lưu định nghĩa/ký hiệu, miền áp dụng, giả định, phát biểu cần suy ra, dependency vào kết quả đã biết, các bước hoặc lemma, phần chưa hoàn tất và kiểm tra đã thực hiện. Kiểm tra điều kiện biên, đơn vị, dấu, miền xác định và sự tương thích giữa giả định khi phù hợp.

Các mức bằng chứng phải hiển thị riêng: conjecture; derivation chưa rà soát; proof sketch; proof được reviewer kiểm tra trong phạm vi đã nêu; proof/certificate được công cụ xác minh. Kiểm tra symbolic hoặc numerical cũng có trạng thái và phạm vi riêng, không tự nâng thành proof tổng quát.

Tooling dùng theo nhu cầu: tính toán chính xác, đại số ký hiệu, tìm phản ví dụ, solver hoặc proof assistant. Với verifier hình thức, lưu statement, assumptions, phiên bản công cụ/thư viện và kết quả; kiểm tra formalization có đúng phát biểu mong muốn, không dùng lỗ hổng/admitted goal để báo hoàn tất. V1 không bắt buộc cài một prover cho mọi backend; khi chưa có verifier, phải giữ nhãn chưa được xác minh tương ứng.

### 3.3. Thiết kế và hiện thực thực nghiệm

Mỗi phép thử phục vụ một câu hỏi hoặc phân biệt các giả thuyết cụ thể. Protocol ghi biến thay đổi, biến kiểm soát, phép đo/estimand, kết quả dự đoán dưới các giả thuyết, confounder, phân tích, giới hạn tài nguyên và điều kiện dừng khi áp dụng.

Phân biệt thăm dò tìm pattern với phép kiểm tra xác nhận. Ở bước thăm dò có thể chưa có dự đoán định lượng; phải ghi trạng thái đó và không mô tả pattern tìm sau khi xem dữ liệu như dự đoán từ trước. Việc thích nghi protocol được phép nhưng phải lưu phiên bản và lý do.

Implementer nối công thức/giả định/phép đo với module, cấu hình và kiểm tra nhỏ. Lưu cả chạy lỗi và kết quả âm, không chỉ cấu hình thắng. Baseline, ablation, số lần lặp, dữ liệu giữ lại và thống kê được chọn theo câu hỏi; không áp một checklist cố định cho mọi nghiên cứu. Khi thiếu dữ kiện để quyết định, ghi rõ kế hoạch thăm dò trước.

### 3.4. Kiểm chứng, bác bỏ và cập nhật hiểu biết

Evaluator đọc evidence gốc và lập luận trong context độc lập đối với claim chính. Xem xét giải thích cạnh tranh, phản ví dụ, sai lệch phép đo, leakage, lỗi code và phạm vi khái quát. Kết quả bất thường có thể là tín hiệu khoa học hoặc lỗi đo; cần phân biệt trước khi đổi giả thuyết.

Sau mỗi bằng chứng đáng kể, ghi kết quả so với dự đoán, claim nào bị ảnh hưởng, quyết định giữ/sửa/bác bỏ/chờ và phép kiểm tra phân biệt tiếp theo. Không bắt buộc một số vòng hay một lần đổi ý giả tạo. Một proof hoàn chỉnh hoặc phản ví dụ quyết định có thể kết thúc nhánh ngay.

LLM evaluator đưa nhận định và đề xuất kiểm tra; verdict của nó không thay thế verifier, raw evidence hoặc chuyên môn con người. User approval là quyết định hành động, không phải chứng nhận tính đúng khoa học.

## 4. Điều phối và tính liên tục của nghiên cứu

Ba role researcher, implementer, evaluator giữ nguyên; orchestrator quản lý công việc, nguồn lực và tích hợp. Sinh giả thuyết, phát triển proof, thiết kế phép thử và phản biện là các nhiệm vụ trong role, có thể giao nhiều sub-agent khi tách được nghĩa vụ/nhánh. Không mặc định ánh xạ một chức năng thành một process hoặc một hãng model.

Model tier tách khỏi role. Cập nhật 31/10/2026: orchestrator mặc định analysis/medium (Sol High); synthesis_planning là cố vấn chuyên môn riêng ở highest (Astra High), trả kế hoạch chi tiết cho orchestrator thực hiện. Automation cần agent mặc định low qua Antigravity Gemini 3.8 Flash High. Script xác định chạy trực tiếp; Claude và Antigravity highest/medium chưa có mapping. Cố vấn phải tự đọc nguồn gốc, research/verify lại analyses và ghi planning_review mới theo attempt. Gắn analysis_input_paths với artifact bàn giao, giữ nguồn kiểm tra bằng hash, bất đồng và assumptions còn mở. Nguồn đổi làm result cần review lại. Gate kiểm provenance/attestation; evaluator vẫn kiểm nội dung. Chi tiết tại [model-routing.md](model-routing.md).

Vòng khám phá: câu hỏi → evidence đã biết → giả thuyết/lập luận → phép kiểm tra → bằng chứng → cập nhật. Các nhánh toán và thực nghiệm có thể bổ trợ nhau: dữ liệu gợi conjecture, proof tạo dự đoán, phản ví dụ yêu cầu sửa mô hình. Orchestrator chọn bước dựa trên bất định cần giải quyết trong ngân sách; không chỉ chọn thí nghiệm có metric đẹp nhất.

Context/checkpoint phải giữ phát biểu hiện hành, assumptions, lemma đã kiểm tra, nghĩa vụ còn mở, phản chứng quan trọng, các nhánh đã loại và lý do, cùng references có hash. Không cần lưu chain-of-thought riêng tư; cần artifact khoa học và lý do quyết định đủ để kiểm tra. Worker mới không được làm mất điều kiện của một lemma hoặc biến một conjecture thành kết luận đã xác minh.

Khi handoff/budget nhỏ, nạp bản tóm tắt có cấu trúc và references; bằng chứng trái chiều và điều kiện áp dụng là thông tin bắt buộc, không được loại chỉ vì muốn giảm token. Chỉ chia proof ở ranh giới có thể giữ nghĩa vụ chứng minh rõ ràng.

## 5. Hợp đồng và implementation

Source v0.3 có schemas/research-profile.schema.json và schemas/research-record.schema.json, namespace research schema 1 bổ sung vào state v2. Brief/profile ở config/task; bảy loại record dùng CLI record-research. Cách dùng ở [research-workflow.md](research-workflow.md). Giữ state/runtime chung trung lập theo domain. Ưu tiên record/artifact research có phiên bản, được task/result/checkpoint tham chiếu; không nhét toàn bộ sổ nghiên cứu vào mọi prompt.

| Record logic | Nội dung tối thiểu và liên kết |
|---|---|
| Research brief/profile | Mục tiêu tri thức, loại nghiên cứu, thành phần toán/thực nghiệm cần dùng, đầu ra dự án, tài nguyên và quyền |
| Hypothesis | ID/revision, statement/scope, assumptions, alternatives khi có, nguồn gốc/prior work, dự đoán hoặc proof obligations, trạng thái và lý do |
| Derivation/proof | ID/revision, hypothesis/claim liên quan, definitions, steps/lemma dependencies, obligations chưa giải, evidence level, verifier/reviewer và references |
| Experiment plan | ID/revision, hypothesis/prediction refs, exploratory/confirmatory, design/measurement/analysis/stop rules; liên kết run/config/code/data |
| Evidence update | Nguồn/version, quan sát, đối chiếu dự đoán, affected claims, cách diễn giải, limitations, quyết định và next check |
| Research review | Phạm vi review, reviewer/tool/version, checks đã làm, findings/độ chắc chắn, bất đồng chưa xử lý và trạng thái kết luận |
| Usage feedback | Task/artifact/config version, vấn đề hoặc ích lợi người dùng quan sát, bằng chứng, nguyên nhân giả định, thay đổi đề xuất và kết quả review |

Task nhỏ được gộp record trong một artifact; chỉ yêu cầu trường phù hợp và cho phép not_applicable có lý do. Schema kiểm tra reference/version và trạng thái; tính đúng ngữ nghĩa vẫn cần kiểm tra chuyên môn. Mở rộng phải có kế hoạch tương thích/migration nếu thay dữ liệu đang lưu; không sửa lịch sử của task cũ.

Tách trạng thái thực thi, mức hỗ trợ của claim, mức kiểm chứng proof và nhận định novelty. Task hoàn tất về vận hành có thể kết thúc với hypothesis inconclusive; lịch sử thiếu bằng chứng không được điền bằng giá trị suy đoán.

## 6. Skill và công cụ

Giữ sáu skill hiện có, bổ sung nội dung/reference theo nhu cầu thay vì bắt buộc tăng số skill hoặc số agent:

- research-scope: câu hỏi/giá trị tri thức, mức tự chủ, phạm vi chưa biết, đầu ra paper/proof/report theo dự án.
- research-literature: công trình gần nhất, assumptions/kết quả/giới hạn, bằng chứng trái chiều, phạm vi và thời điểm tìm kiếm novelty.
- research-design: reference phát triển giả thuyết, reference suy dẫn/proof, reference thiết kế thí nghiệm phân biệt; nhận sửa protocol sau evidence.
- research-experiment: nối toán–code, công cụ symbolic/numerical/proof khi cần, run manifests và evidence update. Thực nghiệm của dự án vẫn phải làm khi cần để kiểm tra claim.
- research-evaluate: rubric cho proof, thiết kế phép thử, phản chứng và cập nhật; cấp độ evidence và lời giải thích cạnh tranh.
- research-write: paper/báo cáo/proof notes theo output profile; trace claim/citation/hình/bảng và giữ limitations. Báo cáo xây harness là một trường hợp riêng.

V0.3 có loader/validator trong src/research.mjs, context assembly, checkpoint/handoff, kiểm tra liên kết và export-research. Command/manual adapter là đường gọi verifier được phép; receipt/log/run lưu thành evidence. Core kiểm tra contract/provenance, không tự xác thực ngữ nghĩa proof. Tool chuyên biệt chưa có hiển thị unsupported/unchecked. Không thêm phụ thuộc Lean/SymPy hoặc SDK hãng vào core chung chỉ để đủ tên tính năng.

## 7. Học từ sử dụng thực tế

Tại ranh giới công việc hữu ích hoặc khi người dùng phản hồi, lưu feedback ngắn gắn artifact/phiên bản; không hỏi chấm điểm sau mọi lượt. Phân biệt agent sai lập luận, thiếu context, tool lỗi, protocol không phù hợp và hạn chế model khi có đủ bằng chứng; cho phép unknown.

Luồng cải tiến: case thực tế → vấn đề có evidence → sửa skill/config/script tối thiểu → kiểm tra hồi quy phù hợp → dùng ở công việc tiếp theo → ghi kết quả. Đổi behavior có phiên bản, changelog và cách rollback; không âm thầm cập nhật global skill/model/budget từ một lời nhận xét. Thay đổi vượt quyền đã cấp vẫn cần quyết định của người dùng.

Thu số đo sẵn có: usage và nguồn đo, thời gian công cụ/job, vòng sửa, recovery, can thiệp, artifact phải làm lại. Ghi chất lượng theo nhận định có dẫn chứng như “bỏ sót giả định” hay “tìm phản ví dụ hữu ích”. Không dùng số ý tưởng, số paper hoặc số token làm điểm khám phá. Không mặc định phát sinh một chiến dịch benchmark hoặc A/B tốn tài nguyên.

Một case đã dùng để sửa skill là case regression; không gọi nó là held-out. Chỉ so sánh hiệu quả khi workload/điều kiện đủ tương đồng, có mẫu số và limitations. Chất lượng của phát hiện cụ thể có thể được review dài hạn trong dự án; v1 không chờ có một phát hiện mới để được bàn giao.


Mỗi benchmark thực hiện phải hỏi trực tiếp người dùng kèm protocol, exact scope và giới hạn. Có thể tự thiết kế proposal, nhưng không tự xác nhận hoặc kế thừa quyền từ campaign trước. src/benchmarks.mjs và [benchmark proposals](benchmarks/README.md) hỗ trợ quy tắc này.
