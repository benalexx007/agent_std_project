# Plan chi tiết: tích hợp capabilities Research bên ngoài

**Điều chỉnh hướng tích hợp 29/10/2026, bản 2:** [GUI integration plan](plugin-integration-plan.md) bổ sung native reuse, profile controller/worker và [terminal inspect](project-inspect-plan.md); plugin tùy chọn. Có [research xác minh](gui-integration-validation.md); guard EX hiện hành chưa được thay. Helpers/receipts tiếp tục là baseline, không cài thêm server/package từ kế hoạch này.

**Implementation 28/10/2026:** phần software EX0–EX5 đã có trong source 0.6.0/state-handoff4; [phạm vi và evidence](extensions.md). Nội dung bên dưới giữ quyết định kế hoạch ngày 27/10; native/human acceptance và các benchmark chưa được thực hiện. Không tự migrate database đang có.

Ngày: **27/10/2026**. Trạng thái: **đề xuất để review, chưa implementation/provision/activation**. Baseline đang có: source **0.5.0 / state và handoff v3**. Tài liệu này cụ thể hóa E01–E03 trong [khảo sát](external-mcp-skills-research.md); khi lựa chọn helper khác khảo sát ban đầu, quyết định ở đây là mới hơn. [Catalog](external-capability-catalog.md) chỉ phục vụ discovery. Scope E04–E06 tiếp tục theo dự án.

## 1. Kết quả cần bàn giao

Một worker Research dùng được các năng lực dưới đây qua profile tường minh, có evidence và giới hạn đúng scope. Codex là backend nghiệm thu đầu tiên; contracts, helper CLI và artifacts portable. Không coi Claude/Antigravity đã được nghiệm thu chỉ vì cùng chạy một script.

| Năng lực | Tích hợp lần này | Không bắt buộc trong lần này |
|---|---|---|
| Scholarly retrieval | arXiv, OpenAlex, Crossref: search/resolve có giới hạn; version/coverage; lấy full text được phép; giữ raw source | 18 databases, citation graph toàn cục, crawler/vector DB/service nền |
| Bibliography | DOI metadata/BibTeX, kiểm identity và lỗi parse; dedup có evidence, giữ citation keys/mapping và raw input | Google Scholar scraping, Zotero nếu chưa có library, áp venue/reference-count heuristics |
| Mathematical checks | SymPy; exact arithmetic, assumptions, singularities, lưu derivation/check artifacts | Lean/mathlib, Wolfram và các solver/toolchain khác nếu chưa có bài toán cần |
| Empirical analysis | NumPy/SciPy, Matplotlib; code/config/data/seed và outputs có thể tái tạo; guidance phù hợp AI/ML | GPU/training stack, Bayesian stack, notebook server, W&B/MLflow mặc định |
| Đọc paper/PDF | Reuse native PDF/HTML/browser/tools trên đúng worker; đọc text và render trang khi cần kiểm toán/bảng | Reinstall cả document ecosystem, Docling/OCR corpus pipeline trước khi có bottleneck |
| Skills | Bổ sung references có chọn lọc vào literature/design/experiment/evaluate/write; load theo task | Bootstrap điều phối mới, review loop thứ hai hoặc toàn scientific skill library |

M02/Azure/.NET và các stack/domain hẹp không thuộc scope này. Không có external MCP server mới nào là dependency bắt buộc cho baseline đã chọn. Native MCP discovery/policy vẫn cần kiểm để không vô tình thừa hưởng servers ngoài profile; integration MCP thật được thêm khi có capability cụ thể cần nó.

Đầu ra nghiệm thu là **báo cáo hệ thống + evidence đúng profile**. Không yêu cầu tạo tri thức mới hoặc viết một paper để chứng minh integration. Dự án nghiên cứu dùng hệ thống vẫn có thể tạo paper/proof.

## 2. Xác minh độc lập và các thay đổi so với đề xuất trước

