# Thiết kế terminal inspect cho project

Ngày 29/10/2026. **Spec thiết kế; offline inspector và GUI bindings đã implementation**, xem [usage/phạm vi](project-inspect.md) và [GUI guide](gui-integration.md). Deep host inventory/loader verification vẫn pending; reported observations không thành verified. Thuộc PG1a của [GUI integration plan](plugin-integration-plan.md), có [research xác minh](gui-integration-validation.md) và [acceptance](plugin-acceptance-plan.md). Mục tiêu: người dùng xem cấu hình và cơ chế hoạt động; orchestrator tiếp tục là giao diện vận hành chính.

## 1. Giao diện và phạm vi

Lệnh baseline hiện có:

```text
node scripts/harness.mjs inspect-project --workspace PATH
node scripts/harness.mjs inspect-project --config FILE
node scripts/harness.mjs inspect-project --workspace PATH --full
node scripts/harness.mjs inspect-project --workspace PATH --section capabilities
node scripts/harness.mjs inspect-project --workspace PATH --format json
```

Chọn đúng một --workspace hoặc --config. Không có cả hai thì dùng current directory làm workspace, hiển thị absolute path; không đoán một project khác từ thư mục cha. --workspace đọc persisted state nếu có. --config xác minh candidate và tìm workspace mà file chỉ định; nếu không parse/resolve được thì yêu cầu --workspace để đọc state. Không âm thầm mở database của project khác.

Mặc định terminal summary; --full mở toàn bộ config và provenance mà hệ thống đọc được, đã redaction. --section lọc project/config/models/roles/skills/capabilities/policy/runtime; --format json trả report có schema version. JSON mặc định cũng bounded đối với lịch sử; --full dùng cho local full snapshot. Thiếu trường có source/coverage unknown, không gọi báo cáo là đầy đủ toàn bộ GUI khi host không expose.

Không cần TUI framework, daemon, network, LLM hoặc auto-refresh. Plain text dùng được khi redirect; màu tùy TTY và NO_COLOR, không dùng màu làm dấu hiệu duy nhất. Cột tự wrap, Unicode/đường dẫn Windows dài được hiển thị; loại terminal control sequences từ dữ liệu. Không mở terminal mới cho mỗi lần tool call.

## 2. Read model và nguồn sự thật

Shared service `inspectProject` trả dữ liệu; terminal renderer và GUI tool cùng đọc nó. Tên module cụ thể chốt khi implementation. Không gọi CLI con để dựng report nếu có thể gọi service trực tiếp.

| Nhóm | Nội dung | Nguồn và giới hạn |
|---|---|---|
| Identity | Workspace/control root/execution root, domain, project ID, state version, timestamp | Persisted snapshot; candidate-only khi chưa init |
| Config | Registered config, candidate file, defaults/overrides, hashes/revisions, drift, validation errors | File mới không tự là config đang có hiệu lực; v4 chưa có provenance granular thì ghi snapshot/unknown |
| Roles/models | Orchestrator, role bindings, task classes/tiers, provider mapping và fallback | Config selection không là GUI model receipt; task override/attempt snapshot hiển thị riêng |
| Skills/rules | Registry paths, role allowlists, selected task skills, overlay/version/source | Role skills là tập cho phép; không phải tất cả đã nạp. Native skill catalog và loaded instructions khác nhau |
| Capabilities | Helpers, extension profiles/operations, MCP/plugins/hooks/native agents | Config/profile allowlist, task binding, observation theo host/session |
| Policy | Sandbox, network, grants, pending decisions, budget/quota pools, isolation, recovery/checkpoints | Configured guard và thực thi quan sát được tách riêng; quota ghi age/coverage, không đổi % ra tokens |
| Runtime | Counts, task/attempt state, desired vs observed, held reservations, pending jobs/publication và lỗi gần nhất | Metadata có correlation refs, không nhúng transcript hoặc raw secrets |

Mỗi observation chứa kind/name, declared value, selected binding nếu có, observed value nếu có, status, source, scope, observed_at, config fingerprint và limitation. Status có configured/disabled/selected/observed/unknown/stale/conflict/error; không ép một boolean active duy nhất. `observed` không đồng nghĩa capability đã pass acceptance.

Khi cùng server name có nhiều nguồn, giữ qualified identity gồm host/surface/scope/source; hiển thị effective winner chỉ khi resolver của host chứng minh. Hai profiles khai cùng helper không được đếm thành hai MCP servers. Installed, enabled, connected, callable và loaded-in-context không được đánh đồng.

## 3. Thu thập inventory

**Baseline offline:** đọc project config, persisted state/receipts và managed overlay index. Không scan toàn home, không đọc credential stores, không gọi backend CLI để tự refresh. Snapshot native cũ có time/thread/attempt; thay build/config/binding làm mất căn cứ hiện hành thì stale. Không có native receipt thì unknown, không ghi disabled.

