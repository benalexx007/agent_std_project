# Kế hoạch tích hợp backend và tối ưu hệ thống — bản 4

**Roadmap tiếp theo 29/10/2026, bản 2:** [GUI integration](plugin-integration-plan.md) điều chỉnh trách nhiệm native/core, tùy chỉnh qua hội thoại và tinh gọn; plugin là packaging tùy chọn. Có [terminal inspect](project-inspect-plan.md) và [xác minh nguồn](gui-integration-validation.md). Dùng [protocol GUI/inspect](plugin-acceptance-plan.md) để chọn coverage mới; evidence bên dưới vẫn trong phạm vi cũ. Hướng mới đang chờ review, chưa được triển khai.

**Implementation mới 28/10/2026:** source 0.6.0/state-handoff4 đã có [Research extensions EX0–EX5](extensions.md) và software evidence. Các mô tả 0.5.0/“đề xuất tiếp theo” dưới đây là baseline kế hoạch trước lát cắt này; native/human acceptance vẫn pending.

Ngày: **27/10/2026**. Trạng thái: **đã có lát cắt nền 0.5.0 để review**; xem [implementation và giới hạn](integration-foundation.md). Baseline source **0.4.0 / state v2**; 161 software tests và static checks đã pass ở lần verification trước. P0 Codex đã pass metadata/static với giới hạn; **L1/L2 chưa chạy, chưa được duyệt; H0 pending**. Baseline nêu trên là lịch sử trước implementation 0.5.0; evidence mới và phạm vi bàn giao ở integration-foundation.md.

Bản này thay [plan bản 3 lưu trữ](runtime-integration-plan-v3.md). Nguồn và đánh giá từng capability: [khảo sát tích hợp](capability-integration-research.md). Quy trình nghiệm thu chi tiết: [minimal protocol](acceptance-minimal-protocol.md). Giữ toàn bộ mục tiêu [research](research-domain-plan.md), [năng lực nghiên cứu](research-capability-plan.md), [V1 acceptance](v1-acceptance-plan.md).

Nghiên cứu bổ sung 27/10/2026: [MCP và external skills](external-mcp-skills-research.md) đối chiếu native/backend/core và inventory local, loại trùng và đề xuất E01–E06. [Catalog discovery riêng](external-capability-catalog.md) lưu 20 nhóm MCP/route và các nguồn skills để tham khảo, không là backlog. Đây là đề xuất mở rộng RT2/RT5/RT6, chưa cài package/server hoặc đổi runtime; không nhập cả ecosystem hoặc dựng gateway mặc định.

[Plan implementation extension chi tiết](external-integration-plan.md) chốt EX0–EX5 cho Codex trước, ranh giới reuse/custom code, dependency/receipt contracts và nghiệm thu X1–X8. Dự kiến candidate 0.6.0/state-handoff v4 để chặn writer v3 bỏ qua policy mới; đây là đề xuất migration tương lai, không thay trạng thái source 0.5.0 hiện tại. Exact pins/native scope được chốt ở EX0, không suy từ latest docs hoặc installed inventory.

Điều chỉnh sau xác minh: **E01–E03** là scope đề nghị tiếp theo, gồm binding/lock/effective policy và năng lực Research lặp lại: scholarly retrieval/citation, SymPy cùng NumPy/SciPy/Matplotlib, reference về thiết kế/phân tích thực nghiệm bổ sung vào sáu skills hiện có. Reuse native loader/MCP client, documents/PDF/browser và helpers đã installed khi đúng worker profile đáp ứng contract; installed không đồng nghĩa callable (driver Codex hiện tắt plugins/apps). Chỉ provision phần thiếu, load/start theo task; không bật mọi global plugins hoặc thêm workflow điều phối/review trùng. **E04–E06** theo dự án: M02/Azure/.NET, stack/domain hẹp, platform/stateful tools và facade khi có consumer. Baseline cần contract checks cho scope bật, không đòi benchmark package/model matrix; source 0.5.0 chưa triển khai extension này.

## 1. Mục tiêu và những điều không đánh đổi

Tối ưu tổng công việc để có kết quả được chấp nhận: token/quota/chi phí tiền, thời gian chờ và làm lại, CPU/RAM/disk/I/O, công vận hành và bảo trì. **Năng lực, tính đúng và khả năng kiểm chứng là ràng buộc; chi phí là mục tiêu tối ưu bên trong các ràng buộc đó.** Ít code hoặc ít token không tự chứng minh thiết kế tốt hơn.

