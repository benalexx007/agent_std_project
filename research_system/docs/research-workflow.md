# Sử dụng research records, skill và cải tiến

Implementation v0.3 hỗ trợ vòng giả thuyết → suy dẫn/thiết kế → bằng chứng → cập nhật → review → paper/proof/report. Runtime giữ trạng thái và kiểm tra hợp đồng; agent và người dùng thực hiện công việc khoa học.

Chọn task_class theo phần việc: synthesis_planning → Astra High để chốt kế hoạch sau independent research/verification; analysis → Sol High cho phân tích/implementation/review; automation → Sol Medium chỉ khi cần agent chạy quy trình đã định. Provider khác chưa map. Dùng script trực tiếp cho quy trình xác định; task nhỏ không bắt buộc đi qua ba tầng hoặc ba worker. Xem [model-routing.md](model-routing.md).

Bàn giao analysis qua artifact có hash, khai analysis_input_paths trong planning task. Planner phải đọc lại nguồn gốc và research điểm quan trọng, không chỉ diễn đạt lại summary; completed cần planning_review mới theo attempt, primary/research checks, bất đồng và không còn blockers. Audit sources được theo dõi khi file đổi. Chưa đủ bằng chứng giữ inconclusive. Hash/timestamp pass không thay thế kiểm nội dung.

## 1. Profile và đầu ra

Config hoặc task có research_profile:

    { "goal": "discovery", "reasoning_modes": ["hypothesis", "mathematical", "experimental", "verification"],
      "output": { "format": "paper", "language": "vi" } }

Goal chọn discovery/extension/reproduction/synthesis, output chọn paper/proof/report/artifact. Venue chỉ áp dụng paper và không bắt buộc. Study type vẫn mô tả phương pháp; reasoning_modes cho phép kết hợp toán và thực nghiệm. Role, backend/model, quota pool và permissions không bị profile thay đổi.

Để giảm context, references chỉ tự nạp cho skill design/experiment/evaluate theo modes đang chọn. Scope/literature/write vẫn có hướng dẫn ngắn và links để đọc thêm khi cần. Chọn task profile hẹp hơn project profile nếu tác vụ chỉ cần một phần; không cắt assumptions hoặc phản chứng để vừa ngân sách. Khi quá max_chars, runtime báo lỗi để điều phối chọn phạm vi phù hợp.

Ví dụ hoàn toàn cục bộ, không gọi model:

    node scripts/harness.mjs init --config examples/research-paper.json --owner local
    node scripts/harness.mjs register-task --config examples/research-paper.json --file examples/task-small.json
    node scripts/harness.mjs record-research --config examples/research-paper.json --file examples/hypothesis.json --owner local --epoch 1
    node scripts/harness.mjs prepare-task --config examples/research-paper.json --task review_scope
    node scripts/harness.mjs read-research --config examples/research-paper.json --record H1
    node scripts/harness.mjs review-research --config examples/research-paper.json --task review_scope
    node scripts/harness.mjs export-research --config examples/research-paper.json --task review_scope --format markdown --out examples/paper-workspace/review.md

Init/register chỉ chạy một lần trong workspace mới. Task ví dụ là fixture, không phải yêu cầu nghiên cứu thật. Muốn đầu ra proof, register task mới với --override examples/override-proof.json; override chỉ có hiệu lực cho task đó. Xuất review packet không tự sinh một paper khoa học hoàn chỉnh hoặc xác nhận kết luận.

## 2. Record và version

schemas/research-record.schema.json có bảy kind: hypothesis, derivation, experiment, evidence, review, claim, feedback. Tất cả có record_id/revision, task_id/task_revision, protocol_version, change_reason, refs, artifacts, run_ids, legacy_claim_ids và data theo kind. Record mới bắt đầu revision=1; lần sửa tăng đúng một, giữ cùng identity/kind/task. Lịch sử không bị ghi đè.

