# Ba tầng model và trách nhiệm planning

Cập nhật 31/10/2026: xem [báo cáo triển khai/kiểm tra](verification/advisor-routing-2026-10-31.md). Runtime routing đã kiểm bằng fixtures; scientific-helper environment đang có Python hash drift, live models chưa xác minh.

Config có model_policy, độc lập role/skill, backend/model execution permissions và quota pools. Mapping hiện tại theo yêu cầu người dùng:

| Task class | Tầng | Model/tuyến mặc định | Effort | Khi dùng |
|---|---|---|---|---|
| synthesis_planning | highest | gpt-6-astra | high | Cố vấn chuyên môn tổng hợp analyses, research/verify lại và trả kế hoạch chi tiết cho orchestrator |
| analysis | medium | gpt-6.1-sol | high | Điều phối, trao đổi với người dùng, phân tích, implementation và evaluation |
| automation | low | Antigravity: gemini-3.8-flash-high | high | Chạy quy trình đã được thiết kế, ít quyết định mới |

Tên tầng là chính sách phân công, không phải chứng nhận chất lượng. Model/effort vẫn là lựa chọn riêng và có thể cùng model ở hai tầng. Model identifiers và effort High/Medium tương ứng được mô tả trong [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra), [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol). Invocation Codex truyền model_reasoning_effort qua -c theo [CLI reference](https://learn.chatgpt.com/docs/cli/reference). Khả năng dùng model trên tài khoản vẫn cần live verification khi được phép.

Cập nhật 31/10/2026 theo yêu cầu: automation mặc định dùng **Gemini 3.8 Flash High** qua Antigravity, không phải Sol Medium. [Headless reference chính thức](https://antigravity.google/docs/cli/headless/) liệt kê slug gemini-3.8-flash-high, --effort high và NDJSON stdin/output. agy.exe --help trên máy hỗ trợ các flags này; agy models trong sandbox không xác minh được inventory vì bị chặn ghi local/network và không lấy được phiên đăng nhập. Chưa chạy inference hoặc benchmark Gemini.

## Config

    "model_policy": {
      "default_task_class": "analysis",
      "orchestrator_task_class": "analysis",
      "task_class_backends": { "automation": "antigravity" },
      "task_class_tiers": {
        "synthesis_planning": "highest", "analysis": "medium", "automation": "low"
      },
      "backends": {
        "codex": {
          "highest": { "model": "gpt-6-astra", "reasoning_effort": "high" },
          "medium": { "model": "gpt-6.1-sol", "reasoning_effort": "high" },
          "low": { "model": "gpt-6.1-sol", "reasoning_effort": "medium" }
        },
        "claude": null,
        "antigravity": {
          "low": { "model": "gemini-3.8-flash-high", "reasoning_effort": "high" }
        }
      },
      "planning_verification": {
        "independent_research": true,
        "primary_source_checks": true,
        "attempt_scoped_evidence": true
      }
    }

Ví dụ đầy đủ ở examples/research.json, examples/recovery.json và examples/research-paper.json. Các backend ngoài vẫn disabled trong ví dụ. codex-cli được nhận family codex; backend alias/custom command hoặc manual orchestrator có thể khai model_family để liên kết với bảng. Mock không có family vẫn là worker giả lập, không tự biến thành model thật.

Claude để null; Antigravity chỉ có low, chưa cấu hình highest/medium. Từng family được phép khai một phần các tier; yêu cầu tier thiếu vẫn bị chặn, không tự mượn model/effort của Codex. Command adapter muốn routing phải có {{model}} và {{reasoning_effort}} trong argv. agy-cli truyền --model gemini-3.8-flash-high và --effort high; không gửi cờ reasoning của Codex.

task_class_backends chọn backend mặc định cho task mới khi chưa khai backend/model/effort riêng. Task automation không chỉ định backend đi Antigravity; explicit backend hoặc lựa chọn đã đóng băng giữ ưu tiên. Mapping codex.low=Sol Medium được giữ để tương thích khi người dùng chủ động chọn Codex, không phải fallback tự động của tuyến Gemini. Nếu Antigravity không được phép/chưa sẵn sàng, báo blocked chứ không lén chạy Sol. Tier low là tầng phân công, không bắt reasoning effort phải low.

Transport Antigravity hiện dùng một user event NDJSON qua stdin rồi EOF, không đưa prompt lớn vào argv và không mở warm-session loop. Chỉ chấp nhận một terminal result SUCCESS; lỗi hoặc nhiều result bị từ chối. Usage lấy từ terminal counters của lượt cold, không cộng lại step updates hoặc cộng thêm thinking/cache breakdown; thiếu counters vẫn unknown. Chưa công bố live steer, cooperative yielding hoặc xác minh descendants cho adapter này.

## Chọn theo công việc

Orchestrator mặc định là analysis/medium (Codex Sol High), phụ trách tương tác người dùng, phân công, tiến độ, budget/HITL và tổ chức thực hiện. synthesis_planning/highest (Astra High) là nhiệm vụ cố vấn chuyên môn riêng: nhận các analyses và bằng chứng gốc, tự kiểm tra/research lại rồi trả kế hoạch chi tiết cho orchestrator. Thường giao role researcher; không cần thêm vai trò lõi hoặc root coordinator. Quyết định khoa học trọng yếu hay thay đổi hướng nghiên cứu quay lại cố vấn; câu hỏi nhỏ, status và thực hiện thường lệ không phải đi qua cố vấn.

Luồng: người dùng ↔ orchestrator analysis → analyses của nhóm → cố vấn synthesis_planning → kế hoạch + planning_review → orchestrator → implementer/evaluator và cập nhật bằng chứng. CLI không đoán task class từ keyword. Role và task class vẫn độc lập; các lựa chọn riêng được giữ để tương thích, không phải một luật cấm mọi override.

orchestrator_task_class chỉ là mặc định khi chọn model cho điều phối. Block orchestrator.task_class hoặc model/model_tier chỉ định trực tiếp có thể ưu tiên hơn. Các presets và examples/task-orchestrator.json đều dùng analysis; thay policy trong project cũ cần kiểm tra cả những khai báo trực tiếp. Config không tự chuyển model từng lượt chat hoặc biến một orchestrator analysis thành cố vấn highest.

Task có thể khai task_class hoặc model_tier. Prompt override được điều phối chuyển thành task override có scope. Ví dụ examples/override-planning.json, override-analysis.json và override-automation.json; các file này chỉ chọn backend/class, không cấp quyền chạy model hay tăng ngân sách.

Ví dụ cố vấn: examples/task-synthesis-planning.json dùng role researcher, backend codex, class synthesis_planning và skill research-design. Trước khi dùng thật, điền câu hỏi/mục tiêu, inputs nguồn và analyses, analysis_input_paths, dependencies, acceptance và ngân sách theo project. Mẫu read-only trả kế hoạch trong result.summary; có thể thiết kế artifact kế hoạch riêng bằng writer backend được cấp quyền. Không chạy nguyên mẫu rỗng rồi coi đó là kế hoạch được kiểm chứng. Chỉ dùng override-planning trên task cố vấn; không áp lên root orchestrator để thay cho việc giao nhiệm vụ riêng.

    node scripts/harness.mjs resolve-model --config examples/research.json --backend codex --task-class synthesis_planning
    node scripts/harness.mjs resolve-model --config examples/research.json --backend codex --task-class analysis
    node scripts/harness.mjs resolve-model --config examples/research.json --backend antigravity --task-class automation
    node scripts/harness.mjs prepare-orchestrator --config CONFIG --task-class analysis

resolve-model là dry preview, không cần init hoặc gọi model. prepare-orchestrator xuất model/effort dự kiến và policy; nó không đổi model của cuộc chat Codex đang mở. Người dùng chọn model cho chat qua UI, hoặc điều phối dispatch planning task tới model đã cấu hình.

Task lưu model_selection và cặp model/effort đã resolve; attempt.effective_config giữ snapshot thực tế. Task đã đăng ký giữ lựa chọn khi tiếp tục cùng backend; muốn đổi selection tạo revision/override mới. Fallback sang backend khác phải rebind cùng tier bằng mapping của backend đích; không âm thầm hạ tầng. Tier không tạo quota pool độc lập hoặc tự tăng trần chi phí.

Explicit model/effort override được ghi source=explicit và bỏ nhãn tier nếu không còn theo binding. Model và tier mâu thuẫn bị từ chối. Config cũ không có model_policy vẫn dùng lựa chọn cũ. Với scripts hoặc quy trình xác định được hoàn toàn, ưu tiên chạy công cụ trực tiếp; tầng low chỉ áp dụng khi vẫn cần agent điều phối.

## Planning phải tự verify và research lại

Kết quả analysis là nguồn đề xuất/giả định cần kiểm tra. Planning phải tự đọc nguồn gốc, đối chiếu claim quan trọng, research thêm hoặc kiểm tra lại theo câu hỏi, nhận diện bất đồng và điều kiện chưa chắc chắn trước khi chốt kế hoạch. Không chỉ tổng hợp hoặc diễn đạt lại kết quả analysis.

Cố vấn trả kế hoạch gồm căn cứ khoa học, assumptions, các bước, vai trò phụ trách, dependencies, đầu ra, acceptance checks, nguồn lực, điều kiện dừng và quyết định còn mở. Orchestrator dùng kế hoạch để đăng ký task và tổ chức thực hiện; cố vấn không tự dispatch nhóm hoặc tự cấp thêm quyền/ngân sách. Ý kiến model mạnh hơn không tự chứng minh tính đúng; evaluator vẫn kiểm chứng bằng chứng và kết luận.

Nguồn phù hợp có thể là paper/tài liệu chính thức mới truy xuất, repo/code hiện hành, dữ liệu gốc, hoặc phép tính/thí nghiệm được phép. Không bắt buộc web search cho một câu hỏi nội bộ có thể kiểm tra bằng code/dữ liệu; nếu tính cập nhật bên ngoài quan trọng thì phải research nguồn có thẩm quyền. Luôn trong quyền và budget hiện có; thiếu bằng chứng thì giữ needs_review/inconclusive.

Khi handoff analysis qua file, task khai analysis_input_paths trùng các path trong inputs. Planning task nhận planning_requirements trong context và trường planning_review trong result schema. Muốn completed, record phải có:

- verified_for_attempt_id đúng attempt hiện hành; status ready và không còn blocking_questions.
- analysis_refs chỉ rõ các bản tổng hợp đã dùng, bao gồm các input analysis được khai báo.
- primary_checks: claim, cách kiểm tra, source có path/hash, checked_at mới trong attempt, finding và comparison_with_analysis.
- research_checks: câu hỏi, query_or_inspection, source artifacts có hash, checked_at mới và phát hiện.
- disagreements, assumptions và limitations được giữ để reviewer kiểm tra.

Timestamp phải lấy từ kiểm tra thực tế; dispatch.created_at cung cấp mốc bắt đầu. Analysis summary hoặc bản sao nguyên byte của nó không được dùng làm primary evidence độc lập. Audit cũ của attempt khác không được tái sử dụng như đã research mới. Thiếu nguồn/điều kiện quan trọng thì không báo plan completed; có thể trả inconclusive và công việc cần làm tiếp.

Đây là provenance/attestation gate: core kiểm tra hash, liên kết, thời điểm và record; không tự biết người/agent đã đọc kỹ nguồn hay nguồn có hỗ trợ kết luận hay không. Content review và scientific evaluation vẫn giữ trách nhiệm đó. Context analysis/automation không nạp thêm schema audit planning để tránh tốn token không cần thiết.

Planning có reference hướng dẫn riêng chỉ nạp theo task class; sources trong audit được giữ vào evidence_refs để hash drift tiếp tục làm kết quả cần review. Context điều phối hiển thị model_selection của từng task để bàn giao không mất class/tier/effort. Model policy không tự tạo ba process hay bắt mọi task nhỏ đi đủ ba tầng.

## Benchmark đang chờ

B01 b01_20261025_01 giữ nguyên protocol và lịch sử, được thay bằng request mới b01_20261025_02 (local, not committed), pending và chưa chạy. Scope mới: analysis → plan → calculate → review, C3 thêm update; 4 Astra High + 13 Sol High, 380.000 reservation tokens, 65 phút. Planner tự verify/research raw inputs trước khi cấp probe/replication; script automation không gọi LLM. Manifest/source/input hashes và cách chấm nằm trong protocol. Cần xác nhận riêng cho request mới; yêu cầu cập nhật model tiers không là quyền execute.

## Điều chỉnh provenance trong v0.3.1

checked_at chính xác tới giây được chấp nhận nếu interval một giây đó giao với thời điểm bắt đầu attempt; timestamp có milliseconds vẫn phải >= start. Không mở cửa sổ dung sai nhiều giây hoặc chấp nhận audit từ attempt cũ. Planning sources/evidence vẫn cần observed SHA-256; tính năng auto-pin chỉ áp dụng declared writable outputs, không thay nguồn planning.

Planning inconclusive có thể được tiếp tục sau explicit task review/reopen mà không tăng revision giả hoặc bỏ phần completed. Backend/model thật vẫn chưa live-verified. Protocol B01 đã chuẩn bị trước sửa code là artifact lịch sử; cần chuẩn bị request mới theo source/path hiện hành nếu muốn chạy.

## Project đã kết nối trước thay đổi 31/10/2026

Preset mới không tự sửa config đã đăng ký, task/attempt đã đóng băng hoặc entry skill đã copy vào project. Với project v5, dùng change.prepare/preview/apply để đặt model_policy.orchestrator_task_class=analysis và orchestrator.task_class=analysis khi đang có khai báo cũ; kiểm tra model/model_tier chỉ định trực tiếp còn tồn tại. Để đổi automation, thêm task_class_backends.automation=antigravity và binding antigravity.low như trên; task đã đăng ký cần explicit revision với backend=antigravity, task_class=automation nếu muốn chuyển. Kiểm tra quyền, quota và extension profile cho backend đích, không tự bật allow_external hay allow_execute. Task orchestrator đã đăng ký cũng cần explicit revision nếu muốn đổi lựa chọn; không sửa snapshot lịch sử. Với entry sinh tự động chưa tùy chỉnh, cập nhật bằng disconnect-gui rồi connect-gui khi phù hợp; file đã chỉnh sửa cần review thủ công và không được ghi đè. Không tự đổi model GUI hoặc ngắt công việc đang chạy.