Giữ các nguyên tắc đã chốt:

- Hai domain Research/Application; evaluation bắt buộc theo mục tiêu riêng. Research hỗ trợ xây tri thức mới, toán học, phản chứng, thực nghiệm và kiểm chứng, không thu hẹp thành tổng hợp tài liệu.
- Researcher/implementer/evaluator là vai trò; không buộc ba process/model cho mọi task. Một việc nhỏ được xử lý trực tiếp; việc có nhánh độc lập hoặc cần kiểm tra độc lập mới tách agent.
- Điều phối có thể đổi backend và giao worker khác backend. Role, skill, model tier, permissions, quota và workspace policy tách biệt. Native capability được dùng qua extensions có kiểu, không ép mọi hãng xuống giao diện yếu nhất.
- Mapping cập nhật 31/10/2026: **cố vấn synthesis_planning = GPT-6 Astra High; orchestrator/analysis = GPT-6.1 Sol High; automation mặc định = Antigravity Gemini 3.8 Flash High**. Cố vấn trả kế hoạch đã kiểm chứng cho orchestrator, không là root coordinator. Công việc deterministic dùng script. Explicit/frozen selections giữ nguyên; không âm thầm hạ model/effort, fallback backend hoặc đổi billing để tiết kiệm.
- Planning tự kiểm nguồn sơ cấp và research lại phần bất định trong attempt hiện tại. Giữ assumptions, counterevidence, proof obligations, negative results và provenance. Kết thúc process/đúng schema không chứng minh kết luận khoa học.
- Human input/control có revision, ownership và semantics rõ. ACK không bằng applied/terminal. Unknown job không bằng stopped; không retry mù và không giải phóng reservation sớm.
- Native-first là ưu tiên có thể thay đổi bằng bằng chứng. SDK/runtime ngoài được dùng nếu đáp ứng contract tốt hơn và giảm tổng chi phí. Không lấy zero-dependency làm tiêu chí loại trừ.
- Benchmark phải xin riêng kèm protocol. Không biến lần dùng thật thành benchmark ngầm hoặc tự tạo việc cho subagent chỉ để nghiệm thu.

Không hứa “tối ưu nhất” theo một con số chưa đo. Với mỗi thay đổi phải chỉ ra đường đơn giản nhất đã biết đáp ứng đầy đủ yêu cầu, phương án thay thế đã cân nhắc, và điều kiện xem lại.

## 2. Cách quyết định có tích hợp một feature hay không

Mỗi feature cần decision record ngắn trước implementation:

1. **Việc thực tế:** ai cần, task nào hưởng lợi, giới hạn hiện tại làm mất năng lực/chậm/làm lại ở đâu. Nếu chỉ là khả năng hay nhưng chưa có người dùng/đường sử dụng, giữ đề xuất.
2. **Điều bắt buộc:** chất lượng, quyền, model, provenance, independence, recovery và budget coverage. Route thiếu một điều bắt buộc không được chọn vì rẻ hơn.
3. **Lựa chọn:** native interface; SDK/module có sẵn; script nhỏ; runtime ngoài. So code có thể bỏ, bridge phải viết, dependency/service, auth và rollback.
4. **Giá trị dự kiến:** giải phóng capability bị chặn, giảm critical path/startup/rework/manual effort, hoặc sửa rủi ro đúng đã thấy. Phân biệt suy luận từ contract với số đã đo.
5. **Bằng chứng đủ:** source/schema và deterministic fixture cho cơ chế; trace sử dụng thật cho lợi ích chưa rõ. Chỉ đề xuất benchmark khi kết quả có khả năng thay quyết định.
6. **Exit:** điều kiện bật, giới hạn, khi tắt/chọn lại, ai sở hữu state; code cũ nào retire. Feature flag không xóa chi phí bảo trì nên không implement mọi feature rồi để tắt.

Chọn capability theo task, không bật toàn bộ mặc định. Nếu một nhiệm vụ cần năng lực của native group hoặc parallel writers thì chọn route đáp ứng; nếu chưa được kiểm chứng, báo gate còn thiếu và xác minh phạm vi đó. Không âm thầm chuyển sang route yếu hơn rồi tuyên bố tương đương.

