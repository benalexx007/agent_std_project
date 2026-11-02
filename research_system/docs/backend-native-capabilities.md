# Backend native: capability và quyết định tích hợp

Ngày khảo sát: 26/10/2026; cập nhật nghiên cứu 27/10/2026 cho [plan bản 4](runtime-integration-plan.md). Source 0.5.0 có [workspace/publication và native collect/quota foundation](integration-foundation.md), kế thừa [Codex native điều phối](codex-native.md) với mức fixture-verified và [P0 metadata/static lịch sử source 0.4.0](verification/p0-2026-10-27/report.md); chưa live-verified bằng inference. [Khảo sát bổ sung và ma trận C01–C18](capability-integration-research.md) là decision record mới cho workspace/session/group/recovery, khác biệt SDK và phần code cần thay. Bảng khả năng vendor không đồng nghĩa đã implement.

## 1. Mốc phiên bản và mức bằng chứng

| Backend / giao diện | Bản công bố mới nhất đã kiểm tra | Nguồn |
|---|---|---|
| Codex CLI / App Server đi kèm | 0.164.0, 23/10/2026 | [OpenAI changelog](https://developers.openai.com/codex/changelog) |
| Claude Code CLI | 2.1.311, kiểm tra latest ngày 27/10/2026; local còn 2.1.310 | [Claude release](https://github.com/anthropics/claude-code/releases/tag/v2.1.311) |
| Antigravity CLI | Changelog vẫn ghi 1.4.0, 16/10/2026; local 1.4.7. Chưa giải quyết discrepancy release/channel | [Google changelog](https://antigravity.google/docs/changelog?tab=cli) |
| Antigravity App | 2.26.0, 22/10/2026 | [Google changelog](https://antigravity.google/docs/changelog) |
| Antigravity Python SDK | Mốc khảo sát 26/10: 0.1.22, 12/10/2026; cần refresh package pin trước khi chọn SDK | [Google SDK changelog](https://antigravity.google/docs/changelog?tab=sdk) |

Đây là snapshot latest-published, không là cam kết release đã rollout tới mọi account/OS. Docs hiện hành có thể mô tả tính năng khác channel/version. Trước implement một driver: đọc lại release mới nhất, pin binary/package/protocol tương ứng, ghi khác biệt, kiểm contract mà không gọi model. Không tự update máy hoặc chuyển sang prerelease chỉ vì có số phiên bản cao hơn.

Khảo sát local ban đầu thấy Codex 0.164.0-alpha.11.1 và agy 1.0.14. Sau cập nhật đã đọc version của agy 1.4.7 và Claude Code 2.1.310; Claude có binary trong user .local/bin dù PATH phiên cũ chưa nhận. Source 0.4.0 pin đúng chuỗi Codex CLI đi kèm desktop; không dùng mốc latest-published cũ để tự hạ phiên bản đã cài. Help/version và schema generation không phải live inference.

Mỗi capability phải ghi: backend, interface, version/channel, host OS, auth/billing route, model/effort nếu liên quan, cấu hình hiệu lực, phạm vi parent/children và bằng chứng. Trạng thái riêng: documented, source-reviewed, fixture-verified, live-verified, unsupported hoặc unknown. Ghim URL/ngày/schema hash; không lấy một cờ supported cho toàn bộ hãng.

## 2. Các khả năng native đáng khai thác

| Giao diện | Bằng chứng từ tài liệu | Quyết định thiết kế |
|---|---|---|
| Codex App Server | Thread/turn, resume/fork, steer/interrupt, approvals, outputSchema, usage/rate-limit events | Route đầu tiên để giải quyết HITL và phiên liên tục; stdio local trước, một process on-demand; chỉ dùng method của protocol đã pin |
| Codex exec / SDK | Luồng lập trình cho công việc hữu hạn, kết quả/stream và phiên | Giữ exec cho unit ngắn nếu đủ; SDK là lựa chọn khi giảm code, không cài song song nhiều client cùng làm một việc |
| Claude CLI | stream-json vào/ra, resume, json-schema, effort, max-turns/max-budget | Route CLI trực tiếp cho subscription-compatible workflow; dùng ID cụ thể, giới hạn và schema theo version |
| Claude Agent SDK | Sessions, hooks, permissions, subagents, MCP | Chọn nếu callbacks/control giảm đáng kể code hoặc đáp ứng yêu cầu CLI chưa đủ; xác minh auth/billing riêng trước activation |
| Antigravity CLI | Streaming stdin, JSON/schema, effort, conversation ID | Nâng thiết kế từ argv/text lên structured transport khi bản đã pin hỗ trợ; multi-turn chưa đồng nghĩa mid-turn control |
| Antigravity SDK | Stateful harness, tools/policy/subagents | Optional khi cần API điều khiển sâu; tính cả Python/runtime và API route vào chi phí |
| Native UI | Review, artifacts, agent panels, remote interaction | Có thể dùng để người dùng quan sát; không coi UI event là API machine-readable nếu không có contract |

Nguồn cho Codex: [App Server](https://learn.chatgpt.com/docs/app-server), [SDK](https://learn.chatgpt.com/docs/codex-sdk). Nguồn cho Claude: [CLI](https://code.claude.com/docs/en/cli-reference), [SDK](https://code.claude.com/docs/en/agent-sdk/overview). Nguồn cho Antigravity: [headless](https://antigravity.google/docs/cli/headless/), [SDK](https://antigravity.google/docs/sdk/overview/).

Các lựa chọn trong cột cuối là đề xuất của hệ thống, không là tính năng đã có. Chưa chọn model tương đương cho Claude/Antigravity; route dùng model phải có mapping rõ trước chạy.

## 3. Giới hạn cần phản ánh trong adapter

- Codex: steer gắn active turn, không là cách thay model/quyền giữa lượt. Catalog không xác nhận quyền chạy model của account. Custom agent không thể tự override mọi sandbox/approval/MCP setting của parent; khi cần ranh giới quyền khác, tạo root session phù hợp. [App Server](https://learn.chatgpt.com/docs/app-server), [custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents).
- Claude: result.usage chỉ tính main loop; modelUsage và total_cost_usd gồm children. Normalize theo phạm vi, không cộng cả aggregate lẫn từng child. [Usage](https://code.claude.com/docs/en/agent-sdk/cost-tracking).
- Claude: native Windows không có shell sandbox như macOS/Linux/WSL2. Permission rules, worktree và sandbox là ba cơ chế khác nhau. Route yêu cầu OS sandbox phải chọn môi trường đáp ứng hoặc báo unsupported. [Sandbox](https://code.claude.com/docs/en/sandboxing).
- Claude bare mode bỏ nhiều discovery, nhưng cũng thay auth và khả năng background. Không dùng như tối ưu mặc định cho subscription/native delegation. SDK auth được đánh giá riêng. [Headless](https://code.claude.com/docs/en/headless), [SDK authentication](https://code.claude.com/docs/en/agent-sdk/overview).
- Antigravity streaming CLI không nhận control_request/control_response; usage của phiên có thể lũy kế. Soft-denied tool có thể đi cùng exit 0. Vì vậy cần kiểm tool/result evidence và adapter control semantics. [Headless](https://antigravity.google/docs/cli/headless/).
- Antigravity changelog có sửa retry/background lifecycle và thay timeout print mode, trong khi bảng docs còn có giá trị cũ. Pin timeout tường minh, verify help/schema của binary; không dựa vào default. [Changelog](https://antigravity.google/docs/changelog?tab=cli).
- Antigravity SDK quickstart dùng Gemini API key. Không tự coi đó là cùng quyền truy cập/thanh toán với CLI login. [SDK quickstart](https://antigravity.google/docs/sdk/overview/).

App/SDK/CLI có thể chia sẻ agent harness nhưng không mặc nhiên chia sẻ toàn bộ API, model entitlement, context hay permission. Có cùng model name cũng chưa chứng minh cùng billing pool.

## 4. Chọn native hay wrapper

Giả thuyết mặc định: native tiết kiệm tổng chi phí vì tận dụng lifecycle/context/tool loop do nhà cung cấp duy trì. Đây là prior để chọn phương án đầu, chưa là kết quả đo.

So sánh trên cùng yêu cầu và quyền: công viết/bảo trì driver, dependencies/services, cold start, RAM/I/O, token của prompts/children/compaction, chi phí làm lại/phục hồi, thao tác người dùng, auth/billing và khả năng bỏ integration. Không quy tất cả thành một điểm hoặc phần trăm thiếu số liệu.

Decision record chỉ cần: yêu cầu còn thiếu; các route đã xem; bằng chứng tĩnh/trace thực tế; chi phí thêm và phần code bỏ được; lựa chọn; uncertainty; điều kiện xem xét lại. Ưu tiên theo thứ tự:
1. Script thuần code khi không cần suy luận.
2. Giao diện native đơn giản nhất đáp ứng scope.
3. SDK native khi lợi ích control/hooks vượt phần dependency thêm.
4. Runtime ngoài khi có capability hoặc lợi ích vận hành cụ thể mà native route khó đáp ứng.

Có thể đảo thứ tự khi bằng chứng đủ: native API đổi thường xuyên làm driver khó bảo trì; remote jobs không reconcile được; cần UI/workspace coordination mà wrapper đã làm tốt; SDK kéo thêm billing/environment không phù hợp; wrapper gom nhiều backend mà giữ đầy đủ semantics. Không cần benchmark A/B để chấp nhận một lợi ích có thể kiểm bằng source/contract. Khi chỉ còn bất định về tốc độ hoặc chất lượng, dùng telemetry công việc thật trước.

Headless/Orca/Cezar vẫn là ứng viên ngoài, chưa thuộc đường mặc định. Kết luận source ở commit cũ trong plan là lịch sử khảo sát; trước chọn wrapper phải refresh source/release. Không gọi chúng kém hơn native ở mọi trường hợp.

## 5. Vai trò, skill và delegation portable

Canonical specification của project chứa role, task class, skill refs, output contract, tools/permissions, context mode và resource policy riêng biệt. Override từ prompt được điều phối chuyển thành config có revision; không cho prompt tự nâng quyền/budget. Renderer theo backend/version sinh project-scoped bundle, manifest/hash, không sửa config toàn máy.

Nguồn native: [Codex agent TOML](https://learn.chatgpt.com/docs/agent-configuration/subagents), [Claude subagent definitions](https://code.claude.com/docs/en/sub-agents), [Antigravity agents](https://antigravity.google/docs/subagents). Format và precedence khác nhau; phải kiểm effective config, không chỉ file đã viết. Field không map được phải được nêu unsupported; không bỏ im lặng.

Role selection không thay model policy. Cập nhật 31/10/2026: cố vấn synthesis_planning=gpt-6-astra/high, orchestrator/analysis=gpt-6.1-sol/high, automation mặc định Antigravity gemini-3.8-flash-high/high. Codex GUI gọi automation qua managed cross-backend worker, không giả native child; explicit/frozen selection giữ ưu tiên. Định nghĩa native phải ghi cả model và effort cần thiết, kiểm inheritance/override. Skill catalog chỉ mang metadata; nạp tài liệu đầy đủ khi cần, giữ nguồn primary/evidence truy xuất được.

Hai mode đề xuất, chưa là config đã implement:

| Mode | Ownership | Phạm vi phù hợp |
|---|---|---|
| harness_workers | Core gán unit và quản lý từng root worker; worker không tự mở cây ngoài policy | Cross-backend, reviewer độc lập, quyền riêng, fallback theo unit |
| native_group | Core giao một unit/budget; backend parent quản lý các subtasks nội bộ trong scope đó | Việc con cùng backend, read-heavy hoặc có isolation thích hợp |

Không mở nested delegation không giới hạn. Khởi đầu native_group depth=1, concurrency=2 là trần thiết kế có thể cấu hình, không phải default của nhà cung cấp. Task nhỏ vẫn một worker. Nếu backend không enforce/observe được trần thì giữ route không delegation hoặc từ chối profile cần nó.

Gate để bật native_group:
- Biết child identity, parent/root, model/effort hiệu lực, workspace và quyền; kiểm child spawning trước khi cho phép hoặc giới hạn bằng primitive native đáng tin.
- Usage phủ toàn nhóm; nếu chỉ có aggregate đủ phạm vi thì có thể quyết toán cấp nhóm, không bắt per-child token hoàn hảo. Mức attribution thiếu được ghi unknown. Nếu coverage tổng không đủ thì profile có hard requirement không được bật.
- Cancel/reconcile có phạm vi nhóm, biết child/external job còn sống; parent finished không đóng reservation khi descendants chưa rõ.
- Core không retry unit khi backend vẫn đang xử lý retry nội bộ. Phân biệt request retry bên trong turn và relaunch business unit; nếu runtime không xuất từng retry, ghi coverage thiếu và áp deadline/allowance cấp nhóm.
- Native child chỉ cung cấp artifact/findings; không tự approve benchmark, thay policy hoặc publish scientific verdict vượt contract.

Cờ capability native_subagents=false hiện tại là metadata của adapter, chưa là enforcement. Driver mới phải tắt native delegation bằng setting/tool restriction đúng version cho harness_workers. Nếu không xác minh được thì không quảng cáo strict-disabled.

## 6. Session, hooks và phần core giữ lại

Native session state dùng cho hội thoại; core giữ task/revision/decisions, provenance, budget và portable handoff. Session ID không thay checkpoint khoa học. Checkpoint giữ raw refs, assumptions, counterevidence, unfinished work, jobs và acceptance còn lại.

Tái dùng session khi scope/bundle/model/quyền phù hợp; một active turn, warm TTL hữu hạn và giới hạn số session/RAM. Mặc định không giữ process khi không có chuỗi việc liên quan. Thay native session hoặc chuyển hãng dùng handoff có phạm vi. Reviewer độc lập không nhận transcript suy luận của implementer chỉ để tận dụng cache.

Compaction native được cho phép theo capability; checkpoint trước boundary quan trọng, ghi compaction event khi có và bổ sung lại obligations cần thiết từ core. Không thêm một LLM summarizer của harness chạy trùng sau mỗi native compact.

Native hooks có thể báo tool/child lifecycle; callbacks phải bounded, idempotent và trả trạng thái rõ. Hook fail không được lặng lẽ mở policy gate. [Claude hooks](https://code.claude.com/docs/en/agent-sdk/hooks), [Antigravity policies](https://antigravity.google/docs/sdk/policies/).

Khi cần nạp record hoặc lưu checkpoint giữa lượt, dùng tool/callback được backend hỗ trợ, giới hạn theo attempt/generation. Ưu tiên command handler/local stdio khi đủ; không cần gateway mạng chỉ để gọi core. Chỉ cung cấp MCP tool surface nhỏ khi backend thực sự cần; không đưa toàn database vào context, không cấp worker quyền ghi SQLite trực tiếp.

Native approval/plan/review không thay project approval, benchmark confirmation hoặc independent planning_review. Trace đọc file là bằng chứng thao tác; nội dung lập luận vẫn cần review khoa học. Native memory chỉ dùng như gợi ý có nguồn; không tự biến thành evidence đã chấp nhận.

## 7. Tối ưu và điều kiện chọn lại

P0: native events thay polling liên tục; schema output qua interface native nhưng validator core giữ nguyên; role/skill nạp theo nhu cầu; session reuse có scope; admission/usage tính cả children và native overhead; script không gọi model. Không hạ model tier đã thống nhất để đạt mục tiêu token.

Đọc telemetry sẵn có theo event/boundary; không query quota mỗi chunk hoặc dùng model hỏi status. Chuẩn hóa counters có session epoch/cursor và ownership; giữ unknown khi thiếu. Native compaction, tool retries, policy classifier, title/summary/background jobs có thể tạo chi phí ngoài final answer: dùng aggregate coverage thực tế, không coi chúng miễn phí hoặc tự disable policy an toàn để tiết kiệm.

Theo dõi time-to-accepted-result, token/rework, control responsiveness, resource high-water marks, lỗi và công sửa adapter trong sử dụng. Chỉ thêm phép đo riêng khi nó quyết định một thay đổi cụ thể. Không chọn wrapper hoặc giữ native chỉ vì đã đầu tư vào nó.

Thứ tự rollout: core và native contract chung -> Codex native profile -> Claude/Antigravity khi cần và có model/auth mapping -> wrapper khi decision record chứng minh lợi ích. Mỗi profile có activation riêng theo [protocol nghiệm thu tối thiểu](acceptance-minimal-protocol.md).
