# Research extensions — implementation 0.6.0

Ngày: **28/10/2026**. Source **0.6.0**, state/handoff **v4**. Đây là implementation EX0–EX5 về contracts, helpers, provisioning và kiểm tra phần mềm của [plan](external-integration-plan.md). Native effective scope/agent-tool execution và human acceptance vẫn pending; không có model inference hoặc benchmark nào được chạy để bàn giao phần này.

## Phạm vi thực sự có

| Operation | Route và bằng chứng |
|---|---|
| scholarly.arxiv | Bounded HTTPS + arXiv parser vendored từ commit cố định; giữ raw Atom, version/error feed và continuation |
| scholarly.openalex / scholarly.crossref | Một page metadata có giới hạn, raw response và cursor; OpenAlex abstracts qua parser đã pin |
| scholarly.download | Versioned arXiv PDF/HTML, byte/type limits; không auto-extract/execute TeX |
| bibliography.doi / bibliography.validate | DOI content negotiation qua cùng transport; BibtexParser giữ/report duplicate keys, failed blocks và metadata conflicts; không rewrite input |
| math.check | AST hữu hạn, explicit assumptions, exact symbolic result; không eval arbitrary source hoặc chứng nhận general proof |
| statistics.paired | Explicit summary, bounded exact sign flip hoặc seeded bootstrap; unit-of-analysis và degenerate uncertainty được ghi lại |
| figure.plot | Agg/headless PNG/SVG, input data/labels/config được giữ |
| paper.read / paper.render | pypdf selected pages và Poppler đã có trên máy; text extraction và rendered-page evidence là hai loại khác nhau |

Không thêm MCP server, runtime/LLM router, notebook service hoặc global skills. Sáu research skills hiện có được bổ sung references ngắn theo nhu cầu. Native loader chưa được nhận là verified: baseline dùng metadata catalog + paged harness_read, không nhúng toàn bộ library instructions vào mỗi task.

Package environment được provision riêng: **SymPy 1.14.0, NumPy 2.5.4, SciPy 1.18.1, Matplotlib 3.11.2, BibtexParser 2.1.0, pypdf 6.21.3**. Exact wheel/transitive hashes tại [requirements.lock](../extensions/research/requirements.lock); selected assets và local environment binding tại [lock.json](../extensions/research/lock.json). Target hiện được provision là Windows/Python 3.12.14; platform khác phải resolve/pin/verify profile riêng, không suy compatibility.

## Config và cách dùng

[research-extensions.json](../examples/research-extensions.json) là ví dụ mock/local; [codex-native-extensions.json](../examples/codex-native-extensions.json) giữ Codex điều phối và worker native. **Extensions và external execution mặc định disabled.** Chọn profile literature/analysis/research và thêm task.extension_profile khi workflow thật cần. Orchestrator thấy catalog profiles để phân công; chỉ worker có binding mới nhận harness_extension.

Với native helpers, chọn backend codex_writer và writes_workspace=true; backend read-only không đủ cho outputs này. Task có thể thu hẹp bằng extension_scope.operations/limits; không được tăng scope so với profile hoặc đổi quyền/model qua prompt. Ví dụ một task toán chọn analysis và chỉ math.check, http_calls=0. Profiles yêu cầu writes_workspace và snapshot_directory; không chạy helpers controller với shared_serial.

Các lệnh sau dùng Node >=24 đã xác minh, chạy từ research_system. Nếu node chưa trên PATH, dùng absolute executable được desktop cung cấp.

```powershell
node scripts/harness.mjs validate-extensions --config examples/research-extensions.json
node scripts/harness.mjs init --config examples/research-extensions.json
node scripts/harness.mjs extension-calls --config examples/research-extensions.json
```

Native worker có thể gọi harness_extension với operation và không truyền arguments để đọc schema; truyền arguments để chạy. Tool reply nhỏ, có artifact/receipt refs; dùng harness_read cho raw/result lớn. Contract discovery không spawn helper. Extension profile không đổi model tiers hoặc benchmark permissions.

Operator có thể dùng extension-call --attempt ID --key KEY --file call.json --owner ID --epoch N --execute khi attempt đã được phép, có binding và workspace sẵn sàng. call.json chứa operation/arguments, không arbitrary command. Kết quả nghiên cứu tổng quát vẫn dùng code do agent viết và Python đã pin trong **backend sandbox**; finite helper controller không nhận code tùy ý.

## Provision/rebuild và cập nhật

```powershell
node scripts/provision-extensions.mjs --python ABSOLUTE_PYTHON_PATH --pdftoppm ABSOLUTE_PDFTOPPM_PATH
node scripts/provision-extensions.mjs --python ABSOLUTE_PYTHON_PATH --pdftoppm ABSOLUTE_PDFTOPPM_PATH --execute
node scripts/lock-extensions.mjs
```

Lệnh đầu chỉ preview. Provision dùng venv và hash-checked wheels, không sửa desktop/global Python. requirements.lock đã có được dùng mặc định; --wheelhouse PATH cho rebuild offline từ cache. --resolve chỉ dùng khi operator chủ động review release mới, với --root NEW_DIRECTORY; không sửa environment đang dùng. Update interpreter/platform cần chọn wheel set phù hợp và review lock mới.

Provision staging thất bại không activate target; staging chưa hoàn tất được giữ để chẩn đoán, không được dùng làm environment. Chạy lại thành công trên environment đã khóa phải trả reused=true và không cài lại. Một cache wheels được giữ cho rebuild; không download/cache toàn catalog niche.