**Host adapter về sau:** nhận receipt từ connection/session đang tích hợp nếu supported. Codex có API config/inventory nhưng phải bind đúng connection/thread; Claude Desktop có precedence riêng; AGY plugin list JSON là CLI inventory. Một subprocess metadata mới không được gắn nhãn trạng thái GUI hiện tại.

Refresh inventory là operation riêng có side effects được khai báo (ví dụ discovery khởi động MCP), không là hành vi ngầm của inspect. Không bật server, trust plugin, reload config hoặc spawn App Server chỉ để làm bảng xanh. Phát triển host readers theo nhu cầu, không bắt baseline chờ toàn bộ ba GUI.

## 4. Độ bền và dữ liệu nhạy cảm

- Đọc SQLite bằng connection read-only, một snapshot nhất quán, timeout hữu hạn; không dùng Store constructor hiện có, không migration/schema creation/config sync. WAL được xử lý theo semantics SQLite; không sao chép riêng file DB rồi bỏ WAL, không dùng immutable mode trên live database. Không hứa hệ điều hành không chạm sidecar metadata; bảo đảm không mutate logical state/schema/config.
- Chưa init: candidate report vẫn dùng được, không tự tạo .agentic. State lỗi/khóa/schema lạ: trả coverage/errors và những phần đọc được; không repair. Với config hỏng, --workspace vẫn đọc stored config. Nếu thiếu cả hai nguồn, chẩn đoán rõ thay vì success rỗng.
- Existing v4 đọc được mà không upgrade. PG1b có state mới thì thêm reader/version compatibility; provenance chưa tồn tại không được suy ngược từ defaults mới.
- Redact credential fields, auth headers, env values, sensitive argv/URL values trước cả JSON và terminal. Raw prompts/transcripts không nằm trong report mặc định. Không cam kết phát hiện mọi secret tự do trong prose; tránh xuất prose/log payload không cần thiết. Không có --show-secrets trong baseline.
- Read-only không cần owner lease. Không giải phóng reservation hoặc suy job đã stopped từ stale heartbeat. Report không phải operation phê duyệt hoặc validate scientific claims.
- Exit 0 khi report đủ cho scope yêu cầu (unknown host inventory vẫn hợp lệ); exit 1 khi partial do source/parse/DB failure; exit 2 cho cú pháp/options sai. Config drift được trình bày là warning, không tự sync.

## 5. Bố cục đề xuất

Ví dụ minh họa, không phải trạng thái project hiện tại:

```text
PROJECT  demo-research                   snapshot: <time>
ROOT     D:\projects\demo                 source: persisted v4
CONFIG   registered: r7   file: changed   action: review drift

ROLE          BACKEND       MODEL / EFFORT           SOURCE
orchestrator  codex         configured tier medium   project
evaluator     claude        mapping pending          project

CAPABILITY          CONFIGURED     OBSERVED          SCOPE
research-evaluate   role allowed   selected          task T12
math.check          profile on     last call passed  attempt A8
MCP inventory       unknown        unknown           GUI not observed

RUNNING 1 | WAITING_USER 1 | UNKNOWN_JOBS 0
DETAILS: --section skills | --section policy | --full
```

Summary hiển thị tổng số, tối đa 10 rows lịch sử mỗi nhóm, omitted count và cách xem tiếp; không cắt bỏ config field trong --full. Model/effort đã resolved hiển thị giá trị thực nếu có; configured và observed khác thì báo mismatch. Các details dài dùng nhóm/cây hoặc key-value thay bảng quá rộng. Error refs/cause ngắn đủ để orchestrator chọn log cần đọc.

## 6. Chi phí và nghiệm thu

Một read-only snapshot mỗi lần gọi; không hash lại toàn bộ artifacts, không đọc hết skill bodies, không tính scientific validity toàn graph. State hiện lưu một JSON payload nên đọc snapshot vẫn tỷ lệ kích thước state; không tuyên bố O(1). Chỉ tách index/storage nếu sử dụng cho thấy bottleneck. Không thêm schema migration chỉ để giảm latency report.

Tái dùng report trong GUI `project.inspect`, default section/summary nhỏ; người dùng xem --full trong terminal không bắt model đọc cả output. Bootstrap chỉ nhắc lệnh/khả năng, không nhúng snapshot mỗi turn. Watch, export HTML và interactive editing nằm ngoài baseline.

Nghiệm thu bằng fixtures tại A16–A18: read-only/error/drift, provenance/unknown/scope, redaction/render/parity. Một manual terminal review kiểm dễ đọc ở 80/120 columns và Unicode/Windows paths. Không cần live LLM benchmark cho inspector.
