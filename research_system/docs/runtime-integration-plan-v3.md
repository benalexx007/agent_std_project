> Lưu trữ bản 3, giữ nguyên nội dung trước khi thay bằng [bản 4](runtime-integration-plan.md) ngày 27/10/2026. Các mốc tiến độ bên dưới là lịch sử, không phải trạng thái capability hiện hành.

**Kế hoạch tích hợp backend native và tối ưu — bản 3**

Ngày: 26/10/2026. Baseline đang có: source 0.3.1 / state v2.
Trạng thái cập nhật 27/10/2026: source 0.4.0 đã triển khai nhánh Codex native đầu tiên; 161 software tests, static checks và demo mock pass, chờ user review. Chưa kiểm chứng bằng inference/benchmark thật. [Implementation và giới hạn](codex-native.md). Bản 3 ưu tiên native có điều kiện; các nhánh còn lại giữ roadmap.
Phạm vi: tối ưu core và mở rộng M5 của [Research plan](research-domain-plan.md). Các tiêu chí nghiên cứu và nghiệm thu core nằm ở [capability plan](research-capability-plan.md), [v1 acceptance](v1-acceptance-plan.md). Mã RT0–RT8 chỉ giai đoạn kỹ thuật, tách khỏi R0–R6 của vòng nghiên cứu. Chi tiết: [backend/capability](backend-native-capabilities.md) và [protocol nghiệm thu tối thiểu](acceptance-minimal-protocol.md).

**1. Mục tiêu và nguyên tắc quyết định**

Mục tiêu là giảm thời gian tới kết quả có thể sử dụng, token/công việc làm lại, CPU/RAM/I/O và chi phí bảo trì, trong khi giữ tính đúng, khả năng phục hồi và kỷ luật nghiên cứu.

Thiên kiến mặc định theo yêu cầu người dùng: dùng backend native thường tiết kiệm hơn thêm runtime ngoài. Đây là giả thuyết thiết kế có thể bị bác bỏ. Khi hai route đáp ứng cùng yêu cầu và chưa có bằng chứng ngược, chọn native đơn giản hơn; khi native thiếu capability, driver khó bảo trì hoặc wrapper đem lại lợi ích vận hành rõ, cho phép đổi lựa chọn. Không tuyên bố đã đo native luôn rẻ/nhanh hơn.

| Quyết định bản 3 | Hệ quả |
|---|---|
| Script trước khi cần model; giao diện native trước wrapper | Chỉ dùng agent cho phần cần suy luận; tận dụng session/tool loop/control có sẵn |
| Khảo sát latest-published, triển khai trên version pin | Ghi channel/OS/auth/protocol; không khóa thiết kế vào bản cũ trên máy và không auto-update trong lúc chạy |
| Core sở hữu scientific state/policy; backend sở hữu agent loop | Giảm phần hạ tầng lặp lại, giữ portable handoff và kiểm chứng độc lập |
| Role/config chung, renderer theo backend | Đổi điều phối/worker mà không phải viết lại quy trình nghiên cứu |
| Native delegation có giới hạn và accounting | Tận dụng sub-agent mà không tạo cây việc ẩn hoặc hai scheduler cùng retry |
| Tối ưu core và native route trong từng lát cắt | Không đợi refactor toàn bộ core rồi mới thử integration, cũng không bỏ điểm nghẽn I/O hiện hữu |
| Nghiệm thu đúng scope được bật | Core offline trước; live tối thiểu; scientific quality và lợi ích dài hạn theo dõi khi dùng |

Decision record so sánh công viết/bảo trì, dependencies, startup/RAM, model overhead, rework/recovery, thao tác người dùng và auth/billing. Không cần A/B benchmark chỉ để xác nhận một lợi ích hiển nhiên qua contract/source. Đọc [quy tắc chọn lại](backend-native-capabilities.md) trước khi thêm wrapper.