## 3. Ranh giới trách nhiệm và kiến trúc đích

Luồng: **người dùng -> điều phối -> core policy/work graph -> native driver hoặc provider đã chọn -> backend worker/group -> evidence/publication -> review**.

| Thành phần | Sở hữu | Tránh xây trùng |
|---|---|---|
| Backend | Suy luận, tool loop, native context/compaction, hội thoại, subagents nội bộ, controls được công bố | Không viết lại agent loop hoặc tự mô phỏng mọi tool event bằng core |
| Agent điều phối | Hiểu yêu cầu, research/planning, chọn phân công, tổng hợp, tương tác người dùng | Không tự sửa ledger/quyền hoặc bỏ gate do muốn tiếp tục |
| Core tự viết | Task/revision/lease, model/policy, aggregate admission, scientific records, portable checkpoint, provenance, acceptance/publication, permission benchmark | Không quản lại từng bước suy nghĩ hoặc mỗi tool call của native group |
| Driver/renderer | Dịch contract, pin/probe, effective receipt, streaming/control, usage normalization, observe/collect/reconcile | Không có scheduler/retry/policy store thứ hai |
| Provider workspace/session hoặc runtime ngoài nếu được chọn | Một tập trách nhiệm cụ thể được ủy quyền, trả identity/evidence | Không cùng core tranh ownership của dispatch/retry/merge |
| Skills/scripts | Hướng dẫn nghiên cứu có cấu trúc; thao tác deterministic và interface cho điều phối | Không copy cùng invariant vào nhiều prompt, không làm daemon nếu command ngắn đủ |

Các chế độ delegation dự kiến: direct; core-managed workers khác backend; native group trong một backend; kết hợp hai tầng có giới hạn. Core giữ ownership cấp nhóm; backend điều phối bên trong nhóm. Evaluator cần độc lập không dùng chung history tác giả chỉ vì reuse tiết kiệm. Không tăng depth/count tự động ngoài scope và ngân sách.

## 4. Quyết định tích hợp capabilities

Mã và phân tích đầy đủ C01–C18 ở [ma trận nghiên cứu](capability-integration-research.md). Bảng này quyết định thứ tự:

| Tập | Quyết định | Lợi ích trực tiếp | Điều kiện |
|---|---|---|---|
| C01/C03/C16 | Làm nền workspace + publication + streaming cùng một lát cắt | Bảo vệ baseline, hỗ trợ artifact lớn, mở đường writers song song | Phân tách roots/identity; immutable staging và journal được kiểm crash/conflict |
| C07/C09/C11/C12/C13 | Làm nền recovery/accounting/quota trên Codex trước | Giữ kết quả đã làm, tiếp tục không đếm lại token hoặc để job mồ côi | Scope native IDs/usage/descendants rõ; capability thiếu thì unknown và không replay |
| C14/C15/C17 | Tinh gọn context/bundle/telemetry theo điểm nghẽn đã thấy | Giảm trùng prompt, whole-state work và peak I/O; giữ nghĩa vụ khoa học | Baseline/version/ACK; critical events durable; không full DB rewrite mặc định |
| C02 | Thêm bounded parallel writers sau nền | Chạy các nhánh code/experiment độc lập cùng lúc | Hai việc độc lập thật, execution roots riêng và đủ host/quota; publication tuần tự |
| C05/C06 | Thêm session reuse/resume/fork theo vấn đề liên tục | Giữ công việc/context có ích, giảm rebuild/handoff | Compatibility, usage delta và history admission; policy/evidence còn hiệu lực |
| C10 | Thêm native subagent groups theo task | Tận dụng orchestration/tools của backend, giảm custom dispatch bên trong nhóm | Group limits, accounting/stop coverage và output validation đủ |
| C04 | Warm process là tối ưu có điều kiện riêng | Giảm startup khi nhiều turn gần nhau | Trace cho thấy startup đáng kể; TTL/count/RAM; không giữ process chỉ để giảm token |
| C08 | Active reconnect chờ route đủ contract | Giữ control đối với turn đang sống qua gián đoạn client | Stable endpoint/identity/ownership và event recovery trên OS; chưa mặc định experimental socket |
| C18 | Mở backend tiếp theo khi có workflow cụ thể | Đa backend thực sự và fallback/khả năng native khác | Model/auth/billing đã chọn; implement một route chính/profile; offline contract trước activation |

