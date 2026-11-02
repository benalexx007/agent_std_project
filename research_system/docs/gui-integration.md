# GUI integration 0.7.0 — sử dụng, review và giới hạn

Ngày 29/10/2026. Đã triển khai đường **project entry skill → CLI service dùng chung → core hiện có**. GUI hiện tại làm orchestrator; không spawn thêm một root planner, daemon, MCP server hoặc runtime ngoài khi attach. Plugin/MCP là lựa chọn phân phối/transport sau này, không cần thiết cho đường kết nối này.

Cập nhật phân công 31/10/2026: orchestrator mặc định analysis/medium. synthesis_planning/highest là cố vấn khoa học riêng, thường researcher, nhận analyses/bằng chứng gốc và trả kế hoạch chi tiết sau independent verification. Không spawn khi chỉ attach/status; gọi khi cần scientific planning/replanning. Cập nhật template không tự sửa snapshot, task hoặc entry skill đã sinh của project cũ; xem [model routing](model-routing.md).

Đây là bản **software preview**: fixtures/regression không chứng nhận GUI đang chạy đã load skill, model, native subagents hoặc quyền. Baseline **29/10** có 225/225 tests pass, 74 JS + 4 Python syntax checks và recovery demo pass; [evidence baseline](verification/gui-evidence.json) giữ 159 source hashes của thời điểm đó, tách khỏi [baseline 0.6.0](verification/v1-evidence.json). Sau sửa phân công/automation **31/10**, [báo cáo mới](verification/advisor-routing-2026-10-31.md) ghi 42/42 tests liên quan pass; full suite 218/231 pass, 13 helper tests lỗi integrity môi trường Python. Nghiệm thu host thật ở [acceptance plan](plugin-acceptance-plan.md); không tự chạy benchmark từ lệnh kết nối.

[Metadata cục bộ](verification/gui-installation-metadata.json): Codex CLI 0.165.0-alpha.1.2, Claude Code 2.1.310, Antigravity CLI 1.4.7; version commands exit 0, Codex có sandbox warnings về temp/PATH alias. Đây không là GUI build/loader verification. [Mẫu inspect 80 cột](verification/gui-inspect-80.txt) và [120 cột](verification/gui-inspect-120.txt) dùng validated candidate chưa init, không mutate state. Human layout review vẫn pending.

## 1. Phân chia trách nhiệm

| Thành phần | Làm gì |
|---|---|
| Backend GUI | Hội thoại, model picker, tool loop, native delegation, hiển thị diff và artifacts |
| Entry skill + connection | Hướng dẫn ngắn, xác định đúng project/Node/script, khám phá action theo nhu cầu |
| GuiService | Binding, schema hữu hạn, kiểm quyền tại transaction, config revisions, async operation handles, native observations, bounded/redacted responses |
| Core/managed runner | Research/planning contracts, model routing, admission/quota, checkpoint/recovery, worker liên backend, isolated workspace và publication |
| Inspect | Đọc snapshot offline, provenance và observations; không query backend hoặc chạy model |

Không xây thêm framework LLM hoặc nhân đôi research/runner state machine. Native route vẫn dùng beginAttempt/completeAttempt và cùng validator. Người dùng trao đổi bằng chat; orchestrator tạo request và gọi script. CLI được giữ để cứu hộ và phục vụ host không có structured tool transport.

## 2. Kết nối project

Node >=24. Từ thư mục research_system, với project đã tồn tại:

```powershell
node scripts/harness.mjs connect-gui --workspace 'D:\projects\study' --backend codex
```

Lệnh chỉ tạo entry files và manifest ở project đích, không init state, không enable execution và không sửa global settings. Nó trả đường dẫn Node thực tế và script; GUI dùng các đường đó, không phụ thuộc PATH hoặc username hard-code.

| Host | Entry được tạo | Phạm vi |
|---|---|---|
| Codex | `.agents/skills/research-project/` | Project discovery theo host/trust; có thể yêu cầu GUI đọc skill trực tiếp |
| Claude | `.claude/skills/research-project/` | Project skill, không dựa vào các trường plugin-agent bị host bỏ qua |
| Antigravity | `.agents/skills/research-project-antigravity/` | Entry độc lập; mặc định manual entry cho đến khi exact App/IDE surface có loader receipt |

Mỗi thư mục gồm SKILL.md, connection.json và host.json. Các hosts có thể cùng dùng project mà không ghi đè entry của nhau. `generated:true` luôn đi cùng `loader_verified:false`. Nếu file đã tồn tại nhưng nội dung khác, lệnh dừng với conflict; không ghi đè customization.

Với project mới, orchestrator tạo config snapshot từ template phù hợp, đặt project.workspace/bundle_root rõ ràng, rồi dùng init. Ví dụ bên dưới minh họa trình tự; không chạy trên state thật chỉ để test:

```powershell
node scripts/harness.mjs init --config 'D:\projects\study\config.json'
node scripts/harness.mjs upgrade-gui --workspace 'D:\projects\study'
node scripts/harness.mjs gui-attach --workspace 'D:\projects\study' --file 'D:\projects\study\.agents\skills\research-project\host.json'
```

Upgrade v4→v5 chỉ khi idle, tạo backup JSON, giữ tasks/attempts/receipts/history, cài SQLite writer guard chặn writer v4 cũ. Không tự migrate khi inspect/attach. Project v4 không dùng GUI services vẫn chạy được. Không downgrade DB thật; muốn quay lại binary cũ thì phục hồi backup ở workspace riêng kèm artifacts tương ứng.

Attach trả attachment ID và đường auth_file, không in token. Credentials đặt trong file, không đưa vào chat, command arguments hoặc handoff. Binding kiểm canonical workspace/project ID/access/owner epoch. Cùng owner epoch có thể có nhiều attachment; takeover dùng claim-owner, sau đó attach lại. Detach chỉ thu hồi binding, không dừng jobs.

Gợi ý khởi đầu trong GUI: “Dùng research-project cho project này. Đọc connection.json, attach đúng workspace, xem status/frontier rồi tiếp tục mục tiêu của tôi.” Nếu host chưa discover entry, yêu cầu đọc SKILL.md theo đường tuyệt đối do connect-gui trả về. Host vẫn phải cấp quyền đọc/chạy script phù hợp; entry không bypass sandbox/trust.

## 3. Giao diện action

```powershell
node scripts/harness.mjs gui-catalog
node scripts/harness.mjs gui-action --workspace 'D:\projects\study' --auth '<auth_file>' --file '<request.json>'
```

Catalog không cần DB, backend, network hoặc inference. Envelope có group/action/data; mỗi action có required/optional fields hữu hạn, không nhận field lạ, prototype keys hoặc request >256 KiB. Nested task/research/result vẫn qua schema core. Có 8 nhóm: project, change, work, research, evidence, capability, decision, diagnostic. Catalog không expose confirmation/answer actions cho agent tự duyệt.

Các CLI core có thể dùng --workspace với state v5 để đọc registered config, thay vì phải phục dựng file config sau mỗi GUI change. Emergency commands tiếp tục dùng --workspace trên state cũ. Init vẫn cần --config; sync-config/legacy overlay activation bị chặn trên v5. Query đọc registered snapshot không thay thế preflight backend/environment thực tế. Snapshot trỏ workspace khác bị chặn cho GUI attach/action và CLI v5 non-emergency; copy DB không tự trở thành project relocation hợp lệ.

Ví dụ request:

```json
{"group":"project","action":"status","data":{}}
```

```json
{"group":"project","action":"frontier","data":{"task_ids":["study_1"],"task_class":"analysis"}}
```

Frontier tải theo scope/dependencies, mặc định class analysis; không phải transcript đầy đủ. Root GUI model vẫn unknown, config chỉ nói lựa chọn mong muốn. Cố vấn planning là task riêng yêu cầu highest tier và independent current-attempt verification; dùng native subagent đáp ứng hoặc managed worker đúng mapping. Metadata frontier không tự đổi model GUI và không thay thế kế hoạch cố vấn đã kiểm chứng.

Mỗi response tối đa 24 KiB; frontier tối đa 4 KiB. Response lớn được export đầy đủ thành immutable content-hash ref, không cắt assumptions âm thầm. Đọc bằng evidence.read với root=workspace, path, offset_bytes và max_bytes<=16384. Root workspace/bundle hữu hạn; không đọc DB, binding credentials hoặc tùy ý control directory qua evidence.read. Cursor tính theo bytes; nội dung trả là preview UTF-8 đã redact, hash chỉ bytes gốc để đối chiếu file, không hứa preview giữ nguyên nội dung nhị phân.

## 4. Tùy chỉnh qua hội thoại

```json
{"group":"change","action":"prepare","data":{"base_revision":1,"patch":{"context":{"max_chars":30000}},"message_ref":"user-request-local-reference"}}
```

Sau preview, apply bằng change_id. Objects merge, arrays replace, null xóa field nếu schema còn hợp lệ; field bắt buộc không tự trở thành default. Config snapshot v5 là nguồn active; file config cũ có thể báo drift, không tự sync. Tasks đã resolve và attempts giữ binding cũ; thay model/spec của task đã đăng ký phải revise rõ ràng. Future task preparations dùng config mới.

Hai changes cùng base không thể cùng thắng. Active/unknown attempts, publication và operation submit_intent/running/unknown hoãn activation; idle GUI attachment không khóa project. Apply bị deferred cần gọi lại ở safe boundary, không có background poll bằng LLM. Rollback chọn revision cũ để tạo change mới, sau apply tăng revision; không xóa lịch sử hoặc hoàn tác side effects nghiên cứu.

