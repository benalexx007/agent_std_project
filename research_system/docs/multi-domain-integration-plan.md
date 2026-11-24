# Refactor đa domain — kế hoạch triển khai và nghiệm thu

Ngày: **02/11/2026**. Trạng thái: **Foundation (shared harness và Research façade) đã triển khai trên nhánh `feat/multi-domain-foundation`; Application activation để đợt sau**. Application chưa được phép khởi tạo/chạy. Xem [báo cáo kiểm thử Foundation](verification/multi-domain-foundation-2026-11-02.md).

Baseline: source 0.7.0, Git commit `9d73de585b27b98836789c7fad2a896924d6911f`. Bản này thay thế phạm vi triển khai của draft `multi_domain_integration_plan.md` người dùng cung cấp trong Downloads; không sửa bản gốc. Các đường dẫn code dưới đây tính từ `research_system/`.

## 1. Mục tiêu và quyết định chính

Một codebase phục vụ hai domain **Research** và **Application**, dùng chung hạ tầng thực thi nhưng có hợp đồng công việc, bằng chứng và đánh giá riêng. Evaluation là trách nhiệm bắt buộc trong cả hai domain, không phải domain thứ ba.

Phương án chọn: **registry nhỏ + façade Research giữ hành vi cũ + Application được thiết kế riêng**, thay vì chuyển ngay toàn bộ `research.mjs` thành generic record engine. Hoàn thành theo hai mốc có thể review độc lập:

1. **F — Foundation:** đưa các điểm phụ thuộc domain qua giao diện rõ ràng, giữ Research hoạt động; Application vẫn chưa được phép khởi tạo/chạy.
2. **A — Application activation:** hoàn thiện hợp đồng Application, storage/writer guard, schemas, workflow và kiểm tra tích hợp trước khi cho phép sử dụng.

Không gọi F là hệ thống đa domain hoàn chỉnh. Chỉ A mới có hai domain dùng được. Không bổ sung runtime ngoài, LLM điều phối ẩn, dịch vụ nền hay dynamic plugin loader vì yêu cầu này.

### Nguyên tắc giữ nguyên

- Cả hai domain đều có researcher, implementer, evaluator. Đây là ba trách nhiệm logic, không bắt buộc ba agent hoặc ba backend.
- GUI tiếp tục là orchestrator; mặc định task class `analysis`. `synthesis_planning` là cố vấn chuyên môn riêng: tổng hợp analyses, tự kiểm tra và nghiên cứu lại, trả kế hoạch cho orchestrator.
- Role, skill, domain, backend/model, quyền thực thi và quota là các trục độc lập. Domain không tự cấp quyền, đổi model hay thêm một vòng gọi cố vấn cho task nhỏ.
- Giữ managed delegation liên backend và native delegation theo năng lực đã xác minh. Thêm Application không có nghĩa phải bổ sung adapter mới hoặc kiểm thử lại mọi tổ hợp model.
- Giữ task revision, assignment fencing, checkpoint, reconciliation, publication journal, approval/CAS/rollback và provenance.
- Hoàn thành execution, cấu trúc hợp lệ, nội dung được evaluator chấp nhận và tính đúng khoa học/sản phẩm là các kết luận khác nhau.
- Không sửa project pilot, không tự migrate project đang dùng, không bật extension/model execution hoặc chạy benchmark trong đợt lập plan.

## 2. Căn cứ nghiên cứu và kiểm tra source

Các nguồn ngoài dưới đây cung cấp nguyên tắc hoặc cơ chế; lựa chọn kiến trúc là suy luận áp dụng cho repo, không phải khuyến nghị trực tiếp của tác giả dành cho hệ thống này.