“Có điều kiện” không loại capability khỏi kiến trúc. Contract phải cho phép tích hợp; implementation chỉ đến khi có benefit và dependency rõ. Không đợi hoàn tất tất cả 18 capability mới dùng hệ thống.

## 5. Các hợp đồng cần thiết kế trước khi code

Tên field dưới đây là **đề xuất**, chưa là config/schema sử dụng được.

### Workspace và publication

Tách ba định danh: control root giữ SQLite/evidence registry; execution root của attempt/group; publication namespace chứa artifact đã chấp nhận. Cập nhật đồng bộ runner, worker Store, dynamic tools, context, checkpoint, research refs và validators; chỉ đổi cwd không đủ.

Workspace provider trả workspace_id, baseline manifest, input hashes, execution root, mode, lease và cleanup ownership. Có ba mode: shared_serial hiện tại; snapshot_directory cho non-Git; git_worktree cho repo phù hợp. Native provider chỉ thay implementation nếu cung cấp cùng semantics.

- Không tự tạo Git repo. Worktree baseline phải đúng commit cộng dirty/untracked inputs theo manifest, không mặc định default branch.
- Dataset lớn dùng reference/materialization read-only có identity. Không hardlink file mà worker được sửa; tách mutable outputs và shared cache an toàn.
- Không đưa control DB, secrets hoặc file ngoài scope vào snapshot. Worktree không phải sandbox; permissions vẫn cần enforce độc lập.
- Writer riêng có filesystem/job quota và deadline. Host CPU/RAM/disk/GPU và quota pool cùng giới hạn concurrency; không tăng parallelism khi bottleneck là tài nguyên dùng chung.
- Sau terminal và kiểm jobs/output, stream vào immutable staging và tính hash trên đúng bytes được pin. Publish có intent/journal, base comparison và receipt.
- Publication được serialize; conflict trả về xử lý rõ, không last-writer-wins. Multi-file filesystem writes không atomic: gate readers bằng publication generation, phục hồi từ journal; output ngoài core cần manifest hoàn chỉnh.
- Crash recovery hoàn tất/rollback publication bằng script, không chạy lại agent để copy file. Cleanup chỉ xóa workspace đúng identity đã hết owner/job và không mất evidence cần giữ.

### Session, process và recovery

Tách process_id, session_id, attempt_id, turn_id, provider job_id. Một session không bằng một attempt; binding của attempt cũ giữ bất biến. Session registry riêng với generation/lease và một owner hoạt động; không dùng “session gần nhất”.

Compatibility key gồm backend/binary/protocol, auth/pool, model/effort, policy/tools, role/skill bundle, workspace baseline và research/task scope. Phần có thể thay giữa turn phải có native contract và receipt xác nhận; nếu không, fresh session hoặc explicit fork.

Reuse không làm mới bằng chứng tự động. Planner vẫn phải thực hiện checks mới. Thay inputs/revision/protocol/rights hoặc independent evaluator có thể buộc fresh. Compaction native không thay portable record/checkpoint; mandatory assumptions/proof obligations được rehydrate khi cần.

Thứ tự recovery:

1. **Observe/collect:** đọc IDs/history/output/usage, không inference. Không lấy một partial stream làm final result.
2. **Reconcile:** kiểm owner/generation, terminal status, descendants/remote jobs, artifact hashes và accounting. Giữ reservation khi chưa rõ.
3. **Reconnect active:** chỉ khi route thật sự kết nối lại turn đang chạy; không spawn server mới rồi coi thread/resume là reattach.
4. **Continue work:** sau khi cũ đã được đối soát, tạo attempt/turn mới với checkpoint và admission; cùng backend dùng native session nếu tương thích, khác backend dùng handoff portable.
5. **Unknown:** đóng admission scope liên quan, cho người dùng xem thiếu evidence; không relaunch mù.

Persist intent trước side effect. ID client không tự tạo exactly-once; phải biết native server có deduplicate gì. Một authority quyết định retry ở ranh giới core; native retry nội bộ phải nằm trong aggregate scope, quan sát được ở mức route cung cấp. Benchmark không tự chạy lại/tiếp tục ngoài protocol đã duyệt.

