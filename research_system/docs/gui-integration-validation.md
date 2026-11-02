# Xác minh hướng GUI integration và inspect

Ngày 29/10/2026. Đọc lại nguồn sơ cấp và source trước cập nhật [plan bản 2](plugin-integration-plan.md). Đây là research/metadata, chưa phải nghiệm thu GUI hoặc live worker. Các đề xuất bên dưới là suy luận thiết kế của dự án.

## Những điểm đã xác minh

| Nguồn đã mở và đọc | Điều tài liệu xác nhận | Quyết định cho hệ thống |
|---|---|---|
| [Codex plugin packaging](https://developers.openai.com/plugins/build/plugins) | Có manifest portable, skills/MCP; plugin repo bật/tắt qua config của trusted project; local install có bản cache riêng | Plugin hữu ích cho phân phối. File nguồn mới không đảm bảo bản GUI đang load đã cập nhật; inspect cần version/source và loaded receipt |
| [Codex advanced config](https://learn.chatgpt.com/docs/config-file/config-advanced) | Có project config layers nhưng project chưa trust bị bỏ qua; một số provider/auth/profile keys không được project override | Conversational configuration cần phân loại core settings và host settings; không hứa tùy chỉnh bất kỳ host field nào ở project scope |
| [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) | Custom agents có model/instructions; kế thừa parent permissions/provider/MCP. Prompt read-only không tạo sandbox read-only riêng | Native subagent phù hợp khi task chấp nhận quyền kế thừa; yêu cầu sandbox hẹp hơn cần provider có enforcement tương ứng hoặc managed worker |
| [Codex App Server](https://learn.chatgpt.com/docs/app-server) | Có config/read, MCP status theo thread, config reload; app metadata khác enabled/callable state | Dùng API đúng connection/thread cho inventory. Không suy App Server mới là connection của GUI đang mở; config/read là effective on-disk config, không chứng minh mọi turn đã reload |
| [Claude Code Desktop](https://code.claude.com/docs/en/desktop) | Desktop dùng shared instructions/settings và MCP. Local Code tab còn nhận MCP từ desktop chat config; ưu tiên khi trùng tên có thể khác CLI | Host adapter phải ghi surface và nguồn thắng. Không tự áp precedence CLI cho Desktop; không đánh đồng Code tab, chat, SSH và cloud |
| [Claude subagents](https://code.claude.com/docs/en/sub-agents) | File agent hỗ trợ scope/model/tools/MCP; plugin subagent bỏ qua hooks, mcpServers, permissionMode trong frontmatter | Khi cần scope này, ưu tiên project agent definition hợp lệ hoặc managed worker. Đóng gói mọi agent vào plugin có thể làm mất cấu hình mong muốn |
| [Antigravity MCP](https://antigravity.google/docs/mcp) | App có MCP settings; CLI có global/workspace configs, local stdio và remote transport, trạng thái trong manager | MCP là lựa chọn nối công cụ; adapter phải phân biệt App/CLI/IDE. Một config file không tự chứng nhận connection hiện hành |
| [Antigravity plugins](https://antigravity.google/docs/plugins/) | Tài liệu có cài theo surface; CLI có plugin list --json với enabled/version/components/path | Có thể tái dùng machine inventory thay tự dựng catalog; output CLI vẫn là CLI scope, không chứng minh GUI đã load |
| [Antigravity subagents](https://antigravity.google/docs/subagents/) | App có native invoke, nhiều workspace modes, child khởi đầu không có conversation history và kế thừa safety scope | Truyền packet theo task, không giả full-history fork; workspace mode và permission scope phải có receipt |
| [MCP tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) | Server công bố tools qua protocol; client quyết định tương tác và hiển thị | MCP là transport dùng chung. Spec này không thiết lập một API để server liệt kê toàn bộ sibling servers/plugins của host; deep inspector cần host adapter |

## Kết luận sửa so với plan trước

1. **GUI-first, packaging tùy chọn.** Một entry skill/guidance và CLI hoặc MCP có thể nối GUI với core. Chọn transport theo supported surface và lợi ích; không mặc định plugin bắt buộc hoặc CLI luôn rẻ hơn.
2. **Giữ native và managed cùng tồn tại.** Native có lợi về UX/context/lifecycle; managed giữ portability, strict scope và cross-backend. Không có nguồn trên chứng minh một provider native tự điều phối đầy đủ provider khác theo contracts của hệ thống.
3. **Inspect không là toàn quyền đọc host.** Hiển thị declared/selected/observed và coverage. Unknown là kết quả hợp lệ; dữ liệu cũ có timestamp/scope. Kết nối từ GUI tới core không cấp ngược quyền điều khiển App Server của GUI.
4. **Host config không portable theo từng field.** Core config portable; render host bindings theo capability, không copy nguyên schema hoặc overwrite global defaults. Project overrides không vượt managed requirements.
5. **Không chứng minh tiết kiệm quota bằng docs.** Dùng scripts deterministic, packet nhỏ, bounded results và reuse services; đo latency/context/process overhead trong sử dụng. Cần request riêng nếu làm benchmark so sánh có model.

## Đối chiếu source đang có

- `scripts/harness.mjs`: command router hiện hữu, chưa có inspect-project/shared GUI attachment. Thêm transport bằng cách tái dùng validation/services thay duplicate business logic.
- `store.mjs`: constructor ghi PRAGMAs/CREATE TABLE; inspector phải có đường đọc SQLite riêng, không gọi constructor có side effects hoặc migration.
- `config.mjs`: loadConfig chuẩn hóa và xác minh config/skills/extensions; lỗi file/env hiện có thể chặn load. Inspector cần error envelope và đọc persisted config độc lập, không giả raw config đã valid.
- `engine.mjs`: attempt lưu config hash và effective model/skills/budget; đây là nguồn frozen config của attempt, không lấy config mới thay lịch sử.
- `extension-native.mjs`: scope receipt có checked_at và inventory; kiểm guard trên worker connection. Đó là bằng chứng lịch sử có phạm vi, không phải inventory toàn máy.
- `adapters/index.mjs`: capabilities là khai báo adapter, không là metadata chứng minh binary cài sẵn chạy được.
- `improvements.mjs`: project overlay đang có; cần thêm provenance vào inspect, giữ source và overlay revision phân biệt.

## Metadata cục bộ kiểm lại trong lượt này

| CLI | Version trả về | Kết luận được phép |
|---|---|---|
| Codex executable cài trong app | 0.165.0-alpha.1.2 | Version đọc được, có cảnh báo quyền temp/PATH alias |
| Claude | 2.1.310 | CLI version, không là desktop build receipt |
| AGY | 1.4.7 | CLI version, không là App/IDE inventory |

Chỉ chạy --version. Chưa chạy plugin list, connection discovery, loader activation, native turn hoặc inference; những thao tác discovery có thể khởi động MCP nên cần phân loại side effects trước khi tích hợp. Không nâng cấp hay thay pin. Đây là versions cài trên máy tại thời điểm kiểm, không khẳng định là release mới nhất toàn cầu.

## Những điểm phải xác minh khi implementation

- GUI surface thực tế có đường CLI/stdio/MCP và project binding nào; host identity có xác thực hay chỉ local attachment ID.
- Có thể lấy inventory từ đúng session bằng API hỗ trợ không; nếu không, dùng persisted observations và unknown. Không reverse-engineer private sockets để lấp khoảng trống.
- Native admission/control/events có bao phủ child/descendant và usage không; nghiệm thu theo task requirements.
- Reload boundaries, config source precedence, trust và deployment paths theo build cài tại thời điểm đó.
- Khả năng hiển thị terminal của GUI: nếu host không mở panel được, cung cấp lệnh/path cho terminal ngoài; không tạo LLM turn nền để refresh.

Mức bằng chứng phải ghi riêng: documentation, installed metadata, software conformance, live observation. Chỉ những mục có live trace tương ứng mới được gọi là đã nghiệm thu trên host.