Lock pin selected helper assets, license/attribution, guidance, requirements và environment inventory. Dependency tree được kiểm rồi cache trong process, filesystem changes làm invalidation; không có daemon. Không chỉnh/cài package khi attempt đang chạy. Controlled Python dùng isolation và private bytecode path, không lấy unpinned bytecode từ writable workspace. Lock/config drift bị chặn; sync-config chỉ khi idle và không pending publication.

## Ownership, dữ liệu và recovery

Calls được cấp stable ID theo attempt + key, ghi intent/reservation trước side effect. Final barrier và spawn/HTTP dispatch được kiểm dưới cùng SQLite lock; không giữ transaction qua await. Một provider có một call đang chạy trong project, retries/redirects nằm trong envelope. Counters tách LLM tokens; credits/cost chưa có evidence được ghi unknown.

Request/input snapshots/raw outputs chạy trong controller-private .agentic/extension-work/CALL_ID, ngoài execution workspace. Chỉ fixed reviewed helpers được chạy ở đây. Sau khi pin blob/hash, outputs được materialize vào research-artifacts/CALL_ID trong execution root. Completed/failed call evidence của assignment hiện hành có thể được đưa vào publication journal; late/stale results chỉ giữ audit. Worker không được biến một output tự viết thành trusted helper receipt.

Publication dùng CAS/journal hiện có, không bypass expected outputs bằng một prefix tùy ý. Chỉ exact files/hashes do call ledger sở hữu mới được thêm. Sửa output sau call sẽ bị phát hiện; raw blobs/receipt vẫn giữ để review. Raw/source/output nằm ngoài prompt và có thể đọc từng phần.

Timeout/cancel chưa là bằng chứng process đã dừng. Trường hợp mất bridge giữ job/reservation và provider slot cho tới quan sát terminal. Sau observe-job có evidence, operator dùng reconcile-extension --request CALL_ID --owner ID --epoch N; missing HTTP usage được hạch toán bảo thủ toàn envelope. Không auto rerun call ID có outcome chưa rõ.

## Migration và rollback

Không project database cũ nào được tự migrate trong implementation này. Dùng migrate-state --workspace PATH khi không còn active/unknown attempts/jobs và pending publication. V4 writer guard chặn writer3; v4 handoff không tương thích writer cũ. Backup được ghi trước migration và guard/state đổi cùng transaction.

Đối với **v3** đang còn việc: emergency control-task/reconcile-state/observe-job/recover-publication vẫn có chế độ tương thích hẹp, có backup trước thao tác. Nó giữ schema/config v3, không cho dispatch hay activation extension; sau khi xử lý xong dùng một lệnh migrate-state mới. State v1/v2 chưa resolved cần xử lý bằng release tương thích trước; không ép migrate tiến trình đang chạy.

Rollback extension: khi idle, sync về config/lock revision cũ và giữ receipts/history. Không mở state4 để ghi bằng code0.5; muốn rollback code cần restore backup vào workspace riêng. Không xóa job unknown hoặc journal để bỏ qua fence.

## Verification và giới hạn

[Static preflight](verification/extensions/preflight.json) kiểm exact Codex binary và schema sinh lại ngày 28/10; không tạo native thread/turn. **204/204 tests pass, 65 JavaScript và 4 Python syntax checks**, mock recovery pass; [software evidence](verification/v1-evidence.json) và [tests](../test/extensions.test.mjs) ghi tests thực sự chạy. Các golden figures/pages là fixture kiểm phần mềm, không phải nghiên cứu hoặc benchmark model.

Trước thread/start, driver kiểm config/read và hooks/list để chặn ambient MCP/hooks có thể khởi động ngoài scope. Apps/plugins/memories/delegation được tắt từ process startup. Native driver render helpers theo profile, tắt native network và extra writable roots, kiểm sandbox receipt rồi skills/hooks/MCP inventory trên đúng connection trước turn/start. Inherited extras, field/method thiếu hoặc catalog không chứng minh được scope sẽ fail closed. Ví dụ để allowlist rỗng; không tự bật global plugins hoặc suy native pass từ schema. Một task thật được phép và đúng profile có thể cung cấp evidence native còn thiếu; benchmark cố ý vẫn cần protocol/xác nhận riêng.

Giới hạn hiện tại: public/keyless retrieval với pagination hạn chế; chưa implement credential binding cho OpenAlex account paging. DOI redirects chỉ tới metadata origins được review, không tự truy cập publisher bất kỳ. Không API-credit/GPU meter, external MCP execution, native skill-loader acceptance, Claude/AGY bindings hoặc proof checker tổng quát mới. Finite AST/byte/deadline bounds không là OS memory sandbox cho mọi thư viện. Native effective permissions và live behavior còn cần trace; software pass không chứng nhận scientific quality/novelty.

## Bàn giao EX0–EX5

| Slice | Implementation/evidence |
|---|---|
| EX0 | Exact binary/schema metadata, upstream commit/license và package versions đã chốt; native effective scope chưa live-verified |
| EX1 | Profile/manifest/lock/task scope, state/handoff4, writer fence và legacy-v3 rescue |
| EX2 | Project-local environment đã provision; second provision reused; frozen wheel lock và staging failure checks |
| EX3 | Scoped helper callback/CLI, private inputs, job/call envelopes, receipts, cancellation và journal publication |
| EX4 | Scholarly/bibliography/math/stats/figure/PDF slice và progressive references |
| EX5 | Software/static verification và docs; human/native acceptance pending |

EX6/backend khác và E04–E06 theo dự án vẫn ngoài scope bàn giao. Không cần benchmark novelty hoặc cả ba backend để nghiệm thu phần mềm này.