record-research yêu cầu owner/epoch hiện hành. Worker truyền thêm --attempt ID để runtime kiểm tra assignment/generation và liveness; worker cũ hoặc unknown không được publish. CLI tin người vận hành cục bộ, không thay thế authentication của backend.

Mỗi ref có record_id, revision, sha256 và relation tùy chọn:

- dependency (mặc định): kết luận còn phụ thuộc phiên bản đó. Khi dependency bị thay hoặc input thay đổi, consumer được hiển thị needs_review qua validity, không sửa verdict lịch sử.
- subject: đối tượng lịch sử đã quan sát/review. Ví dụ E1 đo hypothesis H1 revision 1; sau khi H1 revision 2 đổi quyết định, E1 vẫn mô tả đúng lần đo cũ. Subject không tự chuyển verdict sang phiên bản mới. Thay raw artifact/input hoặc task/protocol vẫn làm nguồn đó cần kiểm tra lại.

Lấy ref từ record-research/read-research. Dùng hash-artifact --file PATH để tạo path/sha256 cho file trong workspace; không nhập hash giả. Artifact symlink/path thoát workspace bị chặn.

Runtime kiểm tra support có evidence phù hợp, confirmatory plan có prediction, failed run không được dùng như phản chứng, proof-level record không còn obligation và có receipt đúng loại/phát biểu. Đây là điều kiện cấu trúc. JSON receipt là attestation; người/agent vẫn phải chạy tool/review thật và kiểm tra nội dung.

read-research --record ID --revision N đọc bản lịch sử. review-research và check-evidence báo dependency/hash/task/protocol lỗi. collect-results cũng kèm research validity. Task completed là trạng thái vận hành, có thể đi cùng hypothesis inconclusive hoặc proof chưa hoàn tất.

## 3. Toán học, verifier và nguồn thực nghiệm

Derivation giữ statement, definitions, assumptions, steps, open_obligations và level. Các mức gồm conjecture, unchecked_derivation, proof_sketch, reviewed_proof, verified_proof. Numerical/symbolic checks chỉ mô tả phạm vi kiểm tra của chúng. Muốn proof-level record cần artifact, receipt của đúng statement, outcome passed, admitted_goals=0 và obligations trống; core không đọc một file tùy ý rồi xác nhận đó là proof đúng.

Tool chuyên biệt được gọi qua command adapter với command/argv, shell=false, hoặc do người dùng/agent ở đường manual thực hiện. Chuẩn bị tool/library version, input và expected check trước khi chạy; quyền external và required_actions vẫn áp dụng. Tool wrapper trả result contract; lưu raw verifier logs thành artifact/run và tham chiếu từ derivation. Chưa có tool hoặc formalization chưa được review thì giữ mức chứng cứ tương ứng. Core không cài Lean/SymPy hoặc đào tạo prover.

Experiment record lưu question, exploratory/confirmatory, predictions, variables, controls, measurement, analysis, stop_conditions và limitations. Dùng record-run cho command/config/code/data/environment/outputs, sau đó evidence record cho observation và cách diễn giải. Lỗi chương trình là failed_run; một phép đo hợp lệ nhưng không ủng hộ giả thuyết mới là bằng chứng âm.

Giả thuyết và claim lưu support riêng với novelty. Candidate novelty phải có novelty_basis về phạm vi/thời điểm tìm; không có nhãn tự động globally confirmed. Evaluator dùng evidence gốc, phản ví dụ và giải thích cạnh tranh, không chỉ bản tóm tắt thuận lợi của worker.

## 4. Checkpoint và handoff

Checkpoint lưu research_refs pin theo ID/revision/hash; full records và task-context snapshots nằm bền vững trong SQLite, gồm cả các assumptions và nghĩa vụ chưa hoàn tất. Handoff mang toàn bộ namespace research, improvements và benchmark requests. Khi phục hồi, loader kiểm tra record/raw input/artifact và bundle fingerprint; không âm thầm bỏ phần toán hoặc phản chứng.