| Nguồn đã kiểm tra | Điều được nguồn hỗ trợ | Áp dụng trong plan |
|---|---|---|
| [Branch by Abstraction — Martin Fowler](https://martinfowler.com/bliki/BranchByAbstraction.html) | Có thể đưa interface vào trước, chuyển client từng phần và để implementation cũ/mới cùng tồn tại | Façade Research trước; chuyển call sites theo lát cắt có regression; không rewrite đồng loạt |
| [Bounded Context — Martin Fowler](https://martinfowler.com/bliki/BoundedContext.html) | Các mô hình có ý nghĩa khác nhau cần ranh giới và quan hệ tường minh | Research proof/novelty không trở thành acceptance/release của Application chỉ bằng đổi nhãn |
| [JSON Schema: objects và closed schemas](https://json-schema.org/understanding-json-schema/reference/object) | `additionalProperties` chỉ nhận biết properties trong cùng subschema; composition có bẫy khi đóng schema | Mỗi domain dùng schema đóng đầy đủ; không dựa vào `oneOf` chỉ kiểm tra discriminator để ngăn field chéo domain |
| [SQLite application-defined functions](https://www.sqlite.org/appfunc.html) | SQL function do application đăng ký thuộc từng connection | Writer capability phải được khai báo trên từng connection ghi; connection cũ không được mặc nhiên có capability Application |
| [SQLite CREATE TRIGGER / RAISE](https://www.sqlite.org/lang_createtrigger.html) | Trigger có thể chặn statement bằng `RAISE(ABORT, ...)` | Chặn writer/domain/version không tương thích tại DB, đồng thời giữ kiểm tra ở API |

### Phát hiện tại baseline

| Điểm trong source | Hệ quả đối với refactor |
|---|---|
| `config.mjs` hash bằng `JSON.stringify(config)` sau normalization | Đổi default, thứ tự thêm property hoặc extension fingerprint có thể làm lệch config dù ý nghĩa gần giống |
| `store.mjs` writer guard chỉ biết version; writer hiện tại trả `5` | Không tạo Application dưới v4/v5. Probe trước đó cho thấy guard hiện tại cho writer 5 cập nhật payload v5 mang domain application |
| `Store.migrate()` chỉ nhận nguồn v1/v2/v3, no-op v4/v5 | Chọn Application v6 sẽ khiến luồng migration cũ từ chối. Vẫn cần DB guard riêng để bảo vệ direct writer/đường ghi khác |
| `gui-state.mjs`, `harness.mjs` và các consumer có checks v4/v5 hoặc `===5` | Cần bảng hỗ trợ format/capability tập trung; không thay mọi số 5 thành 6 hoặc mở mọi predicate |
| `research.mjs` có historical subjects, run/legacy claim refs, feedback, reverse expansion cho evidence/review | Không có căn cứ cho khẳng định “70% generic”; chuyển nguyên engine trước khi biết Application dễ làm mất ngữ nghĩa |
| `context.mjs` và `checkpoints.mjs` pin role/skill/rubric/schema resources | Config hash không đổi vẫn chưa đủ để checkpoint cũ dùng lại; phải bảo toàn cả bundle refs hoặc có quy trình chuyển phiên rõ ràng |
| `checkpoint.schema.json` mô tả index record; file manifest được tạo/đọc riêng | Thêm domain vào index schema không tự bảo vệ manifest. Phải có validation và domain binding cho payload manifest mới |
| `gui-connect.mjs` so sánh toàn bộ nội dung file, manifest v1 chưa có domain | Thêm field vào manifest/connection hàng loạt sẽ gây conflict với entry cũ; cần reader legacy và update có kiểm soát |
| `extension-runner.mjs` có operation-specific branches, worker Python và prefix Research cố định | Chỉ thêm `entrypoint` vào manifest chưa tạo dispatcher tổng quát; phải xác định execution route và publication binding |
| Validator chỉ hỗ trợ 22 keyword và `$ref` nội bộ | Không thêm `if/then`, `allOf`, `unevaluatedProperties` hoặc external refs trong đợt này |

Baseline kiểm tra phần mềm hiện có: **17 test files, lần full suite ngày 31/10 có 218/231 pass, 13 failures liên quan Python binding drift**, không phải toàn bộ green. Xem [báo cáo routing](verification/advisor-routing-2026-10-31.md). Kiểm tra đọc config trong đợt review vẫn gặp `Base Python binding changed` với hai example bật extensions. Chưa chạy lại full suite cho bản plan này.

## 3. Kiến trúc đích và ranh giới trách nhiệm

```text
GUI orchestrator / CLI / native tools
                 |
       Shared services + policy
                 |
      Domain registry (built-in)
           /              \
  Research façade     Application module
  existing semantics  separate semantics
           \              /
     Shared execution + persistence
     assignments / accounting / checkpoints
     artifacts / jobs / publication / recovery
```

Registry là bảng các implementation tin cậy nằm trong source. Config chọn ID, không chỉ định đường dẫn JS để import. Domain hook không được thay thế authorization, quota, fencing hoặc publication checks của core.

Mỗi project có **một domain bất biến**. Cùng codebase có thể chạy nhiều project khác domain. Đề tài Research có code ứng dụng vẫn có thể là project Research; domain do mục tiêu đầu ra quyết định, không phải ngôn ngữ lập trình hoặc từng task. Không hỗ trợ đổi domain tại chỗ hay task Application chen trực tiếp vào state Research.

Chuyển giao giữa project/domain dùng artifact export có provenance và hash, được project đích nhập rõ ràng theo chính sách input sẵn có. Không tạo live foreign record ID xuyên DB, không cấp quyền truy cập project khác tự động. Một bridge đồng bộ cross-project là ngoài phạm vi.

### 3.1. Domain descriptor tối thiểu

Đề xuất `src/domains.mjs` quản lý lookup; adapter Research có thể nằm trong `src/domains/research.mjs`. Chốt đường dẫn chính xác ở F1, tránh xung đột thư mục nội dung `domains/research/` đang có.

| Nhóm | Trách nhiệm descriptor | Giới hạn |
|---|---|---|
| Identity | `id`, `contractVersion`, trạng thái enabled và state formats được hỗ trợ | Domain chưa implemented không được fallback Research |
| Contracts | Schema config/task/record và schema result nếu cần khác; domain config/task checks | Core luôn kiểm tra project/task/attempt binding; không tin domain tự khai trong result |
| Roles/resources | Ba role bắt buộc; role/rubric/entry/planning resources thuộc domain | Path được core confine và pin; không arbitrary import |
| Context | Build các field domain cho worker/orchestrator; record selection/index | Research giữ field và thứ tự serialization hiện hành; không nhét cả hai domain vào prompt |
| Records | `record/read/validity/snapshot/checkSnapshot/packet/review/render` | Research adapter gọi implementation hiện có; store access/write vẫn qua transaction và fencing |
| Planning | Guidance và kiểm tra ngữ nghĩa bổ sung | Không tắt independent checks, primary evidence, attempt binding hoặc freshness |
| Surface | Metadata inspect, tên entry skill, domain-specific overrides/protected keys | Quyền chung luôn được core kiểm tra; domain chỉ được bổ sung restriction |

Không truyền cả registry vào context của model. Không thiết kế hàng chục hook dự phòng cho domain chưa tồn tại. Các data selector/policy hooks nên thuần; mutation records đi qua transaction được core kiểm soát. Hook lỗi phải propagate đúng loại lỗi, không biến thành thành công/thiếu quota.

### 3.2. Phần giữ, phần chuyển, phần chưa cần xây

| Phần hiện tại | Xử lý |
|---|---|
| Backend adapters, model policy, native transports, token/usage ledger | Giữ logic; chỉ sửa binding/schema dispatch ở nơi domain thực sự đi qua |
| Engine, work units, assignments, recovery, workspaces/publication | Giữ state machine; thay điểm gọi domain-specific validation/snapshot; bổ sung boundary checks |
| Research records, rubric, skills, scientific semantics | Giữ; không đổi format/tên path để “đẹp” hơn |
| Context, config, report, CLI/GUI catalogs, improvements | Route qua descriptor; shared mechanics vẫn một implementation |
| GUI entry | Giữ entry Research; thêm entry Application mỏng, dùng chung scripts/services |
| Generic DAG engine | Chưa bắt buộc. Chỉ trích primitive sau khi cả hai domain có cách dùng thực và invariant khớp |
| Tên thư mục/package `research_system` | Giữ ở đợt này để tránh đổi bundle roots, entry binding, paths và locks |
| MCP/runtime/UI mới | Không cần cho refactor đa domain |

Không đưa ra tỷ lệ phần trăm code giữ lại trước khi có diff. Tiêu chí là giữ các invariant và giảm duplication thật, không đạt số lượng abstraction.

## 4. Hợp đồng tương thích và storage

### 4.1. Research không bị migrate bắt buộc

- Research v4/v5 giữ version và layout: `state.research`, `research_refs`, task research fields, run/claim APIs hiện hành.
- Không tự thêm `domain_contract_version` hoặc empty Application fields vào normalized Research config, task, attempt, checkpoint hay handoff cũ.
- Với cùng input, source path, bundle và môi trường hợp lệ: normalized config và `config_hash` phải bằng baseline; resolved Research task và các hash ràng buộc tương ứng không drift ngoài thay đổi đã duyệt.
- Config có extension môi trường sai phải tiếp tục bị từ chối; không pin lại hash chỉ để đạt compatibility test.
- Giữ nguyên file role/skill/rubric/schema Research đã được checkpoint pin trong phạm vi F. Ưu tiên thêm tài liệu/schema Application riêng thay vì sửa resource Research dùng chung khi không cần.
- Checkpoint cũ được tiếp tục nếu các binding hiện hành vẫn hợp lệ. Nếu một thay đổi bắt buộc làm resource pin khác, phải báo incompatibility và dùng workflow revision/replanning hiện có; không sửa manifest/hash lịch sử để cho pass.
- Không yêu cầu JSON chứa timestamp/ID mới phải byte-identical. Golden comparisons chỉ cố định hoặc loại đúng các field volatile đã khai báo, không loại nội dung/hashes quan trọng.

### 4.2. Application state v6 và chặn writer cũ

**Chọn:** Application khởi tạo mới ở format v6; không nhét Application vào v4/v5. Research vẫn dùng v4/v5. Đây là version của format state, không phải xếp hạng năng lực domain.

Thiết kế cần triển khai ở A2:

1. Hàm kiểm tra state hỗ trợ dựa trên cặp `(schema_version, project.domain)` và độ nhất quán với `config.project.domain`. Chỉ cho các cặp hợp lệ: Research v4/v5, Application v6. Unknown/inconsistent phải từ chối ghi.
2. Writer Research vẫn khai báo compatibility generation 5 để guard v5 hiện có không từ chối binary mới. Không đổi global `harness_writer_version()` sang 6 cho mọi DB.
3. Application có guard riêng, tên khác guard legacy. Guard yêu cầu capability Application v6 đăng ký trên connection và kiểm tra domain/version bất biến giữa OLD/NEW. Connection cũ thiếu function/capability không ghi được; hạ v6 xuống v5 cũng bị chặn.
4. Luồng cài guard mới không vô tình drop guard Application khi cài guard legacy. Trên Application không cài predicate legacy yêu cầu writer bằng 5. Kiểm tra cả INSERT/REPLACE/DELETE nếu chúng có thể thay singleton state; cấm đường replace bypass hoặc bắt capability tương ứng.
5. `migrate-state` cũ phải từ chối v6 trước khi thay guard; kiểm chứng bằng code baseline thật, không chỉ một mock function. `upgrade-gui` mới có xử lý riêng v6: thêm GUI capability khi idle mà không hạ state xuống 5. GUI Application tiếp tục dùng format v6.
6. State-format checks tập trung ở một module nhỏ dùng chung Store/GUI/CLI/handoff; không mở rộng legacy rescue v3 sang Application.
7. Tạo state và guards trong transaction; kiểm tra binding lại ngay trong transaction ghi. Inspect chỉ đọc, không cài trigger hay migration.

Đây là bảo vệ đối với binary/luồng ứng dụng không tương thích, không là sandbox chống người có quyền sửa trực tiếp DB và cố ý xóa trigger. Cần ghi rõ phạm vi này trong runtime docs.

### 4.3. Domain fields cho dữ liệu mới

- Giữ toàn bộ tên Research cũ. Application dùng `state.domain_records` có envelope `{domain: "application", contract_version: 1, ...}` và `domain_refs` trên attempt/checkpoint/handoff mới.
- Task Application dùng `domain_record_ids`; không thêm song song `application_refs` và `domain_refs`. Research alias chuyển tới adapter Research, không sao chép cùng record sang store mới.
- Record refs phải có identity/revision/hash phù hợp cùng project/domain/contract version; cách serialize chi tiết được chốt trong A1. Không tin một envelope tự khai để vượt binding project.
- Domain suy ra từ state → task → attempt, có checks nhất quán. Result có đúng schema nhưng thuộc attempt/project khác vẫn bị từ chối trước publication.
- Handoff v4/v5 tiếp tục đọc được; format v6 có domain envelope bắt buộc. Không sửa handoff cũ trên đĩa trong read/inspect.
- Manifest checkpoint Application có schema format riêng và validation đầy đủ cho domain snapshot, task revision, protocol, bundle/input refs, assignment. Legacy manifest Research vẫn dùng reader tương thích cùng các checks cũ.

### 4.4. Schemas và normalization

Ưu tiên **chọn schema theo domain, mỗi schema là object đóng đầy đủ**:

- Config chưa có state: kiểm tra discriminator `project.domain` hợp lệ bằng lookup `Object.hasOwn`, sau đó validate toàn bộ schema domain. Research dùng schema hiện có; Application có schema riêng.
- Task/record/result có state: chọn schema bằng domain của project, rồi xác nhận payload không khai domain khác. Không để payload chọn validator dễ hơn.
- `research_profile` không hợp lệ trong Application; profile/record fields Application không hợp lệ trong Research. Kiểm tra cả config root, task overrides và GUI patch.
- Giữ validator 22 keywords; `$ref` chỉ nội bộ. Chấp nhận một phần schema chung được lặp có chủ đích trong schema Application ban đầu; tests chặn shared-policy divergence. Chỉ thêm cơ chế build schema khi duplication thực sự cần, không thêm loader/runtime framework.
- Nếu cần schema union cho công cụ ngoài sau này, mỗi branch phải đóng đầy đủ root và discriminator; không coi union là thay thế semantic validation.
- Model/permission/resource defaults giữ chung cùng code; normalization riêng domain không được thêm defaults vào Research hiện hành.

## 5. Context, planning, records và đánh giá

### Research

Façade phải giữ semantics revision/subject/dependency, assumptions, counterevidence, proof obligations, novelty, run refs, feedback config/bundle binding và cách chọn packet. Không gom mọi record vào một graph traversal mới chỉ để dùng chung API.

`PLANNING_REQUIREMENTS` và exports cũ tiếp tục dùng được cho Research. Core vẫn kiểm tra nguồn không trùng analysis, artifact hash, attempt ID và freshness. Planning instructions được chọn theo domain nhưng không yếu đi; các checks provenance không tự chứng minh model thật sự đọc hoặc hiểu nguồn.

### Application — hợp đồng cần hoàn thành trước activation

Phạm vi hướng tới dự án AI engineering thực tế: khảo sát nhu cầu/giải pháp, thiết kế, implementation, kiểm chứng hành vi và vận hành. Không giới hạn thành “viết code xong chạy unit test”.

| Trách nhiệm | Đầu vào/đầu ra cần hỗ trợ | Đánh giá theo domain |
|---|---|---|
| Researcher | Problem/requirements, nguồn kỹ thuật, dữ liệu, alternatives, feasibility/constraints | Nguồn phù hợp, giả định công khai, quyết định có căn cứ và trade-off |
| Implementer | Design/plan → code/config/data pipeline/artifacts, reproduction steps | Thực hiện đúng scope, giữ ràng buộc, truy được build/version/input |
| Evaluator | Acceptance criteria → checks/results/issues/verdict | Hành vi đúng yêu cầu và điều kiện vận hành; không dùng “novelty” hay “proof verified” làm nhãn mặc định |

A1 cần quyết định cụ thể các loại record tối thiểu. Đề xuất ban đầu: **requirement, design_decision, implementation, verification, issue, acceptance**. Đây là tập để review, chưa là schema đã được duyệt. Feedback có thể tái dùng contract nếu semantics thật sự khớp.

Hợp đồng phải mô tả:

1. Quan hệ requirement → design/change → verification → acceptance và dependency bị stale khi spec/code/input liên quan đổi.
2. Các trạng thái passed/failed/inconclusive/not_run của kiểm chứng; “không có test” không được diễn giải thành passed.
3. Verdict của người/model là attestation; evidence liên quan, phạm vi kiểm tra, hạn chế và unresolved issues phải tách khỏi execution completed.
4. Kết quả CI/test/build có command, môi trường/version, inputs, exit status và outputs được pin trong phạm vi phù hợp; không yêu cầu mọi task nhỏ tạo cả sáu record.
5. Risk/waiver nếu có phải explicit và truy được quyết định của người có quyền; không tự cho phép deploy, gửi dữ liệu hay nâng permission từ acceptance.
6. Cố vấn synthesis_planning nghiên cứu lại spec/code/docs/data gốc và lập kế hoạch; không bắt đọc paper khi bài toán là sửa sản phẩm.
7. Profile/rubric nhỏ đủ cho công việc phần mềm/AI engineering. Tiêu chí nghiệp vụ chuyên ngành, production SLA và toolchain riêng được thêm theo project; không cài tất cả từ đầu.

Không dùng benchmark năng lực tạo tri thức hoặc benchmark chất lượng sản phẩm để chứng minh refactor đạt yêu cầu. Hai loại chất lượng đó được theo dõi qua sử dụng thật và review kết quả.

## 6. Extensions, GUI và khả năng tùy chỉnh

### 6.1. Extensions: dùng lại theo năng lực, không theo tên thư mục

- Giữ package/lock/env Research cũ và compatibility reader; không đổi tên `.research-environment` để phục vụ branding.
- Math, statistics, figures, PDF và retrieval có thể dùng cho Application nếu hợp đồng operation, scope/quyền và output phù hợp. Tên package Research không tự động cấm reuse, cũng không tự động cho phép mọi operation.
- Domain admission là giao của domain policy, project activation, role/task scope, backend capability và authorization. Không mở rộng profile hiện hành chỉ vì Application xuất hiện.
- Dùng chung Python environment khi lock/interpreter tương thích; chỉ tách khi dependency xung đột hoặc có yêu cầu isolation thực. Không provision khi connect/inspect.
- Giữ interpreter hash drift là lỗi cần xử lý, không đổi sang bỏ pin để tiện dùng chung.

Phần cần thay trong dispatcher:

1. Metadata package được resolve thành route nội bộ tin cậy; entrypoint nằm trong package/bundle, có trong lock và đúng interpreter binding.
2. Các operation hiện có vẫn có handler, kiểm tra args/network/rate/size rõ ràng. Không dispatch operation lạ vào một shell command từ manifest.
3. Fallback worker/namespace legacy chỉ áp dụng package Research đã nhận diện, không áp dụng mọi manifest thiếu field.
4. Artifact namespace được kiểm tra và pin cùng call/attempt/package binding, receipt và publication. Chỉ đổi prefix trong runner mà không đổi validator publication là chưa hoàn thành.
5. Legacy Research giữ `research-artifacts/extension_*`. Application có namespace output riêng khi tạo call mới; không move outputs lịch sử. Resource dùng chung không đồng nghĩa dùng chung thư mục output giữa project.
6. Nếu cần thay manifest/lock để hỗ trợ package Application, version hóa metadata mới riêng; không regenerate lock Research cũ trong cùng refactor nếu chỉ cần adapter nội bộ đọc nó.

Không xây framework package động tổng quát hay bộ helper Application mới khi chưa có operation cần thiết. Mục tiêu là reuse an toàn các năng lực có sẵn.

### 6.2. GUI connection và project config

Domain discovery theo thứ tự:

1. Có state: đọc SQLite bằng reader read-only và validate format/domain; domain state là authoritative.
2. Chưa có state: nhận domain từ config được validate hoặc lựa chọn explicit. Giữ mặc định Research cho cú pháp legacy connect không có state/config/domain; output phải ghi rõ đây là legacy default chưa init.
3. Config, state, manifest hoặc `--domain` explicit bất đồng: báo lỗi, không chọn nguồn tiện nhất. DB hỏng/format lạ không được xem như “project mới Research”.

Connection manifest mới có domain và format version. Manifest v1 không có domain chỉ được đọc là Research khi đúng hình dạng/paths legacy được nhận diện. Reconnect legacy chưa đổi entry phải idempotent; không rewrite chỉ để thêm domain field.

Nếu phải cập nhật entry: preview delta, kiểm tra file hash/manifest nguồn, bảo toàn file đã sửa, cập nhật qua thao tác explicit có rollback. Disconnect chỉ xóa file thuộc allowlist của đúng host/domain và đúng hash. `connection.json` vẫn là file sinh ở project, không bắt source skill có sẵn file này.

Giữ `research-project`; thêm `application-project` với entry mỏng và backend path mapping tương ứng. Dùng chung service/script, không copy orchestration logic vào mỗi skill. Generated files không chứng nhận host GUI đã load skill, native identity/model/quyền hay usage.

GUI config prepare/apply/rollback và `sync-config` legacy đều cấm đổi project.domain. Cấu hình profile/roles/skills theo domain vẫn qua cơ chế preview, protected changes và CAS hiện có; domain plugin không tự xác nhận thay người dùng. Improvement overlay được giới hạn vào resources domain hiện hành hoặc shared resources cho phép; không sửa global/personal skills.

### 6.3. CLI, native tools và inspect

- Thêm API/action chung `domain.record/read/review/export`; CLI tương ứng `record-domain/read-domain/review-domain/export-domain`. Đây là tên dự kiến triển khai, **chưa dùng được ở baseline**.
- Legacy `record-research/read-research/review-research/export-research` tiếp tục hoạt động trên Research; gọi ở Application báo sai domain rõ ràng.
- Catalog mặc định chỉ hiện domain đang dùng và chức năng shared. Catalog discovery không có state có thể liệt kê domain hỗ trợ, nhưng không trao quyền thực thi.
- Cùng service checks áp dụng CLI, GUI và native tools; không để alias trở thành đường bypass domain validation.
- Inspect terminal giữ redaction/bounded output; bổ sung domain, contract version suy ra hoặc explicit, format state, capabilities, roles/skills/extensions hiệu lực và nguồn cấu hình. Hiện rõ legacy/disabled/pending thay vì giả định đã bật.
- Read-only inspect vẫn hoạt động khi config/environment lỗi để hỗ trợ chẩn đoán; không mở writer Store chỉ để tìm domain.

## 7. Các lát cắt triển khai

Các bước trong bảng là tuần tự theo dependency. Mỗi bước có negative isolation tests ngay khi có đường ghi mới; không để toàn bộ bảo vệ sang bước cuối.

| Bước | Công việc và file chính | Điều kiện kết thúc |
|---|---|---|
| **F0 — Baseline có thể tái hiện** | Pin commit; tạo fixtures Research v4/v5/config/task/context/checkpoint/GUI v1 từ baseline. Đọc báo cáo hiện có; xử lý Python drift riêng bằng environment review/rebind hợp lệ nếu cần. Lưu hashes/provenance fixture | Phân biệt known failures và regressions; fixture không là bản copy dữ liệu project thật. Chưa tuyên bố full green khi extension tests còn blocked |
| **F1 — Registry và guards** | `domains.mjs`, Research adapter; `config.mjs`, `engine.mjs`, `gui-changes.mjs`: schema dispatch, role/override/domain binding, cấm domain mutation. Application chỉ là known-unavailable, không fake implementation | Research normalization/task behavior không drift; unknown/cross-domain bị chặn mọi entry path liên quan |
| **F2 — Research qua façade** | `context.mjs`, `planning.mjs`, `checkpoints.mjs`, `artifacts.mjs`, `report.mjs`, `improvements.mjs`, engine/recovery snapshot call sites | Existing Research semantics và checkpoint dùng được; schema/resource bytes Research được pin không thay ngoài phạm vi đã review |
| **F3 — Surfaces và reuse boundary** | CLI/native tools/GUI service, `gui-connect.mjs`, `inspection.mjs`, extension resolve/runner/publication, lock/provision scripts chỉ khi cần | Legacy GUI idempotent; catalog domain-scoped; dispatch Research cũ tương đương; không enable Application/external execution |
| **Gate F** | Review diff, targeted regressions và full suite/static của candidate ổn định; báo cáo compatibility + limitations | Có thể dùng foundation với Research. Nếu env chưa khôi phục hợp lệ, ghi F chưa nghiệm thu đầy đủ, không skip để pass |
| **A1 — Application contract** | Viết `docs/application-domain-contract.md`, roles/rubrics/skills tối thiểu và mẫu task/profile/records; xem lại review rubric với mục tiêu người dùng | Record lifecycle, invalidation, evidence/verdict và small-task path đủ rõ; chỉ hỏi người dùng nếu còn quyết định nghiệp vụ ảnh hưởng implementation chưa xác định |
| **A2 — Format và implementation Application** | State compatibility module, `store.mjs`, GUI state, handoff/manifest schemas; `application.mjs` và descriptor; config/task/result/record schemas + example disabled | v6 chỉ ghi bởi writer phù hợp; hai domain chạy mock workflow, kết quả không lẫn; guards chặn old writer/downgrade |
| **A3 — End-to-end integration** | Entry Application, GUI/CLI/native catalog, inspect/report/overlay, extension reuse và publication; cập nhật check-project/verify scripts cho fixtures/domain inventory | Có workflow mock Application đầy đủ, handoff/checkpoint/recovery và GUI config; Research regression giữ được |
| **Gate A — Nghiệm thu phần mềm** | Chạy matrix tối thiểu ở mục 8; full suite + static trên source cuối; tài liệu dùng/rollback, evidence có timestamp/hash | Hai domain dùng được trong phạm vi software verification; native GUI live và chất lượng công việc vẫn ghi giới hạn |
| **O1 — Trích primitive nếu có lợi** | So sánh code hai domain; chỉ trích logic revision/hash/ref thực sự đồng nhất | Tùy chọn, không chặn nghiệm thu A. Bỏ bước nếu abstraction làm tăng độ khó hoặc buộc mất semantics |

### File impact cần kiểm kê trong F0/F1

| Nhóm | File/module phải rà soát |
|---|---|
| Storage/version/binding | `store`, `gui-state`, `gui-changes`, `engine`, `workspaces`, `native-state`, handoff import/export và các checks schema_version |
| Domain services | `research`, `config`, `context`, `planning`, `checkpoints`, `artifacts`, `report`, `improvements` |
| Entry points | `scripts/harness.mjs`, `gui-service`, `gui-work`, `gui-connect`, `native-tools`, `inspection`; exports module công khai |
| Helpers | `extensions`, `extension-runner`, `extension-native`, `publication`, manifest/lock schemas và provisioning/locking scripts |
| Contracts/resources | config/task/attempt/result/handoff/checkpoint schemas; schemas mới riêng Application; domains/skills/integrations/examples |
| Verification/docs | 17 suites hiện có + tests mới có mục đích; `check-project`, `verify-v1`, runtime/GUI/extensions/user guide/README/AGENTS nếu invariant thay đổi |

Đây là danh sách rà soát, không yêu cầu sửa mọi file. `rg` tìm domain/version/path assumptions trước mỗi lát cắt; tránh rename/reformat làm nhiễu diff.

## 8. Nghiệm thu tối thiểu, không benchmark LLM

Tái dùng assertions/tests hiện hành, thêm test tại boundary mới. Không nhân ma trận theo mọi backend × model × domain; backend semantics không thay thì dùng fake/manual/mock hoặc recorded protocol fixture. Không coi mock là bằng chứng host GUI thật hoạt động.

| ID | Cách kiểm tra tối thiểu | Tiêu chí pass / rủi ro được chặn |
|---|---|---|
| **MD01 Compatibility** | Fixtures baseline cho Research v4/v5; normalize config có/không extensions hợp lệ; resolve task; context/snapshot/handoff; legacy GUI v1; checkpoint dở dang | Hash/field quan trọng không drift; no forced migration; source/resource pins hợp lệ; không sửa lịch sử để đạt pass |
| **MD02 Isolation** | Table-driven invalid config/task/profile/record/override; GUI patch domain; alias Research ở Application; refs sai project/domain/version | Từ chối trước mutation/publication; transaction không đổi payload; unknown domain fail-closed |
| **MD03 Writer formats** | DB tạm Application v6; binary/module baseline gọi transaction/migrate/upgrade/config path; connection thiếu/sai capability; thử downgrade/replace; new writer Research4/5 và App6 | Old writer không sửa payload/guard; writer hợp lệ hoạt động; Research old writer compatibility giữ trong phạm vi quy định; inspect không mutate |
| **MD04 Research regression** | 17 suites hiện có, giữ assertions; fixture phù hợp cho namespace/schema routing mới | Không yếu scientific validity/planning/recovery/publication checks; failures môi trường phải giải quyết hoặc báo blocked |
| **MD05 Application lifecycle** | Một workflow mock gộp requirement→design→implementation→verification→acceptance; thêm failure/inconclusive và input revision; một checkpoint/recovery với late result | Verdict không tự nâng; stale dependency lan đúng; late assignment bị chặn; publication đúng domain; run completed không đồng nghĩa acceptance |
| **MD06 GUI/CLI/native surface** | Table-driven generation cho 3 host path mappings, mock bound calls; reconnect/disconnect legacy và mới; file modified/corrupt state; prepare/apply/rollback; inspect redaction | Không overwrite customization, không fallback DB hỏng, alias/catalog đúng domain; core checks cùng semantics qua từng surface |
| **MD07 Extension boundary** | Reuse một operation phù hợp không mạng trong hai project; unknown operation/domain-scope, unpinned entrypoint, namespace/receipt tamper; existing extension tests giữ nguyên | Private inputs không rò; publication/binding chính xác; legacy package không bị đổi fingerprint ngoài review; env drift vẫn bị chặn |
| **MD08 Context và overhead** | So sánh deterministic context chars/bytes và resource/read selection trên fixture Research cùng inputs; App chỉ nạp own/shared cần thiết; kiểm tra không có network/model/process mới khi inspect/prepare | Research không tăng prompt do registry/refactor; không nạp toàn bộ domain/record history; không thêm LLM calls/helper boot tự động |

Quy tắc thực hiện:

- Trong từng slice: chạy focused tests ảnh hưởng. Trước Gate F và A: full suite + `node scripts/check-project.mjs` theo AGENTS; chỉ lặp lại khi có sửa đổi/failure mới đáng kiểm tra.
- Có thể gộp nhiều assertions vào một fixture workflow, nhưng các negative cases phải cô lập failure để biết guard nào thực sự được kiểm tra.
- Thực hiện trên workspace tạm, seed dữ liệu tổng hợp; không dùng project pilot đang chạy làm vật thử.
- Đo context bytes là proxy regression, không gọi đó là token billed hoặc phần trăm quota. Native usage không quan sát được vẫn ghi unknown.
- Không đặt một ngưỡng latency/RSS tùy tiện. Nếu đường nóng thay thuật toán, đo offline có baseline và điều kiện cố định để điều tra; chỉ dùng làm gate sau khi có ngưỡng có căn cứ.
- Không tạo benchmark B04 để “chứng minh đa domain”. Chất lượng planning, research novelty, lợi ích sản phẩm, model routing tối ưu và UX thật được ghi nhận qua sử dụng. Nếu phát sinh benchmark riêng, vẫn cần protocol và người dùng duyệt từng run.

Báo cáo nghiệm thu tương lai dự kiến `docs/verification/multi-domain-<date>.md` và evidence machine-readable: commit/source hash, environment, commands, counts, compatibility matrix, known limits. Không ghi con số tests pass dự kiến như kết quả đã có.

## 9. Tối ưu mà không đánh đổi năng lực

| Tối ưu | Lợi ích thực tế | Ràng buộc giữ |
|---|---|---|
| Registry static, chỉ resolve domain hiện hành | Ít wiring và không cần runtime/plugin service | Domain-specific validation không bị bỏ |
| Giữ Research façade, không generic hóa toàn graph ngay | Giảm migration/debug cost, dễ rollback | Đủ API để Application tích hợp đầy đủ sau contract |
| Context domain-scoped, resource theo role/task | Không làm prompt Research phình vì thêm Application | Không truncate evidence/assumptions âm thầm |
| Reuse core execution/model/native và extension hợp lệ | Không xây lại backend/harness hoặc cài trùng tool | Capability/quyền/scope phải được kiểm tra tại đúng execution route |
| Một môi trường Python khi tương thích | Giảm dung lượng và provisioning | Lock/interpreter binding và isolation giữ nguyên |
| Entry skills mỏng, shared config services | Giảm drift giữa backend và domain | Người dùng vẫn tùy chỉnh đầy đủ qua orchestrator và inspect |
| Không gọi advisor mặc định khi attach/status/task đơn giản | Không tăng LLM overhead chỉ do refactor | Khi có planning/replanning thực chất, advisor vẫn verify/research độc lập |
| Tests tại boundary + workflow gộp | Bao phủ invariant với ít lượt chạy | Không bỏ negative tests hoặc full integration check cần thiết |

Không cam kết “đa domain rẻ hơn native backend” hoặc “giảm X% token” khi chưa đo. Mục tiêu kiểm chứng được của refactor là không tăng prompt/call tự động cho Research và không tạo overhead ngoài công việc domain đang thực hiện.

## 10. Rollout, rollback và điều kiện dừng

1. Giữ baseline Git đã backup. Triển khai theo commit nhỏ F0–F3/A1–A3, tránh trộn environment rebind với semantic refactor trong một diff khó review.
2. Gate F trên project tổng hợp trước; chỉ đề xuất dùng với project Research thật khi người dùng muốn. Không thay GUI files/config project đang hoạt động tự động.
3. Với project thật: kiểm tra idle, active/unknown jobs, pending publication, config/source/resource hashes và connection manifest trước mọi upgrade/update. Reconcile qua workflow hiện có trước khi đổi binding.
4. Research không migrate: có thể quay về baseline binary khi config/resources/state vẫn trong contract cũ. Nếu đã thay project resources/config thì rollback phải dùng revision/bundle tương thích, không chỉ đổi source rồi hy vọng checkpoint chạy.
5. Application v6 không downgrade để chạy binary cũ. Rollback dùng bản binary Application tương thích hoặc backup đã kiểm tra trong workspace riêng; không copy đè DB đang chạy/WAL. Không biến App state thành Research.
6. Tạm dừng activation nếu schema/contract chưa rõ, old-writer probe còn ghi được, pin/hash drift không giải thích được, tests môi trường chưa phân định hoặc publication/GUI legacy bị regression.

## 11. Những điểm thay đổi so với draft

| Draft | Plan thay thế |
|---|---|
| Tách generic records engine ngay M0 | Research façade trước; extraction chỉ sau hai implementation chứng minh reuse |
| Chỉ giữ config hash và state v4/v5 | Bổ sung task/bundle/checkpoint/GUI/lock compatibility; Research4/5 giữ, Application6 mới |
| Domain validation chủ yếu ở schema/config | Kiểm tra mọi entry path và SQLite writer boundary, domain bất biến |
| Thêm entrypoint/namespace là đủ generic helper | Có dispatcher route, lock/interpreter, scope và receipt/publication binding; fallback legacy có giới hạn |
| Thêm domain vào mọi connection manifest | Reader v1 Research tương thích, reconnect không rewrite; v2 cho binding mới, update explicit |
| Application contracts làm sau nhưng platform nhận Application sớm | Known-unavailable đến Gate A; contract đi trước activation |
| Tests là giai đoạn cuối, giả định baseline green | Isolation tests theo slice; ghi nhận Python drift hiện tại; full checks tại gate |
| Xóa hết tên Research khỏi core như mục tiêu | Chỉ route điểm có semantics domain; giữ tên/format legacy có giá trị compatibility |

**Điều kiện hoàn thành toàn bộ plan:** Research tương thích trong phạm vi đã công bố; Application có hợp đồng và workflow phần mềm thực thi được; các entry points/domain boundaries nhất quán; Gate A có evidence. Chất lượng nghiên cứu/sản phẩm và host GUI live không được tuyên bố đã chứng minh từ regression tests.