Thay execution/autonomy/backends/extensions/budget/quota/workspace policy/project/research profile được phân loại protected. Phải có exact-digest human confirmation qua confirm-gui-change; GUI action không có approved=true và không được tự ký human confirmation. Tệp confirmation gồm change_id, digest, source=human_cli và statement của người dùng. Đây là **local attestation**, không là xác thực con người bằng mật mã: agent/người có shell rộng cùng tài khoản OS có thể đi ngoài core. Không quảng cáo việc tách catalog là security boundary độc lập.

Instruction/skill changes dùng change.overlay: immutable files + feedback refs + passing check evidence, sau đó change.prepare với overlay ID. Config và active overlay pointer commit **cùng một SQLite transaction**. File stage bất biến được kiểm hash trước commit; không cần thêm một journal activation đa tài nguyên vì activation không rewrite host files. Crash trước commit giữ revision cũ, sau commit giữ cặp mới. Publication journal của research outputs vẫn giữ nguyên. activate-improvement legacy bị chặn ở state v5 để không đi ngoài revision history.

Không render hoặc tự áp config model/provider/auth/global permissions của host. Những setting này cần host-supported action/reload và receipt riêng. Generated connection là discovery metadata, không là bản sao cấu hình host độc lập. Effective field sources: project snapshot theo revision/change.patch; task override/spec; attempt effective_config/config_hash; overlay target/hash. Không phục dựng granular provenance trước migration nếu lịch sử cũ không có.

## 5. Native và liên backend

Một bước nhỏ có thể inline, nhánh độc lập có thể native subagent, backend khác dùng managed worker. Ba vai trò là trách nhiệm logic; không bắt ba agents mỗi task.

Native sequence:

1. work.native_assess với task_id, effective.host/model/effort và requirements. Đây là adapter-reported observation, không proof host identity.
2. work.native_prepare với cùng dữ liệu, mode inline/subagent và key. Core admission trước invocation, tạo context_file/execution workspace và submit intent. Task chuyển unknown cho đến observation.
3. GUI invoke native work **một lần**, truyền context và workspace đúng. Bind handle thực tế bằng native_observe event running/unknown.
4. Terminal event completed/failed/cancelled cần descendants_terminal=true, pinned termination evidence, exact handle; completed cần result contract. Không chấp nhận completed sau cancel. Event replay cùng ID/payload idempotent; đổi payload/handle/mode cùng key bị từ chối.

Mất spawn reply không chứng minh chưa chạy. Không auto resubmit/resume native turn. Missing handle/event giữ unknown và reservations. Root GUI Stop không được core tự quan sát qua CLI transport; orchestrator cần explicit work.control và provider termination evidence, hoặc rescue CLI reconcile-state/observe-job. Không giả hook realtime hay interruption guarantee khi host chưa expose.

Native host-attested route không đáp ứng hard_budget/separate_sandbox/guaranteed_interrupt, benchmark hoặc scoped extension profile: assessment chọn managed. Task-declared capabilities cũng được kiểm, không chỉ flags của request; native observed chỉ hứa core checkpoint/boundary checkpoint, không mượn steer/live usage/streaming guarantees từ managed adapter. Nếu managed provider cũng không có capability cần thiết, task vẫn blocked; không giảm requirement. Native packet có execution workspace nhưng không tạo OS sandbox bằng prompt. Ambient MCP/tools của host vẫn unknown. Version/model mismatch không tự cập nhật pin để chạy.

Native result dùng cùng scientific/output validator và isolated publication nếu applicable. Model-authored usage lưu riêng ở gui_provider.reported_result, không được coi là provider usage; accepted usage unknown và accounting dùng reservation estimate. Root GUI usage không tính vào worker totals; tổng project là partial, không cộng inclusive parent/child counters.

Nếu provider tree đã terminal nhưng result không hợp lệ, attempt được settle failed với estimated/unknown usage và giữ raw candidate; không kẹt reservation chỉ vì schema lỗi. Pending publication journal là ngoại lệ: giữ nguyên để recover/rollback, không settle giả rồi chạy worker mới.

Managed sequence: work.register → work.dispatch(task_id,key) → operation handle → work.operation/status. Một detached Node launcher chạy runner hiện có; không giữ GUI request lâu. Cùng key/task revision không spawn lại. Operation log nằm .agentic/gui-operations/ID; no blind retry. Submit intent crash trước spawn có thể còn unknown; operation_reconcile cần launcher termination attestation/evidence và không còn unresolved worker attempts. Nó không tự settle attempt/jobs. Không dùng PID không tồn tại hay mất heartbeat làm proof cây tiến trình đã dừng. Không hứa process sống qua GUI/OS shutdown.