Warm process pool là lớp tùy chọn: không daemon bắt buộc, on-demand, bounded count/RAM/idle TTL, shutdown/owner transfer rõ. Có thể dùng warm process với fresh thread; có thể resume history trong process mới. Hai cơ chế không buộc nhau.

### Native groups, budgets và human control

Group contract gồm allowed roles/models/tools, depth/count/concurrency, workspace mode, aggregate deadline/reservation, usage coverage và descendant-stop scope. Không coi prompt “đừng vượt N” là hard enforcement; capability declaration phải phân biệt enforce được, quan sát được hay chỉ cooperative.

Core có thể kiểm group admission/receipt mà không lưu từng internal tool event. Job identity phải đủ tránh PID reuse; remote jobs cần provider handle. Parent completion/OS exit/interrupt ACK không tự chứng minh toàn nhóm stopped. Nếu route không đủ stop/accounting cho mức rủi ro của task, dùng core-managed workers phù hợp hoặc giữ group disabled.

Accounting event đề xuất: provider/session/turn/group, counter_epoch, scope, cumulative/delta, tokens/reasoning/cache khi có, cost và coverage/provenance. Với reused session, lấy baseline được xác nhận rồi charge delta; reset/out-of-order/duplicate xử lý explicit. Chỉ cộng các phạm vi không chồng nhau. Không tự suy child usage bằng phép trừ không có contract.

Admission gồm prompt mới + history/rehydration + output/tool rounds/compaction allowance + children nếu có. Không coi estimated chars/2 là native usage thật. Chưa biết history/usage thì estimate bảo thủ hoặc fresh profile; không mặc định reuse rẻ hơn. Quota % có timestamp/reset/pool, không đổi sang token. Rate-limit read có TTL/backoff; không LLM polling.

HITL giữ steer, ask/answer, pause, cancel theo mức route hỗ trợ. Steer cùng scope có receipt applied hoặc bằng chứng hành vi; scope thay tạo revision/invalidation. Pause là barrier theo semantics công bố, không hứa suspend OS. Stop/timeout phải theo dõi đến terminal hoặc unknown. Không để process pool/session reuse dùng lại câu trả lời/quyền từ attempt cũ.

### Context, skills và storage

- Một canonical task/role/skill policy; renderer theo backend. Dùng native output schema khi hỗ trợ, không gửi cùng schema/instruction cả packet và developer prompt không cần thiết.
- Cache theo content hash/version và quyền đọc; chỉ cache immutable material. Prompt cache của provider là cơ chế riêng, không hứa quota giảm.
- Context scoped theo task/frontier/primary inputs; paginated resource reads có size cap. Delta có baseline ID/hash và ACK; thiếu baseline thì gửi snapshot hợp lệ. Không cắt im lặng, không bỏ counterevidence chỉ vì ít liên quan đến kết luận mong muốn.
- Progressive skill references cho tài liệu dài; invariant bắt buộc nhỏ luôn có mặt. Không tạo một LLM để tóm tắt mỗi lần đọc file; summaries chỉ là derived artifact có provenance.
- Stream hash/copy và prepare snapshot ngoài write lock; commit ngắn kiểm revision/lease/generation và immutable identity. Tránh TOCTOU bằng snapshot, không bằng giả định file chưa đổi.
- Coalesce telemetry lặp theo time/count; terminal, intent, approvals, checkpoint, ownership và publication phải durable ngay. Giữ đủ usage để settle sau crash; phần chưa flush không biến thành 0.
- Tách hot control/usage rows chỉ khi whole-state read/transaction là bottleneck thực tế. Migration cần backup/restore và chặn old writer; không chỉ nâng số schema. GC giữ mọi evidence/history còn reference và mọi unknown job.

## 6. Kế hoạch thay đổi code, scripts, skills

Bảng dưới là đích refactor tổng thể. Phần đã thực hiện trong source 0.5.0 và các giới hạn nằm ở [integration foundation](integration-foundation.md); không coi mọi dòng là đã hoàn tất.