Hướng bắt đầu bằng thành phần vừa đủ phù hợp với [Building effective agents](https://www.anthropic.com/research/building-effective-agents); lựa chọn cụ thể ở đây dựa trên yêu cầu và bằng chứng của project.

**2. Bằng chứng đã kiểm tra và mức chắc chắn**

Đã đọc lại source local và nguồn sơ cấp; đây là phân tích cấu trúc, chưa phải đo tốc độ bằng thực nghiệm:

| Quan sát | Vị trí | Hệ quả / ưu tiên |
|---|---|---|
| Mỗi tick polling cập nhật heartbeat qua transaction toàn state | [runner](../src/runner.mjs), [store](../src/store.mjs) | Với poll_ms=50 trong config mẫu, mỗi attempt có thể ghi khoảng 20 lần/giây; tách lịch heartbeat/control |
| Store parse/stringify toàn bộ JSON state mỗi transaction | [store](../src/store.mjs) | Lịch sử lớn làm tăng CPU, I/O và thời gian giữ lock; giảm tần suất trước, tách dữ liệu nóng khi cần |
| Context đọc/hash inputs trong transaction dispatch | [engine](../src/engine.mjs), [context](../src/context.mjs) | Dữ liệu lớn kéo dài write lock; chuẩn bị snapshot ngoài lock với kiểm revision trước commit |
| appendFileSync mỗi chunk, đồng thời giữ stdout trong RAM | [runner](../src/runner.mjs) | Đã có output cap nhưng còn I/O đồng bộ; chuyển streaming có backpressure |
| Hash/snapshot đọc nguyên file vào RAM | [util](../src/util.mjs), [receipts](../src/receipts.mjs) | File lớn gây peak RAM; hash/copy bằng stream, giữ validation hash |
| Context điều phối lấy tất cả task/unit và nhiều lịch sử | [context](../src/context.mjs) | Cần selection/pagination/delta; tăng max_chars không giải quyết tăng trưởng |
| Input estimate kiểm context capacity nhưng không là sàn riêng của reservation | [resources](../src/resources.mjs) | Thêm dự toán input/output/tool rounds và kiểm thiếu reservation |
| Không có Git repository trong workspace khảo sát | Kiểm tra local 26/10/2026 | Không mặc định worktree hoặc tự git init |

Phân tích packet ở lượt review token trước dùng config mẫu, một skill, không inputs/research records/state dispatch: scope cơ bản 10.351 ký tự; planning cơ bản 18.823; planning research-paper 25.308. Đây là kích thước ký tự đã tính tĩnh, không phải token hoặc kích thước toàn bộ native context. Chưa có benchmark baseline tốc độ/RAM hoặc lợi ích cache.

Nguồn kỹ thuật:
- SQLite WAL vẫn có một writer; tránh transaction dài và reader giữ snapshot lâu. Không đặt database WAL trên filesystem mạng. [SQLite WAL](https://www.sqlite.org/wal.html).
- Node.js nêu JSON lớn và công việc đồng bộ có thể chặn event loop; stream cần backpressure để kiểm soát bộ nhớ. [Event loop](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop), [backpressure](https://nodejs.org/en/learn/modules/backpressuring-in-streams).
- Retry nhiều tầng có thể khuếch đại tải; side effect cần idempotency hoặc reconciliation trước retry. [AWS Builders’ Library](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/).

**3. Kiến trúc và ownership tối thiểu**

Luồng: người dùng/agent điều phối -> core policy + research state -> driver native -> backend session/worker/group -> kiểm tra và công bố artifact. Wrapper ngoài chỉ được chèn khi có decision record về lợi ích.

| Thành phần | Trách nhiệm |
|---|---|
| Agent điều phối có thể thay thế | Phân tích, phân công, tổng hợp; phân giải prompt thành task/config/control có revision |
| Core Node.js + SQLite | Task/unit/attempt, owner/generation, decisions, admission, provenance, recovery authority và scientific acceptance |
| Renderer/driver mỏng | Dịch role/skill/policy; probe, dispatch, normalize event/control/usage; binding native IDs |
| Backend native | Model/tool loop, session/compaction, execution controls và sub-agent trong scope được giao |
| Artifact layer | Inputs/outputs immutable, checkpoint portable và publication lineage |

Core không cần Redis, network broker, vector database, web server hoặc LLM scheduler để chạy luồng cơ bản. SDK có thể thêm dependency khi thực sự giảm code/đáp ứng control; ghi rõ chi phí và chỉ load khi dùng. Không lấy zero dependencies làm mục tiêu tuyệt đối.

Một bên sở hữu create/release workspace, một bên quyết định relaunch unit, một đường publish. Retry request bên trong native turn khác retry unit; driver ghi phạm vi/giới hạn/telemetry có được, core không relaunch khi turn/jobs chưa đối soát. Không ép adapter tái tạo nội bộ backend mà protocol không cung cấp.

Executor dùng event stream của backend; một monitor cho project đang có jobs, control từ CLI khác process là durable command. Backend process/session warm có TTL/count/RAM cap khi có chuỗi việc liên quan; không mặc định daemon luôn bật hoặc heartbeat writes lúc idle. Native thread persistent có thể tồn tại trên đĩa khi process đã đóng.

Khi owner đổi, reconcile bindings và jobs trước dispatch; session sống không đồng nghĩa attempt vẫn có quyền publish. Kênh tools/hooks tới core chỉ được cấp scope attempt/generation, không cho worker ghi database trực tiếp.

**4. Backend mới nhất và lựa chọn integration**

Snapshot 26/10/2026: Codex CLI 0.164.0; Claude Code 2.1.310; Antigravity CLI 1.4.0, App 2.26.0, SDK 0.1.22. Nguồn release, mức bằng chứng và khác biệt giao diện ở [capability research](backend-native-capabilities.md). Trước implement refresh latest stable/channel phù hợp rồi pin; model tier không tự đổi theo release phần mềm.

| Route | Ưu tiên và scope | Gate chính |
|---|---|---|
| Script/manual/mock | Baseline và regression | Code deterministic; quyền/evidence vẫn được giữ |
| Codex App Server qua stdio local | Native route đầu cho session, HITL, usage/quota | Protocol version pin; approval/control/IDs và usage scope đúng; không suy từ docs ra live-ready |
| Codex exec / SDK | Unit hữu hạn khi đủ, hoặc SDK giảm code | Chọn một implementation chính cho use case; không dùng exec-only để giả mid-run controls |
| Claude CLI streaming | Native route khi cần Claude | Model/effort mapping, explicit settings/tools, schema, resume/usage; Windows permission semantics |
| Claude Agent SDK | Khi callback/hooks đáng giá hơn dependency thêm | Auth/billing đúng scope, hooks fail semantics, children accounting |
| Antigravity CLI structured | Native route khi cần Antigravity | Verify flags ở bản pin; schema/stdin/session/counters; control theo interface thực |
| Antigravity SDK | API sâu khi CLI chưa đủ | Python/dependency, auth route, policies và lifecycle được chấp nhận |
| Headless / Orca / Cezar | Optional sau khi native route được xem xét | Chứng minh capability/lợi ích, preserve policy, có removal/exit plan |
| ACP / LangGraph / campaign connector | Deferred theo nhu cầu thực | Có consumer và lợi ích vượt integration/maintenance cost |

Native controls đã có trong backend được map trực tiếp; không cần Orca chỉ để có stream hoặc resume. Orca vẫn có thể đáng dùng cho trải nghiệm UI/đa phiên nếu native surface chưa đủ. Headless có thể giảm maintenance nhiều CLI, nhưng wrapper không được làm mất model/effort/quyền/usage native.

Các source pin của khảo sát wrapper cũ là lịch sử, cần refresh nếu chọn:
- Headless 93cd9b06b85f848af1308c41e018991b33907c5e: AllowMode read-only/yolo và Antigravity argv cần chú ý. [Types](https://github.com/RobertTLange/headless-cli/blob/93cd9b06b85f848af1308c41e018991b33907c5e/src/types.ts), [mappings](https://github.com/RobertTLange/headless-cli/blob/93cd9b06b85f848af1308c41e018991b33907c5e/src/agents.ts).
- Orca 35af10ddeda665c8e3bb753f80679f7748be5dbf: worker ready/completed và unknown khác nhau. [Specs](https://github.com/stablyai/orca/blob/35af10ddeda665c8e3bb753f80679f7748be5dbf/src/cli/specs/orchestration-worker-specs.ts).
- Cezar f6b910f302793bb349282742ed9b7b8091a0190d: effort/permissions cần xác minh lại. [Contract](https://github.com/open-mercato/cezar/blob/f6b910f302793bb349282742ed9b7b8091a0190d/packages/contract/src/runs.ts), [runner](https://github.com/open-mercato/cezar/blob/f6b910f302793bb349282742ed9b7b8091a0190d/packages/cezar/src/core/codex-app-server-runner.ts).

Không cài runtime/SDK hoặc chuyển billing tự động. Vòng đầu không yêu cầu mọi backend live-ready; ưu tiên Codex vì model policy đã được người dùng chọn. Claude/Antigravity được thiết kế capability đầy đủ nhưng activation chờ mapping/config/quyền phù hợp.

**5. Phân bổ công việc để vừa nhẹ vừa đủ chất lượng**

Ba hình thức chạy được chọn theo scope; chưa phải field config đã implement:

| Hình thức | Dùng cho | Cách chạy |
|---|---|---|
| Quy trình xác định bằng script | Hash, validate, status, xử lý dữ liệu theo thuật toán đã duyệt, chạy command cố định | Code thực thi với cùng audit/quyền; không gọi model để điều khiển từng bước |
| Một worker | Sửa nhỏ, kiểm citation, phân tích có phạm vi, unit liên kết chặt | Một context gọn; checks phù hợp; không bắt spawn đủ ba vai trò |
| Workflow nghiên cứu | Giả thuyết, proof, thiết kế/kiểm chứng thực nghiệm | Chia theo dependency và artifact; reviewer độc lập khi cần |

Role, task class và backend vẫn độc lập. Ba vai trò researcher/implementer/evaluator tồn tại ở cấp hệ thống; một worker kiêm vai trò phải công khai mức độc lập. Test/schema pass không thay scientific evaluation.

Model mapping giữ: synthesis_planning = gpt-6-astra/high; analysis = gpt-6.1-sol/high; automation cần model = gpt-6.1-sol/medium. Script không suy luận không cần chọn model. Backend khác chưa mapping thì không tự chọn tương đương.

Planning hoàn chỉnh tiếp tục có primary checks và research checks mới của attempt hiện hành. Có thể tái dùng bản nguồn immutable và chỉ mục để truy xuất nhanh, nhưng planner vẫn tự kiểm nguồn và research điểm quan trọng/chưa chắc chắn; không tái dùng audit cũ hoặc analysis làm bằng chứng độc lập.

Chỉ replan khi scope, assumptions, evidence quan trọng, dependencies hoặc constraints thay đổi; status update và unit hoàn tất theo plan không mặc nhiên gọi planner tầng cao nhất. Agent điều phối phân loại semantic change; code chỉ xử lý các trigger xác định, không giả nhận diện được mọi thay đổi khoa học.

Gom các bước ngắn có chung context và acceptance vào một unit. Tách khi có parallelism hữu ích, cần độc lập hoặc cần checkpoint để giảm mất việc. Không gom qua decision gate hoặc ranh giới quyền. Concurrency phụ thuộc cả quota, RAM/CPU/I/O/GPU, dependency và writer ownership; tăng agent không mặc nhiên tăng throughput. Dùng cap cấu hình trước, chưa cần scheduler học tự động.

Hai mode delegation: harness_workers để core quản lý từng root; native_group để giao một unit cho nhóm nội bộ backend. Native_group là capability opt-in theo profile, không mặc định cho task nhỏ. Bắt đầu depth=1 và concurrency=2 làm trần thiết kế; kiểm child identity, quyền/model, usage phủ nhóm, cancel và reconcile trước bật. Nếu primitive backend không enforce được policy thì giữ disabled hoặc dùng roots riêng.

Renderer từ canonical role/skill/config sang native agent definition phải có version/hash và effective-config check. Override qua prompt có revision; không sửa global skills. Role, task class và permission không được gộp thành một tên agent cứng. Native group không thay evaluator độc lập khi dự án cần; xem [contract delegation](backend-native-capabilities.md).

**6. Context và token có cấu trúc**

Ưu tiên P0:
- Worker nhận objective unit, inputs cần thiết, dependency results liên quan, assumptions/counterevidence/open obligations của scope.
- Orchestrator nhận brief, active frontier, thay đổi từ cursor, blockers và budget; task/history đầy đủ truy xuất theo ID.
- Khi cursor mất hoặc đổi điều phối, dựng snapshot có phạm vi rồi tiếp tục delta; không dùng delta trên nền không xác định.
- Không thêm mọi skill/guidance chỉ vì có trong catalog; chọn theo loại suy luận của unit. Mục cần thiết phải tồn tại trong packet hoặc có đường truy xuất thực sự được cấp quyền.
- Giữ full JSON Schema để validator kiểm; worker nhận contract gọn theo output type hoặc native structured-output interface nếu có. Validation semantics không đổi; đo lỗi/retry trong sử dụng trước tuyên bố tốt hơn.
- Tách canonical audit packet khỏi prompt view; lưu renderer version, input/bundle hashes và prompt hash. Prompt gọn không được làm mất lineage.
- Render stable instructions/contract trước, task/dispatch/update thay đổi sau. Không đưa timestamp/ID vào đầu prefix ổn định.
- Chỉ nạp tool definitions và tool output cần thiết; lọc log bằng code, giữ raw evidence ngoài prompt.
- Không dùng LLM tóm tắt sau mỗi tool call. Summary chỉ tại milestone/context pressure, có source refs và giữ uncertainties. Summary không thay nguồn gốc.
- Session reuse chỉ trong cùng scope/model/permission/bundle phù hợp, một active turn; reviewer độc lập dùng context riêng. Khi session dài và nhiều nội dung không còn liên quan, tạo checkpoint/handoff thay vì kéo dài vô hạn.

Prompt caching có thể giảm chi phí xử lý nhưng không loại bỏ logical context; CLI phải xác minh telemetry và khả năng cấu hình. Không giả định cache chia sẻ giữa hãng/model hoặc percent quota giảm theo cached-token ratio. [OpenAI caching](https://developers.openai.com/api/docs/guides/prompt-caching).

Tổng token phải tính mọi lượt model của worker, điều phối, evaluator, retry, summary và native children. Output usage có thể đã gồm reasoning; normalize rồi mới cộng, không cộng reasoning hai lần. Giữ usage theo backend/model/effort, provenance và mức unknown.

Reservation đề xuất có phân rã: initial input + input tăng theo tool/history rounds + output/reasoning + validation/handoff + margin. Estimate đầu vào có tokenizer tương thích khi sẵn có; nếu chỉ có chars proxy thì ghi rõ và cộng phần native overhead chưa biết theo policy thận trọng. Không coi reservation là hard cap provider.

Quota snapshots tách token/request/percent/availability, account/pool, timestamp/reset và freshness. Không chuyển quota 5h phần trăm thành token, không tạo pool mới chỉ vì đổi runtime. Native subagents chỉ bật khi tracking/accounting/cancel scope đã đủ bằng chứng.

Dùng native discovery/catalog và progressive skill loading; chỉ đưa hướng dẫn cần thiết vào prompt. Pin project overlay và config sources được phép, tránh nạp đồng thời nhiều bản role hoặc tool catalog dư. Nếu cần tài liệu qua tools, cấp đường truy xuất thực tế; không cắt evidence rồi hy vọng agent biết tìm.

Ưu tiên native session/compaction khi phù hợp; checkpoint khoa học giữ riêng để recover hoặc đổi hãng. Không chạy thêm summarizer sau mỗi native compaction. Warm session chỉ cho scope tương thích, có TTL/concurrency/RAM cap, và tắt khi chi phí giữ session vượt lợi ích sử dụng.

Accounting phân biệt main-only, per-model aggregate và child events; chọn một nguồn tổng authoritative, không cộng trùng. Native internal retries, compaction, policy classifier/background jobs có thể tiêu model; phải ghi coverage, không tuyên bố mọi backend housekeeping bằng 0. Yêu cầu 0 model calls chỉ áp dụng housekeeping do core tự tạo. Không disable policy an toàn để đạt chỉ số token.

**7. CPU, I/O, độ trễ và bộ nhớ**

Tách ba lịch đang bị gộp trong runner:
- Control: event-driven trong cùng process; CLI khác process dùng bounded polling. Gợi ý ban đầu 250–500 ms khi active, phải kiểm bằng telemetry; không claim độ trễ đảm bảo trước đo.
- Heartbeat: chỉ renew khi đến lịch, theo lease; ví dụ lease 30 s có thể chọn 5–10 s nếu test timer/lag chứng minh đủ headroom. Không renew và rewrite state ở mỗi control poll.
- Telemetry: coalesce cumulative counters theo batch, giữ sequence/reset epoch; flush ở terminal/control/checkpoint quan trọng. Crash mất sample không được biến thành zero usage; reservation giữ đến reconcile.

Không có jobs thì monitor kết thúc hoặc ngủ chờ sự kiện cần thiết, không quay vòng LLM/ghi database. Trong executor đang chạy, đọc control revision/cursor nhỏ; chỉ reload phần state cần khi revision đổi. Nếu còn JSON blob, ghi rõ giới hạn; chưa tuyên bố RAM độc lập với tổng lịch sử.

Raw stdout/stderr dùng bounded streams và backpressure; parser giữ frame/result đang cần với giới hạn rõ. Không giữ cả log lớn trong RAM để parse cuối nếu protocol hỗ trợ streaming. Diagnostic log có quota/rotation và marker cắt; identity, decisions, results, evidence, usage settlement không được âm thầm bỏ. Nếu không thể lưu event bắt buộc vì disk full, đóng admission và xử lý stop/unknown theo khả năng.

Cache schema/skill immutable theo content hash và active bundle revision trong process; không cache kết quả kiểm evidence mutable chỉ theo mtime/size. Đọc/hash file lớn bằng stream. Hash/copy/context preparation ngoài DB write lock, sau đó commit chỉ khi owner/revision/input snapshot vẫn đúng.

Di chuyển hash ra ngoài lock chỉ an toàn nếu worker dùng chính snapshot immutable đã hash hoặc có cơ chế loại writer đồng thời. Nếu không bảo đảm, giữ đường serial hiện tại. Không thay kiểm hash bằng mtime để lấy tốc độ.

Background housekeeping có cap I/O; ưu tiên control và work đang chạy hơn log rotation/GC. Không thêm worker thread hoặc thư viện async JSON nếu chưa có bằng chứng công việc đó chặn event loop đáng kể.

**8. Storage bền vững với ít thay đổi cần thiết**

Giữ một SQLite database local và object files. Giữ synchronous=FULL cho state quan trọng; giảm số lần ghi và dung lượng transaction thay vì hạ durability để lấy tốc độ. WAL không tự giải quyết write contention; kiểm busy time, WAL growth và reader lâu. [SQLite synchronous](https://www.sqlite.org/pragma.html#pragma_synchronous).

Bước đầu giảm heartbeat writes, coalesce telemetry, cache immutable bundles và đưa raw logs ra ngoài state blob. Chỉ tách bảng operational hot data khi consumer cần hoặc số liệu cho thấy blob là bottleneck. Không normalize toàn bộ research graph hoặc xây event-sourcing framework trong đợt tối ưu.

Nếu bổ sung tables cho intents/bindings/cursors/input requests, chúng ở cùng database; reservation, assignment và intent liên quan phải commit cùng transaction. Critical state transition và publication pointer bền vững trước ack. Progress hiển thị có thể coalesce với lost-sample semantics rõ.

Checkpoint theo unit boundary, tiến độ có thể bàn giao, thay đổi quan trọng hoặc headroom thấp khi có telemetry đáng tin; không tạo summary bằng LLM sau mỗi tool call. Dùng manifest/diff/result đã có để lưu tiến độ bằng code. Chu kỳ checkpoint cân bằng chi phí lưu với lượng việc có thể mất; phần sau checkpoint cuối có thể phải làm lại và phải được báo rõ. Không giảm checkpoint chỉ để đạt chỉ số token nếu recovery của writer trở nên không an toàn.

Schema migration chỉ thực hiện khi thay đổi persistence thực sự yêu cầu. Phải có guard trước mọi mutation; schema_version mới đơn thuần không ngăn binary cũ ghi. Cần kiểm entrypoint cũ, init và đường database; chọn cơ chế cô lập trước migration. Backup nhất quán gồm DB cùng artifact/manifests; không copy main DB đơn lẻ khi WAL đang dùng. [SQLite backup](https://www.sqlite.org/backup.html).

Rollback route mới trước; observer/reconciler tiếp tục cho jobs đã chạy. Không restore DB cũ rồi quên side effects/usage phát sinh sau snapshot. Backup restore và cleanup là workflow xác định có checklist kỹ thuật, không cần agent suy luận ở từng bước.

**9. Driver và durable dispatch vừa đủ**

Interface đề xuất gồm probe, start, observe, control, collect; release tùy resource owner. Context preparation/validation nằm ở core. Reconcile là chế độ observe sau reconnect; không bắt mọi driver có một subsystem recovery riêng. Process driver có thể phát event trực tiếp, không cần HTTP hay service API.

Request mang task/revision/unit/attempt, assignment generation, owner epoch, dispatch key, effective model/permissions/billing, quota pools, workspace/input manifest và deadline. Binding giữ driver/runtime version, host/account reference không secret, external IDs, cursor và observed state.

Capabilities ghi nghĩa cụ thể cùng evidence level: documented/source-reviewed/fixture-verified/live-verified/unsupported/unknown. Probe theo backend/interface/version/channel/OS/auth/effective-config, không lấy cờ chung theo hãng. Tách steer immediate/next-turn, pause boundary/interrupt/suspend, cancel root/tree/external jobs, checkpoint boundary/midrun, session resume và portable handoff. Unknown không được quảng cáo supported.

Đối với start có side effects:
1. Ghi reservation/assignment và dispatch intent bền vững trước gửi.
2. Claim và kiểm barrier/generation; gửi với request identity cố định nếu runtime hỗ trợ.
3. Lưu handle/receipt; ingest events bằng ID/cursor và dedup.
4. Nếu gửi xong mất reply, giữ submit_unknown; reconcile trước gửi lại.
5. Terminal execution -> collect/validate/publish; scientific verdict vẫn riêng.
6. Settle usage một lần khi phạm vi jobs đã rõ; unknown giữ reservation.

Local process cũng có crash window giữa spawn và ghi PID. Không tự chạy lại vì không thấy handle; cần supervisor/job evidence hoặc reconcile. PID sau reconnect phải kiểm identity/lifetime, không signal chỉ theo số PID.

Control tới giữa kiểm barrier và external start: fence publication, ghi cancel intent và stop worker mới xuất hiện khi quan sát được. Không hứa atomic dispatch giữa SQLite và runtime ngoài. Event nguồn không có sequence thì ghi giới hạn dedup, không bịa exactly-once.

Một retry policy, bounded attempts/deadline và backoff/jitter. Tái kết nối stream không phải chạy lại công việc. Không retry permission/schema/config error như lỗi quota. Quota/capacity wait không tiêu token model hoặc spawn liên tục.

Fallback giữ completed units và raw evidence; đối soát worker/jobs cũ, xác minh checkpoint/input/bundle, chọn backend đủ model tier/quyền/capability và pool, reserve chi phí tiếp quản rồi tăng generation. Worker mới nhận phần còn lại và uncertainties. Native session không được chuyển trực tiếp giữa hãng; handoff bằng artifact là hợp đồng chung. Nếu side effect cũ chưa rõ, chặn relaunch dù còn quota ở hãng khác.

Ngắt điện/sleep/executor chết: startup đối soát bindings, unresolved jobs, workspace và publication journal trước dispatch mới. Lease hết hạn chỉ kích hoạt kiểm tra. Deadline ghi rõ wall-clock hay execution-time trong task policy; thời gian máy ngủ không được diễn giải tùy tiện.

**10. HITL và phản hồi nhanh**

Control status hiển thị riêng requested, delivered/acknowledged, execution observed và result accepted. Người dùng cần thấy lệnh đã nhận ngay cả khi runtime chưa dừng xong.

- Status đọc state; không gọi model để hỏi worker còn sống hay không.
- Steer không đổi scope có message ID và ack semantics; gộp cập nhật tương thích, không gộp cancel hoặc approval.
- Thay mục tiêu/acceptance/input quan trọng tạo revision và invalidation đúng phạm vi.
- Pause đóng dispatch barrier; ngừng tại boundary hoặc interrupt theo capability.
- Cancel có grace/deadline, quan sát process/jobs; timeout mà chưa rõ -> unknown.
- Runtime input request gắn attempt/turn/deadline, tách project approval. requestDecision hiện chặn active attempts nên phải thêm đường này khi driver hỗ trợ hỏi giữa lượt.

Grant đã có đúng scope được dùng lại. Agent không được tự approve benchmark, nâng quyền hay budget. Đổi điều phối lấy durable handoff/cursor, giữ worker còn hợp lệ và fence lệnh từ owner cũ.

Ưu tiên native events/control, approval callbacks và kết quả qua driver; bridge input request là phần của native route khi cần, không bị hoãn chỉ vì chưa cài runtime ngoài. Chỉ thêm broker local cho checkpoint/progress nếu có consumer cụ thể và permission cho phép; token scope theo attempt, không cấp quyền ghi DB. Nếu CLI không có kênh giữa lượt, capability vẫn boundary-only. Sửa trực tiếp trong UI ngoài mà bridge không quan sát được phải reconcile trước publication.

**11. Workspace, artifacts và cache đúng chỗ**

Ba mode có thể triển khai dần:
- shared_serial: mặc định cho project nhỏ, một writer và recovery an toàn.
- snapshot_directory: dùng khi cần cách ly project không Git.
- git_worktree: dùng khi đã có Git và thực sự cần writers song song hoặc runtime bắt buộc.

Một bên sở hữu lease/create/release. Worktree không là OS sandbox; input uncommitted/ignored cần manifest riêng. [Git worktree](https://git-scm.com/docs/git-worktree).

Không clone/copy cả project hoặc dataset lớn mỗi unit. Đóng gói inputs cần, reference/mount read-only cho data lớn, ghi environment/dependency manifest. Có thể tái dùng workspace giữa unit cùng attempt hợp lệ; trước giao owner mới phải verify/quarantine dirty state và jobs. Không tái dùng workspace unknown để tiết kiệm setup.

Output snapshot theo content hash; dedup blob trùng, giữ receipt của từng unit. Thu cả diff/code cần tái lập cùng report. Publication kiểm base/input hash, path/junction confinement, artifact contract và conflict. Mutable files vẫn phải được xác minh khi dùng làm bằng chứng; cache theo mtime chỉ có thể là hint.

Dùng staged manifest/pointer cho consumer harness. Materialize nhiều canonical files có journal; không claim filesystem update nhiều file là atomic. Crash publication có thể resume từ blobs mà không chạy lại worker. Conflict -> review, không tự ghi đè.

Retention chỉ dọn tài nguyên đã settled và dữ liệu không còn được reference theo policy. Pinned evidence, checkpoints đang dùng, unknown jobs và outputs chờ publication được giữ. Không xóa raw scientific evidence chỉ vì vượt log quota. GC dùng reachability/manifest và dry-run trước thao tác; không cần dịch vụ GC riêng.

**12. Thu gọn code và config**

Giữ research/planning/model/benchmark/improvement semantics. Tách transport vừa đủ gắn driver, không rewrite engine hoặc chuẩn hóa mọi API về mẫu số chung nghèo capability.

Config người dùng: execution profile, backend, model policy, role/skill refs, permission, quota pool, resource cap và delegation mode. Tên/method/version-specific flags nằm trong driver. Profile thiếu mapping model không tự dùng backend default trái policy.

Mỗi driver ghi phần code thay thế/retire, capability tăng, dependencies/services thêm và cách gỡ. Contract/common normalizer dùng chung khi semantics giống; phần khác nhau giữ explicit. Không giữ cả direct/SDK/wrapper cho cùng scope vô thời hạn; chỉ retire sau đủ evidence và không phá route khác còn cần.

Profiles đề xuất: local-process, codex-native, claude-native, antigravity-native; SDK là lựa chọn implementation theo nhu cầu, không thêm dependency tự động. Wrapper profile xuất hiện sau decision record. Tất cả tên mới còn planned, không là config hợp lệ của source 0.3.1.

Capability probes cache theo binary/package/protocol/effective-config/OS/auth mode, invalidated khi thay; account availability có freshness riêng. Không auto-update, scan plugin marketplace hay reconnect mọi MCP server mỗi task. Chỉ thêm local tool surface nhỏ khi backend có consumer; không bắt dựng gateway mạng.

**13. Lộ trình triển khai theo capability**

Các mốc dưới đây là roadmap, không tự là trạng thái hoàn thành. Source 0.4.0 đã có contract/driver Codex, điều phối worker, controls và một phần tối ưu core; xem ma trận tiến độ bên dưới. Các mã không còn mang nghĩa buộc chọn runtime ngoài như bản 2.

| Mốc | Đầu ra cụ thể | Điều kiện hoàn thành |
|---|---|---|
| RT0 — Scope và latest baseline | Decision native-first, version/OS/auth matrix, role/model/policy boundaries, acceptance scope | Required capabilities và phần deferred có lý do; refresh nguồn nếu version đổi |
| RT1 — Tối ưu core thiết yếu | Scoped context, input-aware reservation, heartbeat/control tách, bounded streams, critical persistence | Regression giữ invariants; housekeeping core 0 model; không đòi full DB rewrite |
| RT2 — Native contract và renderer | probe/start/observe/control/collect; native bindings/intents; role/skill overlay; effective policy/schema/accounting | Offline conformance/negative cases, unsupported rõ, Windows invocation và fallback fence đúng |
| RT3 — Codex native đầu tiên | App Server stdio + CLI hữu hạn khi phù hợp; session/usage/approval/HITL; không thêm wrapper | Một lát cắt end-to-end có thể review; model/effort policy giữ nguyên; native controls map đúng |
| RT4 — Delegation/isolation theo nhu cầu | harness_workers enforcement; native_group bounded; workspace owner/publication | Trước bật children/concurrent writers phải đủ accounting/cancel/isolation; không cản route single-worker |
| RT5 — Backend tiếp theo hoặc wrapper có lý do | Claude/Antigravity latest-pinned driver theo mapping; hoặc runtime ngoài có decision record | Reuse contract; giữ auth/billing/quyền; chứng minh phần code/lợi ích thêm |
| RT6 — Nghiệm thu scope cần bật | S0/P0/L1 và L2 khi cần theo protocol tối thiểu | Offline và live evidence riêng; mỗi campaign được hỏi trước; không nhân toàn ma trận |
| RT7 — Bàn giao, retire, dùng thật | Capability report, limitations, rollback, removal list, feedback gọn | User review; không bắt runtime ngoài hoặc discovery benchmark |
| RT8 — Tối ưu/mở rộng từ thực tế | Sửa incident, workload routing, session reuse, thêm backend khi cần | Có vấn đề/decision cụ thể; benchmark riêng chỉ khi cần giải bất định |

RT0 -> RT1/RT2 theo lát cắt -> RT3 -> RT6 -> RT7 là đường native đầu tiên. RT4 chèn trước RT6 nếu profile bật delegation/isolation; RT5 không là điều kiện nghiệm thu Codex/core. Mỗi nhánh mới đi qua RT6/RT7 cho đúng scope. Không chạy RT1/RT2 song song nếu thay cùng state semantics mà chưa có interface rõ.

Tối ưu source cục bộ có thể bàn giao trước native activation. Không dùng RT1 làm cớ xây full storage migration trước khi thử driver mỏng; kiểm một lát cắt native sớm để tránh thiết kế abstraction không khớp protocol.

Deferred: runtime thứ hai không có nhu cầu, custom GUI, scheduler học tự động, full research graph normalization, vector memory, team phân cấp lớn, remote/cloud orchestration không có consumer.

**14. Nghiệm thu tối thiểu và tối ưu qua sử dụng**

Nguồn protocol chi tiết duy nhất: [acceptance-minimal-protocol.md](acceptance-minimal-protocol.md), bổ sung V1-01–V1-11. Chọn kiểm tra rẻ nhất có thể phát hiện đúng lỗi; không tối thiểu hóa số assertions bằng cách bỏ crash window/permission gate.

- S0: một batch regression/static cuối trên candidate; code fixtures/fake clock/fault injection, không gọi model. Tái dùng C1–C4 và tests cũ; bổ sung đúng phần thay đổi.
- P0: version/protocol/effective config/context/admission preflight, không inference.
- L1: một root attempt cho một profile cần bật; dùng oracle xác định. Không ép chạy đủ ba role/model hoặc nhiều hãng.
- L2: tối đa một root attempt thêm để kiểm native control/delegation cần bật và chưa có evidence tương đương; child/turn caps rõ. Nếu không gộp hợp lệ, ghi missing và giữ feature disabled, không giả pass.
- H0: user walkthrough tái dùng artifacts. Native/schema success không xác nhận năng lực khoa học.

Mọi live campaign có chủ đích, kể cả smoke/performance, cần xác nhận riêng với protocol/manifest/models/quyền/budget/stopping rules. Không thực hiện benchmark trong lượt sửa tài liệu. Một task sử dụng thật đã được cho phép có thể cung cấp evidence; không chèn thao tác thử nghiệm ngoài scope để né approval.

Tiêu chí tối ưu cấu trúc: 0 model calls cho core polling/hash/schema/status; 0 idle heartbeat writes; không full-state write mỗi control tick; buffers/warm sessions/diagnostic retention có giới hạn; critical evidence bền vững; không retry side effect unknown. Native background model overhead được hạch toán theo coverage, không coi là miễn phí.

Telemetry nhẹ trong sử dụng:
- Model: input/output/cache/reasoning có provenance, children coverage, actual requested/observed model và effort, retry/compaction.
- Workflow: time-to-accepted-result, prepare/queue/start/publish durations, rework và human interventions.
- Control: persisted/delivered/observed, unknown jobs và lỗi reconciliation.
- Resources/maintenance: RSS high-water, DB writes/lock waits, log/artifact bytes và số sự cố/công sửa driver.

Dùng event/boundary có sẵn và sampling hữu hạn, không instrumentation nặng hoặc LLM grader cho mỗi task. Duration local dùng monotonic clock; không trừ timestamp khác host để giả latency chính xác.

Không đặt % tiết kiệm, chất lượng research tổng quát, multi-agent superiority hoặc MTBF dài hạn làm gate đầu. Các metrics này đo trong công việc thật; chỉ đề xuất experiment riêng khi nó có thể thay đổi một quyết định. Bảo toàn mọi invariant quan trọng không tự chứng minh hiệu năng khoa học không giảm.

**15. Rollout, cập nhật và trạng thái**

Latest-published là mốc nghiên cứu; execution luôn pin phiên bản đã được kiểm tra. Trước nâng backend: review release/protocol diff, invalidation capability evidence liên quan, đóng admission cần thiết, reconcile active/unknown jobs và backup nhất quán nếu format thay. Không đổi binary/config đang phục vụ session active.

Sau update chỉ chạy offline conformance cần thiết và live delta cho capability bị ảnh hưởng khi được phép; không mặc định chạy lại mọi benchmark. Capability chưa rõ giữ unverified/disabled. Rollback route vẫn để observer/reconciler xử lý jobs cũ, không restore DB rồi bỏ qua side effects mới.

External execution mặc định disabled tới activation theo profile. Đổi SDK/auth/host/permission là thay scope cần review; model mappings ngoài Codex vẫn do người dùng thiết lập. Log/report không chứa credentials. Native UI ngoài bridge cần reconcile trước publication.

Source hiện tại 0.4.0/state v2; baseline khảo sát ban đầu là 0.3.1. Chưa chạy benchmark/inference mới hoặc đo mức tiết kiệm. Trạng thái theo scope:

| Mốc | Phạm vi trong 0.4.0 | Phần còn mở |
|---|---|---|
| RT0 | Scope native-first, version/schema pin và boundaries | Refresh pin khi backend đổi |
| RT1 | Frontier scoped, native input floor, heartbeat riêng polling, bounded RPC và log backpressure | Delta cursors, hash/snapshot lớn ngoài lock và tối ưu storage sâu giữ deferred |
| RT2–RT3 | Codex App Server stdio, renderer/thread config, tools core, durable intent/binding, usage và HITL/checkpoint | Live compatibility/model access chưa xác minh; không tự resume turn |
| RT4 | harness_workers và serial writer admission | Native_group/concurrent writers chưa bật vì thiếu gate accounting/cancel/isolation |
| RT5 | Giữ adapters cũ, interface core không gắn cứng một hãng | Claude/Antigravity native mới và wrapper chỉ làm khi cần |
| RT6 | Software fixtures; preparer/grader L1 và benchmark guard | Mỗi live campaign vẫn cần người dùng xác nhận riêng; L2/campaign closure còn conditional |
| RT7–RT8 | Hướng dẫn/review artifacts, chưa bỏ adapter còn cần | User acceptance và tối ưu từ sử dụng thực tế |

