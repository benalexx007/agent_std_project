# Khả năng tích hợp và giá trị thực tế — khảo sát 27/10/2026

Tài liệu đầu vào cho [plan bản 4](runtime-integration-plan.md). Đây là nghiên cứu tài liệu/source và quyết định thiết kế; không phải kết quả benchmark. Các capability mới bên dưới chưa được implement hoặc live-verify chỉ vì xuất hiện trong roadmap.

## 1. Phiên bản và độ tin cậy của bằng chứng

Đã kiểm lại bằng lệnh version trên máy ngày 27/10: Codex CLI **0.164.0-alpha.11.1**, Claude Code **2.1.310**, Antigravity CLI **1.4.7**. Lệnh Codex có cảnh báo không tạo/dọn được PATH aliases/temp trong sandbox; vẫn trả version, không chứng minh chạy inference.

| Nguồn công bố kiểm tra ngày 27/10 | Quan sát | Cách dùng trong thiết kế |
|---|---|---|
| [Codex latest release](https://github.com/openai/codex/releases/tag/rust-v0.164.0) | Stable 0.164.0; khác channel binary desktop đang pin | Không đổi pin alpha sang stable ngầm. Đánh giá schema của đúng binary triển khai |
| [Claude latest release](https://github.com/anthropics/claude-code/releases/tag/v2.1.311) | 2.1.311; mới hơn local 2.1.310 | Driver mới phải refresh pin và conformance; chưa cài bản mới trong lượt research này |
| [Antigravity changelog](https://antigravity.google/docs/changelog?tab=cli) | Phần CLI còn liệt kê 1.4.0 là latest, trong khi local báo 1.4.7; App 2.26.0 là sản phẩm khác | Ghi discrepancy, không gọi 1.4.0 là binary mới nhất hay hạ local. Refresh release/help/schema trước activation |

Không thể suy ra latest eligible trên máy từ nhãn latest của một channel khác. Tài liệu online hiện hành dùng để tìm cơ hội; version/protocol/OS/auth/model/effective policy của route mới quyết định khả năng dùng được. SDK có version và route riêng, không suy version từ CLI/App. [P0 hiện có](verification/p0-2026-10-27/report.md) chỉ kiểm metadata/static của Codex, không tạo thread hoặc turn.

## 2. Native backend thực sự giúp được gì?

### Codex

[App Server](https://learn.chatgpt.com/docs/app-server) cung cấp lifecycle thread/turn và control. Resume hội thoại dùng lại lịch sử cho turn sau; không chứng minh tự tiếp tục side effect của turn bị ngắt. WebSocket hiện được tài liệu đánh dấu experimental: chưa chọn làm nền bắt buộc cho reconnect production.

[Schema pin P0](verification/p0-2026-10-27/protocol/) cho thấy ThreadResumeParams không có cùng bộ trường như ThreadStartParams, gồm khác biệt dynamicTools và allowProviderModelFallback. Vì vậy cần renderer và kiểm policy riêng cho resume. Có clientUserMessageId không đủ để suy ra submit exactly-once.

[SDK](https://learn.chatgpt.com/docs/codex-sdk) là lựa chọn thay driver khi giảm code mà giữ đầy đủ controls. Python SDK điều khiển App Server và có CLI dependency được pin; phải tính thêm Python và quyền chọn executable. Không chuyển Node core sang Python chỉ để bọc lớp RPC hiện đang nhỏ.

[Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) và [worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees) đáng tận dụng, nhưng capability của desktop không tự trở thành API cho worker ngoài. Agent con không được vượt policy cha; tạo thêm agent vẫn có chi phí. Core cần contract nhóm, không sao chép scheduler/tool loop nội bộ.

**Quyết định:** tiếp tục App Server cho Codex; mở rộng lifecycle quanh driver hiện có. Chỉ thay RPC bằng SDK sau khi đối chiếu callbacks, identity, receipt, auth, version và lượng code thực sự bỏ được. Thu kết quả sau gián đoạn có ưu tiên cao hơn xây daemon reconnect.

### Claude

[Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) cung cấp hooks, permissions, sessions và subagents. Đây là ứng viên thay phần giao tiếp CLI tự viết khi cần callbacks sâu; phải kiểm auth/billing đúng use case, không mặc định SDK dùng được gói subscription CLI.

[Sessions](https://code.claude.com/docs/en/agent-sdk/sessions) hỗ trợ resume/fork; fork lịch sử không fork filesystem. Dùng ID tường minh thay vì “continue session gần nhất” trong môi trường nhiều worker. Budget theo query không thay aggregate budget của core.

[Cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking) phân biệt usage của root với modelUsage/total_cost_usd có children. Không cộng tổng đã bao gồm children lần nữa. [File checkpointing](https://code.claude.com/docs/en/agent-sdk/file-checkpointing) không bao phủ mọi Bash edit hoặc subagent edit; không thay immutable snapshot và portable checkpoint của core.

[Subagents](https://code.claude.com/docs/en/sub-agents) có tools/model/skills/worktree. Phải kiểm baseline worktree thực tế, không giả định luôn là HEAD của cha. Isolation thư mục không tương đương sandbox hệ điều hành.

**Quyết định:** chọn một route chính cho mỗi profile: structured CLI nếu đủ subscription/control yêu cầu, SDK nếu callbacks tiết kiệm phần tự viết và auth được chấp thuận. Không duy trì hai implementation đầy đủ song song chỉ để “hỗ trợ mọi thứ”.

### Antigravity

[Headless](https://antigravity.google/docs/cli/headless/) có input/output streaming và multi-turn; control_request/control_response bị từ chối, không thể dùng adapter control của Claude bằng đổi executable. Usage cumulative cần baseline đúng; exit 0 không đủ chứng minh tool được phép thực thi và output hợp lệ.

[SDK lifecycle](https://antigravity.google/docs/sdk/lifecycle) và [SDK subagents](https://antigravity.google/docs/sdk/subagents) cung cấp lifecycle/hooks và agent con. [SDK overview](https://antigravity.google/docs/sdk/overview/) dùng route API riêng: tính Python, credentials và billing vào quyết định. [CLI subagents](https://antigravity.google/docs/subagents?tab=cli) có workspace/context options, cần kiểm scope của monitor/cancel/accounting trên pin thực tế.

**Quyết định:** structured CLI cho công việc hữu hạn khi đủ contract; SDK chỉ cho profile cần deep control và chấp nhận auth/billing. Không quảng bá live steer từ khả năng stream stdin. Mapping model/effort của Claude và Antigravity còn cần người dùng chọn trước activation.

## 3. Runtime ngoài hoặc mã nguồn tái sử dụng

| Ứng viên | Giá trị thực tế có thể đem lại | Quyết định hiện tại / điều kiện xem lại |
|---|---|---|
| [Orca orchestration](https://github.com/stablyai/orca/blob/main/skill-guides/orchestration.md) | Run/task/dispatch, inbox/ACK, workspace, lifecycle và giám sát cho nhiều CLI; hơn một terminal UI | Có thể làm provider cho workspace/session supervision nếu hợp Windows và giảm được code tương ứng. Không dùng đồng thời hai scheduler/retry owners. Không cần thêm vào Codex slice đã có chỉ để có thêm lớp |
| [Headless](https://github.com/RobertTLange/headless-cli) | Chuẩn hóa nhiều CLI/session/usage, giảm số parser tự duy trì | Cần kiểm allow-mode và billing fallback; không dùng route auto chuyển paid hoặc nới quyền. Xem lại khi thêm backend thật làm chi phí adapter tăng rõ |
| [Paradev](https://github.com/ParadevAI/Paradev) (repo Superset chuyển hướng) | Workspaces/UI cho agent song song | README khảo sát chưa hỗ trợ Windows, không chọn làm runtime bắt buộc trên máy hiện tại |
| SDK/module chính chủ hoặc phần mã nguồn open source có license phù hợp | Giảm custom protocol/lifecycle code, giữ agent loop native | Ưu tiên interface công khai, rồi module nhỏ. Pin version/license/dependencies; không sao chép nguyên backend hoặc suy rằng mọi thành phần sản phẩm đều open source |

Không dùng “không dependency” làm mục tiêu tuyệt đối. Cũng không mặc định thuê một runtime là giảm bảo trì: phải trừ code bỏ được, cộng bridge/policy/storage migration, nâng version, background service, auth và khả năng thoát khỏi runtime đó. Khi chưa có workload/đường API chứng minh lợi ích, để ở danh sách lựa chọn, không cài hoặc viết adapter trước.

## 4. Chênh lệch với source 0.4.0

| Quan sát source | Hệ quả |
|---|---|
| [codex-native](../src/codex-native.mjs) tạo server/thread mới mỗi attempt, tắt agents; finally đóng server | Warm process, reuse thread và native group là ba thay đổi khác nhau; chưa thể bật bằng một cờ resume |
| Usage lấy tokenUsage.total; [native-state](../src/native-state.mjs) giữ binding attempt | Cần registry session và delta baseline/counter epoch trước reuse; không đổi thread/turn của attempt cũ |
| [codex-worker](../adapters/codex-worker.mjs) mở Store từ packet.workspace; [native-tools](../src/native-tools.mjs) đọc project.workspace | Tách control root, execution root và artifact identity trước isolation; đổi cwd riêng sẽ sai DB/provenance |
| [engine](../src/engine.mjs) loại trừ writers đồng thời | Chỉ gỡ exclusion sau khi có workspace lease, publication và conflict handling |
| [store](../src/store.mjs) transaction toàn JSON; [receipts](../src/receipts.mjs) đọc cả file | Tối ưu streaming/snapshot và tần suất giao dịch trước migration toàn storage |
| Context scoped đã có; role/schema có phần lặp trong packet/native instructions | Bỏ truyền trùng và cache immutable bundle; delta phải có baseline, không bỏ nghĩa vụ nghiên cứu |
| [recovery](../src/recovery.mjs) đã giữ completed units/checkpoint và fence unresolved jobs | Mở rộng reconciliation native; không viết recovery engine thứ hai |
| [roles/skills](../domains/research/) chứa nghĩa vụ nghiên cứu cần giữ | Tinh gọn phần protocol lặp; không cắt counterevidence/proof obligations/independent planning để giảm prompt |

## 5. Ma trận 18 capability và lý do tích hợp

“Nền” = cần trong lát cắt nền tiếp theo; “chọn theo việc” = triển khai sau dependency khi có workload cụ thể; “chờ contract” = chưa đủ bằng chứng để chọn route. Đây là kế hoạch, không là trạng thái supported. Mã C nối sang lộ trình và nghiệm thu.

| ID | Capability / tình huống có lợi | Route tối ưu đề xuất và phần core giữ | Chi phí/điều kiện chọn |
|---|---|---|---|
| C01 | Workspace riêng: experiment/code không làm bẩn baseline | Native workspace provider nếu có API; snapshot directory cho non-Git, Git worktree khi có repo; core manifest/lease | Nền cho writers; tránh copy dataset lớn. Không tự git init |
| C02 | Parallel writers: nhiều nhánh độc lập giảm critical path | Core admission theo CPU/RAM/disk/quota, mỗi writer execution root riêng | Chọn theo việc sau C01/C03/C11/C12; không parallel các nhánh phụ thuộc chỉ để tăng agent count |
| C03 | Publication/integration: nhận nhiều output mà không mất baseline/evidence | Core immutable staging + serialized publish journal + base check/conflict | Nền cùng C01; không “copy file cuối cùng thắng”; recovery publish không gọi LLM |
| C04 | Warm process: nhiều turn ngắn trên cùng host | Driver process pool nhỏ, on-demand, idle TTL/count/RAM cap | Chọn theo việc; chỉ giảm startup, không hứa giảm input token; đo startup và RAM từ trace thật |
| C05 | Session reuse: tiếp tục một vấn đề có context tương thích | Native conversation, core compatibility/freshness/budget/history estimate | Chọn theo việc sau C12/C14; default fresh cho nhiệm vụ độc lập hoặc evaluator cần độc lập |
| C06 | Native resume/fork: tiếp tục nhánh nghiên cứu, giữ lựa chọn | Native session ID; portable checkpoint là đường đổi backend | Chọn theo việc; fork history != fork workspace, không đổi binding attempt cũ |
| C07 | Thu kết quả sau mất liên lạc: tránh làm lại việc đã xong | Native read/history/result + core reconcile/artifact validation | Nền; 0 inference; terminal result chưa đủ giải phóng jobs/reservation nếu chưa rõ descendants |
| C08 | Reconnect turn vẫn chạy: giữ điều khiển khi client đứt | Native stable endpoint/subscription nếu có, core ownership+event reconciliation | Chờ contract ổn định/Windows và nhu cầu. Stdio mới không reattach stdio cũ; không xây daemon chỉ vì có method resume |
| C09 | Tiếp tục công việc đã dừng: khôi phục sau lỗi/quota | Recovery core hiện có + native new turn khi đã reconcile; cross-backend checkpoint | Nền cho recovery; có admission mới và scope cũ, không tự benchmark retry hay replay unknown |
| C10 | Native subagent group: backend tự chia việc nội bộ | Backend agent loop; core nhóm là work unit, giới hạn model/tools/depth/count/time/usage | Chọn theo việc sau C11/C12; output đủ receipt, không mirror mọi bước nội bộ |
| C11 | Descendants/background jobs: dừng và phục hồi đúng | Native registry/stop APIs + OS supervision khi scope yêu cầu | Nền; phân biệt server, turn, subprocess, remote job. Kill parent không là chứng cứ mọi job dừng |
| C12 | Accounting reused sessions/groups: không đếm sai hoặc bỏ sót | Normalizer theo scope/epoch/delta, một reservation ledger core | Nền trước reuse/group; aggregate và child không cộng trùng; unknown không thành 0 |
| C13 | Quota metadata: admission/fallback thực tế hơn | Native read/events, timestamp+pool identity; refresh có TTL | Nền route Codex có metadata; % quota không đổi thành token. Backend khác unknown vẫn theo policy explicit |
| C14 | Incremental/scoped context: dự án dài vẫn giữ frontier cần thiết | Core selector/page/delta + native history, explicit baseline/ACK | Nền scoped/pagination; delta khi reuse. Mất baseline gửi snapshot phù hợp, không silent truncation |
| C15 | Cache schema/roles/skills: bớt I/O và prompt lặp | Immutable hash cache + backend renderer + progressive references | Nền nhỏ; không nhầm cache trên máy với prompt cache/chiết khấu quota; giữ required instructions |
| C16 | Stream hash/snapshot: file thực nghiệm lớn | Stream một lần vào immutable staging, verify byte hash rồi short commit | Nền với C03; không hash ngoài lock rồi nhận live file đã đổi |
| C17 | Lean telemetry/storage: giảm lock/event volume | Coalesce counter, small control reads, bounded diagnostic retention | Nền tối thiểu; hot tables chỉ nếu JSON state thực sự gây bottleneck; không mất critical events/usage |
| C18 | Claude/Antigravity sâu: đa backend thực dụng và tận dụng native tools | Một route chính mỗi profile, CLI hoặc SDK theo contract; renderer chung | Chọn khi có task/model/auth thật. Không thêm cả hai SDK/services trước; portable fallback và roles giữ nguyên |

## 6. Bằng chứng cần bổ sung, không thể suy ra từ tài liệu

- Native child accounting/termination coverage trên đúng version/OS; quota/tokens có đủ attribution không.
- Effective model/permissions/tools sau resume/fork, nhất là field có ở start nhưng không ở resume.
- Session history/compaction tăng bao nhiêu input và có giúp time-to-accepted-result với công việc thật không.
- Native workspace API có hỗ trợ baseline/dirty files/publish cần thiết hay chỉ có UI.
- Runtime/SDK thay thế có giảm custom code và thao tác người dùng sau khi tính bridge, dependencies, auth và upgrades không.

Các điểm này là gate theo profile, không là lý do bắt chạy mọi benchmark ngay. [Protocol nghiệm thu](acceptance-minimal-protocol.md) quy định S0, P0 và trace thật/L1/L2 có điều kiện. Mọi deliberate benchmark phải có tài liệu cụ thể và người dùng duyệt riêng.