| Phần hiện tại | Giữ / thay / mở rộng | Tiêu chí retire |
|---|---|---|
| engine, research, planning, model policy, benchmark guards | Giữ semantics và fixtures; bổ sung workspace/session/group boundaries | Không bỏ scientific gates để giao hết cho backend |
| recovery/checkpoints/resources | Mở rộng native reconciliation, scoped accounting, quota metadata; dùng một recovery engine | Bỏ nhánh tính usage/chuyển trạng thái trùng khi normalizer mới có evidence tương đương |
| codex-native/native-rpc/native-state/codex-worker | Tách adapter lifecycle khỏi one-process-per-attempt; thêm session registry và observe/collect | SDK chỉ thay RPC khi giữ effective controls và giảm net code; không giữ hai đường cùng scope vô thời hạn |
| runner/native-tools/context | Execution/control roots, bounded reads, renderer không lặp prompt, group ownership | Loại assumptions packet.workspace là DB root sau migration |
| receipts/artifacts/util | Streaming immutable staging + publication journal | Bỏ full-file buffer ở đường file lớn; giữ integrity checks |
| store | Giảm giao dịch thừa trước; selective hot data khi cần | Không full rewrite ORM/event-store chưa có lý do |
| adapters CLI cũ | Giữ bounded one-shot/manual fallback đang hữu ích; structured route thay phần thiếu control | Deprecate sau route mới đạt cùng task/auth/OS và tài liệu có đường thay; không xóa để ép migration |
| sáu research skills và roles | Giữ research rubric, references, portability; gom protocol boilerplate vào renderer/bundle chung | Loại câu hướng dẫn lỗi thời “CLI không có native control” theo profile; không tự sửa skill cá nhân/global |
| scripts/harness/verify/benchmark | Một interface core; bổ sung command observe/reconcile/workspace/session khi cần; reuse acceptance tooling | Bỏ command/script trùng sau migration, không giữ hai bộ manifests/approval |
| docs/config/schema | Capability rõ scope và evidence; fields mới versioned; config cũ tiếp tục shared_serial/fresh mặc định | Chỉ activate profile mới có requirements đủ; README/status luôn tách plan và implementation |

Refactor theo lát cắt có test và đường rollback. Không dọn lớn toàn repo trước khi tích hợp. Không sao chép kiến trúc nguyên backend; mượn module/interface hợp license nếu thay được một trách nhiệm cụ thể.

## 7. Lộ trình RT0–RT8 bản 4

Mã RT giữ để nối lịch sử; thứ tự triển khai thực tế là các lát cắt dưới đây, không đợi toàn bộ roadmap hoàn tất. RT6/RT7 áp dụng ở mỗi lát cắt.

| Mốc | Deliverable và dependency | Điều kiện hoàn thành |
|---|---|---|
| RT0 — quyết định/phạm vi | Research C01–C18, pin/capability evidence, chọn workload và required capabilities | Plan đã được người dùng cho phép implementation; nghiệm thu sản phẩm H0 vẫn riêng |
| RT1 — contract và tinh gọn nền | C12/C13/C14/C15/C17 tối thiểu; registry contracts, render không trùng, scope usage, quota provenance | Fixtures accounting/baseline/policy/context; chưa cần daemon/DB rewrite |
| RT2 — workspace/publication | C01/C03/C16, roots, manifest/staging/journal/provider; phụ thuộc ownership hiện có và contract RT1 | Crash/conflict/path/dirty-baseline fixtures; shared_serial vẫn hoạt động |
| RT3 — recovery native | C07/C09/C11; observe/collect/reconcile, attempt/session identity, descendant scopes; sử dụng RT1 | Lost reply/late output/unknown/budget được xử lý; không inference cho collect và không replay mù |
| RT4 — mở năng lực theo việc | C02 sau RT2+RT3; C05/C06 sau RT1+RT3; C10 sau RT1+RT3 và RT2 nếu có writers | Bật từng capability có workload, native coverage, acceptance đúng scope; không bắt làm cả ba cùng lúc |
| RT5 — backend/provider kế tiếp | C18; so CLI/SDK/provider ngoài trên đúng workload và model/auth | Một route chính đáp ứng đủ contract, có code retirement và portable handoff |
| RT6 — nghiệm thu từng slice | S0/P0 và trace thật hoặc L1/L2 theo minimal protocol | Required gates pass; missing giữ pending/disabled. Mỗi benchmark được duyệt riêng |
| RT7 — bàn giao và retire | README/config migration/rollback/report, bỏ đường trùng đã thay an toàn | Người dùng hiểu capabilities và giới hạn; source/evidence tương ứng; H0 |
| RT8 — tối ưu từ sử dụng | C04/C08 nếu benefit/contract đủ; hot tables/cache/retention nâng cao khi gặp bottleneck | Trace chứng minh quyết định hữu ích; không đổi quyền/model hoặc giảm chất lượng để có metric đẹp |