Cross-backend adapters, quota pools, fallback/checkpoints, snapshots/parallel writers và publication giữ nguyên. Cập nhật 31/10/2026: automation mới mặc định Antigravity low=Gemini 3.8 Flash High; explicit backend/task đã đăng ký không tự đổi. Claude và Antigravity highest/medium còn thiếu mapping thì tiered work bị chặn; thin entry không tự chọn model tương đương. Managed run-orchestrator còn cho headless compatibility, GUI không gọi mặc định.

## 6. Research helpers và decisions

Research record/review/export gọi cùng core, giữ primary evidence, giả định, derivation, open proof obligations, experiments, counterevidence và review. Planning completion không bỏ được planning_review. Transport success không nâng scientific support, proof verification hoặc novelty.

capability.list/describe khám phá helper/profile; execute cần worker assignment hợp lệ và scoped core guard. Attach không provision/reinstall environment. Native đủ contract thì dùng native; cần outputs/receipts có cấu trúc thì dùng helper đã pin. Worker không được nhận GUI owner binding; native permission inheritance không chứng minh worker bị chặn công cụ điều phối.

decision.request/pending đưa câu hỏi cho orchestrator hỏi người dùng. Answer-decision là human CLI path hiện có; late answer/revision/decline giữ core guards. CLI transport không có push notification khi GUI idle. Mỗi deliberate live benchmark vẫn cần request/protocol/frozen manifest và separate human confirmation.

## 7. Quan sát, lỗi và gỡ bỏ

```powershell
node scripts/harness.mjs inspect-project --workspace 'D:\projects\study'
node scripts/harness.mjs inspect-project --workspace 'D:\projects\study' --section runtime
node scripts/harness.mjs inspect-project --workspace 'D:\projects\study' --full --format json
node scripts/harness.mjs disconnect-gui --workspace 'D:\projects\study' --backend codex
```

Inspect độc lập, read-only ở v4/v5 và rescue khi config lỗi; hiển thị revision, changes, operation states, frozen attempts và GUI-reported observations với trust/scope/time. Persisted observations không thành current GUI inventory. Không đọc toàn bộ DB/raw logs vào model context.

GUI service errors có correlation, redacted message/stack ở .agentic/logs/gui-errors.jsonl, xoay một previous file quanh 1 MiB. Lỗi ghi log vẫn trả stderr với logging_unavailable; không báo success giả. Managed runner raw receipts/checkpoints có retention riêng; không bị log rotation xóa. Native events/result evidence giữ trong state/receipts, không capture transcript vô hạn.

Disconnect chỉ xóa đúng ba generated files có hash khớp manifest và manifest riêng host. File bị sửa được giữ, lệnh báo conflict; state/artifacts/binding records không xóa. Detach binding và stop/reconcile jobs là thao tác riêng. Update entry: detach nếu cần, disconnect bản chưa sửa, connect bản mới; không edit package cache hoặc global skills. Không tự xóa research evidence để “tinh gọn”.

## 8. Tiến độ nghiệm thu và deletion ledger

| Hạng mục | Evidence/ranh giới |
|---|---|
| PG0 | Research/route contract theo source; CLI transport đã chọn, no MCP/plugin dependency |
| PG1a/PG1b | Offline inspect + schema5 migration, writer guard, attachment/CAS/frozen config/rollback fixtures |
| PG2 | Entry/connection/catalog/bound service implemented; GUI loader thực tế chưa verified |
| PG3/PG4 | Async managed/native-observed/research/helper/overlay bindings, cùng validators; fixture coverage |
| PG5 | Live Codex acceptance chưa chạy; dùng trace thật được phép hoặc một request riêng; không lấy fixtures thay thế |
| PG6 | Ba host entries dùng core chung; AGY manual-entry, loader/native scope và mappings phải verify khi dùng |
| PG7 | Install/update/uninstall/migration/known limits và evidence; full regression tại mốc release |

Deletion ledger: extracted normalizeConfig để service/CLI dùng cùng validator; chặn v5 sync-config/legacy overlay activation thay bằng versioned change; root GUI bỏ managed-orchestrator bootstrap bắt buộc. Không xóa runner/adapters/old schema control vì chưa có replacement live evidence cho mọi requirement. Không thêm MCP, hook polling, TUI hoặc warm session loop. Source tăng có chủ đích cho state/service/fixtures, không tuyên bố giảm token/quota bằng số dòng code.

Software coverage A01–A06/A13–A15 dùng gui.test; A16–A18 dùng inspection.test; A07–A12 reuse engine/recovery/native/workspace/research/planning/extensions/operational regression. Host trust/inventory fixtures không chứng minh host thực thi trust thật; phần đó vẫn PG5/PG6. Cách tái tạo evidence: `node scripts/verify-v1.mjs --gui`. Không cần chạy lại benchmark nghiên cứu để nghiệm thu core.