Thay policy/role/skill qua overlay có thể làm checkpoint cần review; rollback đúng bundle hoặc tạo revision/checkpoint mới sau khi đối chiếu. Không giả vờ native session được resume; đây là tiếp tục từ artifact. Manifest refs không thay cho backup database và toàn bộ files cần thiết.

## 5. Feedback và rollback project bundle

Ghi feedback như một research record: observation/category, config_hash từ validate-config/status, bundle_version là original hoặc change ID đã biết, proposed_change và review_outcome. Lưu evidence/ref tới case hữu ích; không yêu cầu người dùng chấm điểm mọi lượt.

propose-improvement nhận schemas/improvement.schema.json: change_id, reason, feedback_refs, files và checks có evidence. Mỗi file có target trong skills/ hoặc domains/ và path/sha256 của bản sửa trong workspace. Tool sao chép thành snapshot có hash, không sửa bản global hoặc source gốc. Checks là bằng chứng do người vận hành ghi, không tự chạy một benchmark.

    node scripts/harness.mjs propose-improvement --config CONFIG --file CHANGE --owner OWNER --epoch EPOCH
    node scripts/harness.mjs activate-improvement --config CONFIG --change CHANGE_ID --owner OWNER --epoch EPOCH
    node scripts/harness.mjs list-improvements --config CONFIG
    node scripts/harness.mjs activate-improvement --config CONFIG --change original --owner OWNER --epoch EPOCH

Activation yêu cầu không có attempt/job chưa giải quyết, config phù hợp, checks pass và artifacts còn đúng hash. Có thể quay lại change ID cũ hoặc original; lịch sử feedback/change/event được giữ. Chỉnh model/budget/permissions vẫn dùng config/sync-config có kiểm soát, không đi qua overlay Markdown. Muốn thay script/code thì review/edit source, chạy software regression và quản lý phiên bản source như bình thường.

## 6. Benchmark và nghiệm thu

Mỗi benchmark cần một tài liệu protocol đầy đủ và xác nhận riêng của người dùng. Đọc [hướng dẫn và các đề xuất](benchmarks/README.md). Mọi task thuộc benchmark phải có purpose=benchmark và request ID; quyền implementation hoặc request cũ không cho phép một campaign mới. Không nhãn task benchmark thành work để tránh guard.

Kiểm thử phần mềm bằng node scripts/verify-v1.mjs được dùng cho nghiệm thu implementation; nó không gọi model hay chạy các đề xuất benchmark. Evidence nằm trong docs/verification/v1-evidence.json. Người dùng review các case C1–C4, capability và giới hạn rồi quyết định nghiệm thu.

## 7. Tiếp tục sau inconclusive và publication của outputs

Nếu worker trả inconclusive hợp lệ, task ở needs_review, kết quả/limitations vẫn giữ. Điều phối review rồi dùng reopen-task với file có reason và tùy chọn rerun_units/evidence; unit completed còn hợp lệ được giữ, unit phụ thuộc vào phần cần chạy lại bị invalidated. Không tăng revision giả, không reset attempts/budget. Đổi scientific objective/protocol/declared inputs dùng revise-task. Decline cần replacement decision approval có supersedes_decision_id.

Worker có thể bỏ sha256 chỉ ở artifacts là declared writable outputs, không phải input lịch sử hoặc nguồn planning. Harness pin actual bytes khi validate/publication và lưu immutable output snapshot. Input/evidence/research/planning refs vẫn cần observed hash. Các unit cập nhật cùng public output được giữ phiên bản theo publication sequence; sửa public file sau publication hoặc sửa snapshot đều làm validity cần review.

save-checkpoint không nhận worker failed/cancelled/unknown hoặc settled. CLI read-only dùng bounded units và boundary checkpoint; manual import completed result tạo final checkpoint từ result đã validate. Không giả vờ có IPC live steering trên CLI thật. Xem [báo cáo sửa lỗi](operational-review-fixes.md).
