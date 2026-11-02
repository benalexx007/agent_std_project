# Capability contract — implementation entry, 29/10/2026

Đọc cùng [research](gui-integration-validation.md). Documentation và installed versions không là live verification. Đây là quyết định route cho triển khai, không thêm permissions hoặc tự enable backend.

| Boundary | Codex GUI | Claude Code Desktop | Antigravity App/IDE |
|---|---|---|---|
| Entry | Project guidance/skill → CLI trước; MCP khi cần structured tools | Project guidance + shared services, host binding tiếp theo | Project guidance + shared services, surface binding tiếp theo |
| Packaging | Plugin optional; không bắt root GUI đi qua managed App Server | Plugin optional; agent fields bị ignored phải xử lý bằng project definitions/managed | Plugin optional; CLI/App/IDE inventory tách biệt |
| Root model | Unknown cho đến host receipt; config không đổi GUI picker | Unknown; model mapping chưa chốt | Unknown; model mapping chưa chốt |
| Native subagent | Conditional: model/instructions được hỗ trợ; quyền kế thừa không thay scope độc lập | Conditional: áp đúng agent scope, tránh plugin fields bị bỏ qua | Conditional: verify workspace mode; không giả inherited conversation |
| Liên backend | Managed adapters giữ nguyên, external execution cần policy cho phép | Cùng core/managed adapters | Cùng core/managed adapters |
| Hard budget/control | Chỉ guaranteed trong boundary core/provider thực sự kiểm soát; unknown descendants không auto retry | Tương tự | Tương tự |
| Inspect baseline | Offline persisted config/task/attempt receipts, GUI unknown | Tương tự | Tương tự |
| Deep inventory | Chỉ đúng App Server connection/thread nếu có đường supported; subprocess mới không là GUI | Resolver theo Desktop precedence, không áp CLI rules mặc định | CLI plugin list chỉ là CLI scope; App/IDE phải có receipt riêng |

Native route eligibility: requirements của task phải có evidence tương ứng về model, instruction loading, permissions/workspace, lifecycle/control, results và accounting coverage. Thiếu không tự giảm yêu cầu task. Dùng managed khi đáp ứng được; nếu cả hai thiếu thì báo blocked capability. Không lấy boolean declared adapter capability làm live receipt.

Đã chọn entry/CLI route và implementation [0.7.0](gui-integration.md): project bindings, native observations và managed fallback. Gate còn mở: actual GUI loader/identity, native events/usage/control verification. MCP loader không áp dụng khi chưa chọn MCP. Inspect không cần chờ các gate này và không tạo native connection. GUI observations là local attestations; không xác minh current model/tool inventory hoặc OS isolation. Hard requirements/scoped helpers/benchmarks không được native-observed route chấp nhận.