| Quan sát đã kiểm | Hệ quả thiết kế |
|---|---|
| Metadata local: Codex 0.164.0-alpha.11.1, Claude 2.1.310, AGY 1.4.7; đây là bản đang cài, không khẳng định là bản phát hành mới nhất toàn cầu | Refresh version/schema trên bản thực sự chọn khi implementation. Nếu nâng backend thì repin và kiểm lại phần phụ thuộc; không nâng ngầm giữa run |
| Codex driver tắt apps/plugins; coordinator không có shell. Package installed không chứng minh callable | Kiểm effective worker profile trước turn; thao tác helper thuộc worker đủ quyền. Không bật toàn bộ plugins hoặc mở shell coordinator để chữa thiếu binding |
| Tài liệu [App Server](https://learn.chatgpt.com/docs/app-server) có extra skill roots; saved SkillsListParams của pin local chỉ có cwds/forceReload, không có perCwdExtraUserRoots. Pin có SkillsExtraRootsSetParams và selectedCapabilityRoots | Dùng schema của pin; thử process-scoped extraRoots/selected roots khi semantics đã kiểm. Không gửi field theo latest docs rồi giả định hiệu lực |
| [store.mjs](../src/store.mjs) writer guard chỉ phân biệt v3 với code cũ hơn; một writer v3 cũ vẫn có thể bỏ qua policy extension mới | Khi mở extension execution, dự kiến chuyển **state/handoff v4**, nâng writer fence. Không chỉ thêm fields vào v3 rồi tuyên bố fail-closed |
| [format_bibtex.py](https://raw.githubusercontent.com/K-Dense-AI/scientific-agent-skills/main/skills/citation-management/scripts/format_bibtex.py) dedup theo key sau DOI; hai tài liệu khác DOI nhưng trùng key có thể bị bỏ một bản | Không nhập nguyên formatter/dedup. Chọn thư viện parser được duy trì và policy identity nhỏ của harness; collision phải hiện rõ |
| [BibtexParser](https://bibtexparser.readthedocs.io/en/main/) và [PyPI](https://pypi.org/project/bibtexparser/) hiện công bố 2.1.0 ổn định, MIT; parsing có thể giữ failed blocks | 2.1.0 là candidate để pin, không là lock đã cài. Failed block là lỗi/partial cần xử lý, không coi parse không throw là valid. Không dùng upstream parser tự viết thứ hai |
| [paper-lookup](https://raw.githubusercontent.com/K-Dense-AI/scientific-agent-skills/main/skills/paper-lookup/SKILL.md) có helpers stdlib; đã đọc arxiv_atom.py, paginate.py, _common.py. Bộ này chưa cung cấp trọn contract raw artifacts/rate/budget của harness | Lấy đúng parser/pagination phần cần; bổ sung transport/receipt còn thiếu có diff và fixtures. Không nhập mọi API hoặc xem public script là production-ready |
| AGY science 1.3.1 đã có arXiv/OpenAlex; kèm uv/polite-http, credential/home setup và biomedical components | Tái dùng cho AGY nếu scope/lock đạt; không làm thư mục cá nhân AGY thành dependency ngầm của Codex, không bật toàn bộ science |
| PDF skill local có authoring hook container_tools/mark_artifact_operation_started.mjs; phần đọc không cần hook đó | Baseline bind read/extract/render. Authoring phải kiểm đủ host tooling riêng, không copy cả skill sang worker rồi giả định marker tồn tại |
| Python desktop 3.12.14 có venv/pip/ensurepip; PATH python là WindowsApps alias và không tìm thấy uv qua Get-Command | Dùng executable đã xác minh; baseline provisioning dùng venv + pip, không buộc cài thêm uv. Đây không phải inventory mọi Python trên máy |

Đây là source/documentation review và metadata checks, không phải live capability acceptance. Các remote main/latest links chưa là package lock. Không chạy inference, server integration hoặc benchmark trong bước lập plan này.

## 3. Ranh giới kiến trúc

Luồng chính: **task/role chọn profile → core resolve và admission → backend tạo worker với effective capability scope → tool/helper thực thi → raw artifacts + receipt → publication hiện có → researcher/evaluator kết luận theo evidence**.

- **Backend:** model/tool loop, native skill loading, shell/browser/PDF và MCP client nếu profile đã xác minh. Core không mô phỏng các chức năng này bằng một runtime ngoài khác.
- **Core:** ownership/revision, binding/lock, dispatch limits, job identity, immutable receipts, provenance/publication, scientific state. Không có LLM router mới chỉ để chọn package.
- **Helpers/libraries:** retrieval/parser/bibliography và phép tính hữu hạn. Không tự phân công agent, đổi model, xin quyền mới, cài dependency hoặc sửa control DB.
- **Một scientific workflow:** sáu skills hiện có và research records tiếp tục là nguồn quy tắc; imported guidance chỉ bổ sung phần thiếu.

Mapping cập nhật 31/10/2026: cố vấn planning=gpt-6-astra/high; orchestrator/analysis=gpt-6.1-sol/high; automation mặc định Antigravity gemini-3.8-flash-high/high. Script deterministic chạy trực tiếp. Role và extension profile không thay model tier; profile scoped hiện có không tự cấp quyền cho Antigravity. Cố vấn vẫn tự mở nguồn chính và kiểm lại rồi trả plan cho orchestrator; cache của analyst không thay planning review mới. Xem [model routing](model-routing.md) cho explicit/frozen selections và tier còn thiếu.

Cross-backend delegation vẫn dùng core task/attempt/work-unit contract. Một task nhỏ có thể do một worker xử lý, không bắt tạo researcher/implementer/evaluator riêng chỉ vì thêm capability.

## 4. Contract/config tối thiểu

Các tên sau là **thiết kế mới**, chưa là config/CLI chạy được ở 0.5.0. Tách extension khỏi task.capabilities hiện đang biểu thị khả năng transport/backend.

### 4.1. Các tài liệu có ownership rõ

| Tài liệu/record dự kiến | Nội dung | Owner |
|---|---|---|
| extensions/manifest.json | capability IDs; package subtree/license; operations; dependencies; input/output contracts; eligible routes | Maintainer/operator review |
| extensions/lock.json | exact commit/release/digests của selected files và transitive assets; interpreter/tool versions; dependency lock hashes | Provisioning; không model tự update |
| config.extensions | manifest/lock refs và profiles theo backend/role; allowed operations; resource limits | Project config đã được duyệt |
| task.extension_profile | Chọn một profile đã được role cho phép; mặc định none nếu task không cần | Orchestrator trong policy |
| attempt.extension_binding | Snapshot profile/config/lock/backend identity, effective scope, environment và disclosure mode | Core trước dispatch |
| attempt extension-call records | call ID, ownership, status, budget reservation, process/job ref, receipt refs | Core; lưu cùng SQLite hiện có |
| receipt artifacts | Raw/source/result hashes, request/coverage, command/environment, observation level | Trusted runner hoặc backend observer; worker attestation phân biệt rõ |

Profiles đề nghị: literature (retrieval/bibliography/paper-read), analysis (math/stats/figures), research (hợp cần thiết của hai nhóm), none. Role có danh sách profiles được chọn; task có thể thu hẹp operation/limits, không tăng quyền bằng prompt. Egress/credential access là permission riêng, không suy từ role researcher.

Ví dụ shape để review, chưa phải schema executable:

```json
{
  "extensions": {
    "manifest": "extensions/manifest.json",
    "lock": "extensions/lock.json",
    "profiles": {
      "literature": {
        "capabilities": ["scholarly.retrieve", "bibliography.validate", "paper.read"],
        "backend_bindings": {"codex": "codex-research-local"},
        "limits": {"http_calls": 12, "max_records": 50, "max_papers": 2}
      }
    }
  }
}
```

Con số trên là default đề nghị cho **một task hữu hạn**, không là quota account hoặc trần cho mọi nghiên cứu. Survey lớn tách thành units với continuation/coverage, hoặc dùng profile được duyệt rộng hơn; không cắt kết quả rồi gọi exhaustive. API calls không quy đổi thành LLM tokens.

Schema dùng subset hiện được [schema.mjs](../src/schema.mjs) hỗ trợ, own-property checks và additionalProperties=false. Không mở arbitrary YAML importer/parser chỉ để nhập metadata; normalize selected upstream metadata lúc review, giữ nguồn và adaptation diff.

### 4.2. Identity, evidence và freshness

Receipt gồm: task/revision/unit/attempt/owner epoch; extension/operation/call ID; lock/profile/input hashes; source URL/DOI/arXiv version; query/filters/pages/continuation/coverage; retrieved_at và inspected_at; parser/environment identity; raw/output artifact refs; usage known/estimated/unknown và warnings.

Phân biệt backend-observed command/tool event, trusted-helper output và worker-authored declaration. Hash xác nhận bytes được ghi nhận; không chứng minh bản tóm tắt đúng hoặc một tuyên bố tool execution là thật. Raw có thể lưu một lần trong blob store và được nhiều receipts tham chiếu; evidence đã publish không bị cache eviction xóa mất.

Re-open cached primary bytes có thể là một kiểm tra mới nếu nguồn/version phù hợp; câu hỏi cần tình trạng mới nhất phải refresh. Lưu dấu lần planner thực sự inspect và điều đã kiểm, không đổi retrieved_at để giả nguồn mới. Helper không được tự sinh kết luận novelty/supported/verified_proof.

## 5. Chọn package và route cụ thể

### 5.1. Retrieval/bibliography

1. **paper-lookup subset:** arxiv_atom.py, openalex_abstract.py, phần pagination OpenAlex/Crossref và dependency _common cần thiết, references endpoint tương ứng. Đóng dependency closure trước vendoring. Không nhập JATS/biomedical branches nếu không dùng; giữ license/attribution và patch list.
2. **Transport:** một đường fetch được review cho các helpers đã chọn, lưu raw bytes trước parse, có deadline/byte/page/call bounds và request accounting. Tái dùng logic upstream phù hợp; chỉ sửa phần thiếu. Không duy trì hai pagination/fetch implementations cho cùng operation. ArXiv download PDF/HTML nguồn có byte/mime/version checks; LaTeX source extraction là operation riêng nếu được chọn, có path/size limits và không execute TeX tải về.
3. **Bibliography:** ưu tiên BibtexParser 2.1.0 để parse/serialize; DOI content negotiation và Crossref lookup qua transport trên. citation-management là nguồn rubric, không nhập _common/format_bibtex/validate_citations như một parser/validator song song. Requests chưa là dependency bắt buộc nếu transport hiện chọn dùng stdlib.
4. **Dedup:** DOI chuẩn hóa kèm bibliographic identity và version relations. Trùng key nhưng khác tài liệu phải giữ cả hai và báo collision; không tự rekey nếu chưa cập nhật references trong manuscript. Không gộp preprint với published version mà mất version/record gốc. Không ghi đè .bib input; xuất file mới và mapping/diff. Macro/string/preamble/crossref/failed blocks phải được bảo toàn hoặc báo unsupported/partial trước rewrite.
5. **Coverage:** metadata-only, full-text, incomplete-page, API error, access-restricted là trạng thái riêng. HTTP 200 không tự là thành công. OpenAlex no-key không đủ cursor paging sâu theo [authentication hiện hành](https://help.openalex.org/api/authentication/); thiếu key phải báo giới hạn, không gọi kết quả exhaustive.
6. **Read-only services:** không tạo tài khoản/key, mua credits, upload hoặc crawl nền tự động. Network/auth nằm trong scope được cấp. DOI redirects phải giới hạn hop/host hợp lệ và không chuyển credential sang origin khác. API rules lấy từ nguồn chính [arXiv](https://info.arxiv.org/help/api/tou.html), [Crossref](https://www.crossref.org/documentation/retrieve-metadata/rest-api/), OpenAlex; không dùng giá/limits trong skill làm truth cố định.

Default mỗi provider có một retrieval job đang chạy trong project, với spacing/rate policy phù hợp và bounded internal retry. Core reserve tổng call envelope trước spawn; helper có counters/continuation và không vượt envelope. Không thêm daemon rate limiter. Sau khi quan sát process đã thoát, thiếu số request thực có thể hạch toán bảo thủ toàn envelope và ghi unknown usage; không tuyên bố 0 cost. Process chưa xác minh đã dừng vẫn giữ unknown theo core. Đây không bảo đảm giới hạn của các client ngoài harness cùng dùng account/IP.

### 5.2. Scientific toolchain

Environment đề nghị dùng Python **3.12.x đã kiểm**; candidate local 3.12.14. Resolve các stable versions tương thích Windows wheels cho SymPy/NumPy/SciPy/Matplotlib và BibtexParser, khóa toàn bộ dependencies/hashes tại implementation. Tài liệu đang khảo sát hiển thị SymPy 1.14.0, SciPy 1.18.0, Matplotlib 3.11.2; các số này là nguồn guidance, chưa là chứng nhận bộ wheel tương thích đã cài.

- Reuse interpreter/package environment có sẵn chỉ khi exact pin, integrity và worker access đạt. Venv riêng tránh sửa desktop/global environment và tránh một plugin update làm đổi nghiên cứu đang chạy.
- Dùng venv + pip hiện có; lock tất cả wheels với hashes và [hash-checking/binary-only](https://pip.pypa.io/en/stable/topics/secure-installs/). Không `pip install` trong agent task; provisioning là bước riêng. Nếu cần build-from-source thì mở scope rõ thay vì tự biên dịch toolchain.
- Không thêm uv chỉ để chạy bốn thư viện. Nếu dự án đã dùng uv, reuse locked environment được kiểm; nhớ [uv run mặc định có thể lock/sync](https://docs.astral.sh/uv/concepts/projects/sync/). Worker chạy interpreter đã provision trực tiếp, không resolver tự cập nhật.
- Code nghiên cứu do agent viết chạy bằng native shell/execution trong sandbox đã chọn. Không đưa arbitrary Python source/command vào một callback của controller rồi chạy ngoài sandbox.
- Controlled helper callback chỉ chạy entrypoints cố định đã review; script tự viết theo dự án cần hash/input/output/run manifest và permissions của task. Observed execution và worker-declared execution không bị nhập làm một.
- [SymPy assumptions](https://docs.sympy.org/latest/guides/assumptions.html): giữ domain/assumptions, unknown là unknown; numerical spot checks không thành proof.
- [SciPy bootstrap](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html): thiết kế paired/independent/cluster trước chọn resampling; ghi seed, method, n, uncertainty và degeneracy. Không tạo API “auto chọn test khoa học” chỉ từ loại cột.
- [Matplotlib](https://matplotlib.org/stable/users/explain/figure/backends.html): Agg/headless cho batch, output PNG/SVG/PDF cùng data/code/config. Không cần notebook/GUI/LaTeX daemon; không yêu cầu pixel hash giống mọi OS để kết luận tái lập số liệu.

### 5.3. Skills và native reuse

Core giữ các quy tắc research bắt buộc ngắn. Bổ sung references cho literature retrieval/citation, symbolic checks, empirical analysis và figures; trigger theo task/reasoning mode. Một reference được sở hữu bởi một đường load: native loader hoặc harness_read/paged resource đã có, không nhúng full body lần nữa vào cả context và developer prompt.

Tận dụng [native progressive disclosure](https://learn.chatgpt.com/docs/build-skills) nếu exact pin kiểm được scope. Nếu chưa kiểm được native loading thì dùng resource path đã lock và harness_read hiện có; không tuyên bố native support. Không ép native loader bằng cách sửa global skills/config. Bản dịch/adaptation riêng giữ upstream refs/license, không chỉnh personal plugin cache.

PDF đọc/render ưu tiên component đang có. Nếu dependency chỉ có ở desktop host thì bind đường worker dùng được hoặc chọn local equivalent đã kiểm; trạng thái chưa có route là pending. Authoring spreadsheet/slides/form PDF không là yêu cầu của baseline paper-reading. Parser nâng cao chỉ thêm khi nguồn thật cho thấy mất thông tin quan trọng.

## 6. Native policy, runner và lifecycle

**Codex first:** trước tạo worker, resolve config/lock/environment và task scope; sau khi backend trả effective state nhưng trước turn/start, kiểm selected skills/plugins/hooks/MCP tools, sandbox/model/effort và roots. Config intent, installed inventory và effective receipt là ba records khác nhau.

Saved protocol chỉ là bằng chứng fields tồn tại. EX0 bên dưới phải xác minh process-scoped extraRoots và per-thread config không ghi settings cá nhân; skills/config/write là mutation, không dùng làm inventory. Extra roots chỉ thêm discovery, không tự là allowlist. MCP status cần lấy đủ pagination và dùng threadId khi có; không suy “plugins=false” đã tắt custom MCP.

Nếu không đóng/quan sát được ambient extras, dừng profile hoặc dùng cách scope riêng được backend hỗ trợ và đã kiểm; không copy auth store, sửa global config hoặc bỏ kiểm tra cho qua. System/bundled skills không thể tắt phải được ghi rõ và đánh giá quyền/footprint. Scope browser/PDF app chỉ bật khi observable/callable; không mở toàn marketplace.

Helper execution đề nghị thêm một operation dispatcher nhỏ dùng schema per operation, không shell-string/eval/arbitrary executable. Cho Codex expose dynamic tool theo profile; coordinator chỉ dùng các tools điều phối hiện có để giao task. Parent attempt/owner do runtime gắn, không tin ID do model tự truyền. CLI/operator entrypoint dùng cùng resolver/handler khi phù hợp; không cho worker ghi control DB hoặc gọi self-approval.

Call lifecycle: **admit/reserve + persist intent → final fence check → spawn/call → bounded observe → pin raw/result → settled receipt**. Reuse job_refs, runner log bounds và publication. Nếu cần tách code process supervision dùng chung thì thay cả caller cũ, không để hai lifecycle engines. Trong transaction chỉ ghi state/intent/fence, không await network/process.

Duplicate call ID cùng payload trả receipt hiện có; khác payload bị reject. Không hứa exactly-once qua network. Mất reply thì observe/collect, chỉ retry read-only request theo policy và remaining envelope; không retry unknown process. Cancel/timeout theo core, không release jobs/reservation vì ACK. Late results lưu audit, không publish cho assignment mới.

Payload lớn ở files/blobs, tool reply chỉ summary + refs + pagination. Không ghi credential values vào argv/log/raw URLs; redaction giữ endpoint/query không nhạy cảm đủ tái lập. Limits của helper route không được mô tả thành hard egress/token cap cho arbitrary native shell: yêu cầu hard isolation phải được sandbox/backend thực thi, nếu thiếu thì profile đó unsupported.

## 7. Storage, activation và rollback

Đề nghị candidate tiếp theo **0.6.0 / state và handoff v4** khi extension execution được đưa vào core. Quyết định này cần vì policy/call reservations mới là execution semantics; v3 writer không hiểu chúng. Không migration trong giai đoạn viết plan.

Migration có backup, không active/unknown attempts và không pending publication. Transaction cập nhật state + guard tương thích writer4; writer3 phải bị chặn kể cả khi biết đường DB. Audit mọi assert/version/import/export/handoff và các tests v3 hiện có, không chỉ thay một con số. Handoff v3 import qua migration; v4 không import vào writer cũ.

Extension bundle có revision riêng, activation qua sync-config đã có điều kiện idle, pin manifest/lock/digests vào config_hash và attempt snapshot. Không để lock file đổi tại cùng path mà config_hash vẫn hợp lệ. Chuyển profile/lock làm mất hiệu lực dispatch/benchmark approval và session compatibility liên quan; historical outputs vẫn giữ provenance của revision cũ.

Provision theo staging → kiểm integrity/license/dependency closure → atomic rename/activate. Failure không để nửa package active; retry idempotent. Assets immutable/readable trong execution root hoặc approved read-only dependency root; không copy venv vào mọi workspace. Không dùng symlink/junction để lách workspace confinement. Interpreter path tuyệt đối + environment hash chỉ là binding local; lock/artifact contract vẫn portable.

Rollback extension trả activation về revision trước khi không còn job liên quan, giữ receipts và artifacts. Rollback code về 0.5.0 không được mở state v4 để ghi; phải restore backup vào workspace riêng hoặc dùng reader tương thích. Không xóa evidence/job unknown để rollback nhanh.

## 8. Các bước implementation và điều kiện hoàn tất

| Bước | Công việc/output | Phần code dự kiến | Phụ thuộc / done |
|---|---|---|---|
| EX0 — Chốt routes/pins | Dependency inventory; exact upstream subtrees/license; backend schema diff; profile scope feasibility; Windows paths; lựa chọn controlled/native route | Chưa đổi semantics; inventory/probe utilities tối thiểu, docs evidence | Chốt được baseline executable route; mọi gap đánh dấu pending. Không gọi model, không tự init remote servers trong inventory |
| EX1 — Contract và writer compatibility | Manifest/lock/profile/call/receipt schemas; task/role selection; v4 migration/guard; config hash có lock digest; disabled mặc định | schemas, config/store/index/workspaces, harness CLI; extensions.mjs mới cho resolve/validate | EX0; fixtures migration/old writer/rollback và config admission pass |
| EX2 — Provision/environment/assets | Selected helper assets, license/patch manifest; Python env lock; staging/idempotency; native component binding; read roots | scripts/provision-extensions.mjs mới hoặc CLI mỏng; workspace/bundle resolution; extensions data | EX1; không thay global; hashes/import probes đúng; second provision không sửa environment |
| EX3 — Controlled execution/receipts | Shared admission/lifecycle; finite helper dispatcher; raw files/receipt ledger; native effective policy và scoped loader/resources | extension-runner.mjs mới; native-tools/codex-native/codex-worker/runner/resources/receipts/publication/context | EX1–EX2; process/control/budget/policy fixtures pass; unsupported scope không được chạy |
| EX4 — Research capability slice | arXiv/OpenAlex/Crossref; BibtexParser policy; math/stats/figure toolchain; references chọn lọc và example project | Selected helpers; extensions/research; six existing skills/references; examples | EX2–EX3; deterministic oracles và raw-to-output provenance pass; không tạo second workflow |
| EX5 — Acceptance/documentation | One final required software batch; P0 đúng pin/profile; capability evidence; hướng dẫn activation/rollback; báo cáo integration | test/check-project/verify/report/README/runtime docs và evidence | EX1–EX4; scope implemented/fixture-verified/native-verified/accepted tách biệt. Live chỉ sau scope authorization riêng |
| EX6 — Backend kế tiếp (conditional) | Map portable profile sang Claude hoặc AGY; ưu tiên AGY science đã installed; MCP facade chỉ nếu cần để giảm net adapter code | Backend renderer/bridge phù hợp, cùng handlers/receipts | Có task thực cần backend đó và model mapping được cấu hình; không tự chạy matrix cả ba hãng |

Tên file mới là ranh giới trách nhiệm đề nghị, không target phải đạt số module/dòng code. Reuse module hiện có nếu không làm nó thành monolith. Không cần generic package manager, universal gateway, second database, scheduler, GUI hoặc persistent scientific kernel cho scope này.

## 9. Nghiệm thu tối thiểu có oracle

Một batch fixtures có thể cover nhiều hàng; mỗi assertion quan trọng phải được chạy và báo riêng, không fail một happy path rồi coi mọi gate covered. Software checks không gọi model hoặc các API thật; dùng saved responses và fake native protocol ở test boundary. Không bắt chạy upstream test suites đầy đủ.

| Gate | Input/edge case tối thiểu | Oracle / đạt khi |
|---|---|---|
| X1 Policy/lock | Unknown capability; role không được chọn profile; task tăng budget; package bị sửa; inherited MCP/hook extra; actual pin thiếu field | Reject trước tool execution; không cấp quyền từ prompt; unsupported explicit; load một body đúng một lần |
| X2 Provision/migration | File lỗi giữa staging; reprovision; writer3 ghi state4; active/unknown/pending publication khi migrate; v4 handoff vào old writer | Không partial activation; idempotent; writer cũ bị fence; backup/restore đúng; historical evidence giữ nguyên |
| X3 Retrieval | arXiv normal/error-feed HTTP200/version; OpenAlex metadata-only/pagination/key missing; 429; oversized body; bounded retry; credential-bearing redirect | Raw bytes/identity/coverage đúng; partial không thành empty/exhaustive; call/byte/time caps; secrets không vào logs |
| X4 Bibliography | Two different DOIs same key; same DOI có metadata conflict; preprint/published relation; braces/Unicode/macros/crossref; failed parse block | Không mất record/citation; không sửa input; collision/mapping/partial hiện rõ; valid DOI không tự chứng minh cited claim |
| X5 Math/statistics | sqrt(x^2) với real x và x=-2; paired differences [1,1,2,2]; zero-variance/NaN case | Abs(x) và 2 phù hợp assumptions; mean=1.5, sample variance=1/3; nếu kiểm exact sign-flip two-sided thì p=2/16; invalid uncertainty phải báo. Đây là software oracle, không claim khoa học |
| X6 Figures/paper read | Figure từ data pin; PDF fixture có text + phương trình/bảng trên trang định danh; extraction mất thông tin | Data/labels/locators/source hash khớp; file mở được; dùng render khi extraction không đủ. Không đòi byte-identical PDF mọi OS hoặc silent text-only downgrade |
| X7 Lifecycle/publication | Duplicate call; lost reply; process còn sống sau timeout; cancel; stale owner; output ngoài root; crash trước/sau publication | Không duplicate side effect mù; unknown giữ fence; raw/receipt không orphan active; late output không accepted; recover publication hiện có |
| X8 Accounting/context | Hai tasks share provider; counters thiếu; raw lớn; cache hit và source refresh | Envelope không cộng/release sai; missing usage không là 0; raw ngoài prompt; cached evidence không giả retrieved_at; script không tạo LLM call |

**P0:** xác minh exact versions/config/schema, Python/wheels/imports, roots/skills dependencies, effective-policy mechanism và required commands. Không tự khởi động remote server có auth/billing/side effects chỉ để inventory. Nếu thread-effective receipt chỉ có sau thread/start, kiểm nó trước turn trong lần chạy đã được phép; P0 static không được tự nhận native pass.

**Live tối thiểu:** ưu tiên lấy trace từ công việc Research thật được người dùng cho phép, cho đúng operations/profile đã dùng. Một trace chỉ chứng minh phần nó thực sự cover. Không chạy task giả bổ sung chỉ để đủ số backend hoặc model. Nếu chưa có việc thật và cần nghiệm thu agent-tool path ngay, chuẩn bị **một** protocol riêng cho một worker Codex, không tự chạy theo plan này.

Protocol live dự phòng cần đóng băng: một paper công khai có identifiers đã xác minh; metadata/full-text/citation; một phép symbolic + paired-analysis fixture và một figure; một output report với refs. Một worker analysis = gpt-6.1-sol/high, tối đa một attempt, không auto retry/fallback, không gọi thêm planner/evaluator LLM. Chọn tasks reasoning phù hợp; không tự chuyển xuống model thấp để đạt budget.

Budget proposal để chuẩn bị run: tối đa 10 phút, 8 HTTP requests kể cả redirects/retries, 1 full-text download tối đa 25 MiB, tool replies có preview tối đa 8 KiB/call. Admission input estimate tối đa 8k tokens, output+reasoning reserve 4k; đây là **estimate/envelope để review**, không hard native token cap hoặc dự báo quota%. Nếu packet/tool loop không vừa thì thu scope hoặc xin một protocol khác, không tăng ngầm. Trước xin chạy phải tính lại estimate theo packet thực, quota mới, account/pool, credit/cost coverage; không ghi unknown cost=0.

Chỉ bắt buộc kết quả contract: tool/skill đúng binding, receipt/raw artifacts, scope/control/accounting, citation/math oracle và publication. Không benchmark novelty, chất lượng ý tưởng, agent-count tối ưu, mọi statistical method, cả ba backend hay “skill làm model thông minh hơn”. Những phần đó theo dõi qua sử dụng. L2 fault runs chỉ nếu scope thật có semantics chưa được fixtures/trace chứng minh; cần protocol và xác nhận riêng.

## 10. Tối ưu và điều kiện xem lại

| Tối ưu áp dụng ngay | Giới hạn cần giữ |
|---|---|
| Một approved binding chính/capability, chọn theo task; metadata catalog nhỏ; body/reference đọc khi cần | Không cấm thêm independent sources hoặc route mạnh hơn cho một câu hỏi khó |
| Không thêm server/daemon cho helper hữu hạn; startup on demand; reuse dependency env theo lock | Không chia sẻ writable execution state giữa attempts hoặc cho package update ảnh hưởng job đang chạy |
| Cache raw metadata/versioned documents và parser outputs theo hash/config; reuse blobs | Freshness và coverage explicit; cache không thay kiểm nguồn hiện tại của planner |
| Giữ raw ngoài context, compact typed output, bounded reads | Không cắt counterevidence/assumptions hoặc trả silent truncation |
| Parser/library được duy trì thay custom BibTeX parser; bỏ duplicate workflow | Kiểm contract/library lỗi vẫn hiện rõ; không áp default destructive cleanup |
| Một software batch cuối, P0 và evidence thật theo scope | Không miễn gates quan trọng vì muốn ít tests; không chạy benchmark khi chưa có per-run approval |

Theo dõi khi dùng: thời gian tới accepted result, số lần agent tự viết lại helper, lỗi selection/API/version, repeated retrieval, bytes/context, tool startup và actual usage, thao tác người dùng phải làm lại. Ghi từ receipts sẵn có; không thêm model để chấm mọi call hoặc telemetry daemon. Giữ capability nếu nó giải quyết vấn đề thật dù không phải route rẻ nhất; loại dependency chỉ khi route thay thế đạt contract và workload.

## 11. Trạng thái phê duyệt và definition of done

Plan hoàn tất khi có scope/decisions, source links, implementation order, migration/rollback, acceptance và các điều kiện chưa biết được ghi rõ. Các điều kiện EX0 còn cần chốt là exact package pins/wheels, native scope feasibility và selected component dependency closure; chúng là bước implementation/preflight có output cụ thể, không lý do nhập package mù.

Implementation hoàn tất khi code/fixtures/docs được bàn giao và baseline đã provision/kiểm đúng environment trong phạm vi được cho phép. Native activation/acceptance chỉ hoàn tất cho profiles có effective receipt và trace cần thiết. User review quyết định acceptance; không lấy 186 tests của source 0.5.0 làm evidence cho extension chưa viết.

Quyền lập plan không là quyền benchmark. Khi người dùng yêu cầu implementation, thực hiện EX0–EX5 trong scope đó, chỉ hỏi thêm cho quyền/auth/budget còn thiếu hoặc deliberate benchmark có protocol. Không hỏi lại cho từng tool call nằm trong policy đã được cấp.