Lát cắt đầu **RT1 tối thiểu + RT2 snapshot/publication**, cùng counter baseline và collect/reconciliation của RT3, đã có trong 0.5.0. RT4 đã có admission writers riêng theo cap; chưa bật native groups hoặc session reuse. Git/native workspace providers, tự đối soát descendants và các RT4/RT5 khác chỉ mở theo workload/contract đã quy định. Các phần independent có thể làm song song khi user cho phép phân công, nhưng không bỏ dependency acceptance.

Không buộc inference benchmark ở cuối mỗi refactor. Các thay đổi thuần core có oracle deterministic dùng S0. Khả năng native cần activation thực tế sẽ đi P0 và evidence đúng scope.

## 8. Nghiệm thu ít lượt nhưng đủ rủi ro

[Protocol chính](acceptance-minimal-protocol.md) là nguồn duy nhất cho số lượt/caps/quyền. Bổ sung coverage C01–C18 trong protocol, không tạo 18 benchmark.

- **S0:** fixtures cho roots/publication crash, session lease/history mismatch, usage reset/aggregate, late outputs, child stop scope, delta mất baseline, bounded buffers và old writers nếu có migration.
- **P0:** metadata/version/schema/profile tại thời điểm bật; không suy effective execution từ catalog hoặc lệnh --help.
- **L1 hoặc trace thật hợp lệ:** một công việc thực sự dùng profile để xác nhận native integration. Tái dùng evidence có cùng contract/source/OS/rights; không kiểm mọi model/hãng.
- **L2 có điều kiện:** chỉ những semantics control/reuse/group chưa được trace trước chứng minh. Không ép reconnect, writer conflict và group cancellation vào một run nếu không có oracle rõ. Thiếu coverage thì chưa bật scope đó.
- **H0:** user review report và cách dùng/tiếp tục; không cần chạy lại để quay demo.

Tiêu chí không đạt không được bù bằng điểm tổng. Không mô phỏng “khám phá tri thức mới” để chứng nhận harness. Scientific usefulness, chất lượng phân công, UX và lợi ích reuse lâu dài được review khi dùng. Nếu phép đo riêng có giá trị quyết định, chuẩn bị protocol rồi xin duyệt.

## 9. Khi nào chọn lại hoặc dừng một nhánh tối ưu?

| Dấu hiệu | Hành động |
|---|---|
| Native reuse làm tăng history/token/rework hoặc phá independence | Fresh session cho scope đó; giữ portable state và tìm nguyên nhân, không xóa capability toàn hệ thống |
| Group thiếu accounting/control bắt buộc | Core-managed workers hoặc backend khác đã đủ; không tự hạ requirements |
| Snapshot copy quá nặng hoặc worktree thiếu baseline semantics | Chọn provider/materialization khác; immutable shared inputs, giới hạn writer count |
| Custom protocol khó theo version hơn SDK/runtime | Decision thay driver/provider, chỉ giữ một owner và retire phần tương ứng |
| Wrapper cần nới quyền/chuyển paid hoặc tạo state machine trùng | Không activate route đó; chọn cấu hình/route đáp ứng policy |
| Core transaction/I/O chậm trong trace thật | Tối ưu đúng hot path; migration nhỏ có rollback trước khi cân nhắc storage mới |
| Feature không có workload dùng, chi phí bảo trì cao | Không triển khai hoặc deprecate có migration; đừng giữ chỉ vì đã viết |
| Optimization làm mất evidence, khả năng kiểm chứng hoặc model cần thiết | Rollback; đây là vi phạm constraint, không là trade-off hợp lệ |

Bàn giao cuối là **báo cáo hệ thống và evidence đúng scope**. Paper/proof vẫn là đầu ra hợp lệ của dự án research chạy trên hệ thống. Không đưa tỷ lệ tiết kiệm hoặc cam kết hệ thống mạnh hơn vào báo cáo khi chưa có dữ liệu tương ứng.
