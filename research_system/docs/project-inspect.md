# Terminal project inspection — implementation

Ngày 29/10/2026. Inspector hỗ trợ v4/v5, gồm GUI revision/change history/operations và native host-attested observations. [GUI services đã implementation](gui-integration.md); host loader/native verification vẫn pending. Không suy MCP, authenticated identity hoặc current GUI inventory từ inspector.

Từ research_system chạy:

```text
node scripts/harness.mjs inspect-project --config examples/research.json
node scripts/harness.mjs inspect-project --workspace PATH
node scripts/harness.mjs inspect-project --workspace PATH --full
node scripts/harness.mjs inspect-project --workspace PATH --section skills
node scripts/harness.mjs inspect-project --workspace PATH --format json
```

Không truyền source thì dùng current directory làm workspace. Chọn đúng một --config hoặc --workspace. Sections: project, config, models, roles, skills, capabilities, policy, runtime. --section cho chi tiết nhóm đó; --full lấy toàn bộ config và bỏ giới hạn lịch sử 10 rows. JSON có report_version, snapshot_at, coverage, errors/warnings và sections; các danh sách phân trang có total/omitted/rows. Các field chưa được runtime ghi nhận trả unknown/null, không suy từ defaults hiện tại.

Registered config là nguồn hiển thị chính nếu có DB. Candidate config khác sẽ báo drift; không sync. Candidate valid nhưng chưa init được ghi validated_candidate_not_active. Nếu file không parse được, dùng --workspace để xem persisted config; nếu DB lỗi nhưng candidate valid vẫn trả candidate kèm lỗi. Exit 0 khi đọc scope thành công (GUI unknown là bình thường), 1 khi nguồn lỗi/thiếu, 2 khi CLI syntax sai. --execute bị từ chối.

Đọc SQLite ở chế độ read-only, không dùng Store constructor/migration, không tạo workspace hoặc .agentic. Không hash lại artifacts hoặc chạy scientific validation. V1–V5 có thể inspect; version lạ chỉ trả phần snapshot config/metadata đọc được và lỗi unsupported, không diễn giải task/attempt schema chưa biết.

Skills trong registry/role là declared/allowed; task selection hiển thị riêng. GUI model và GUI inventory luôn unknown trong baseline. Worker extension_scope receipts được trình bày historical_observation hoặc stale khi config/binding không khớp, kèm scope/time; không gọi đó là GUI inventory hay live verification. Native_effective của attempt được giữ riêng với model config mới.

Report redact credential keys, env/header values, một số sensitive argv/URL values và escape terminal control characters trước cả JSON/terminal. Không bảo đảm tìm mọi secret nằm tự do trong prose; tránh chia sẻ full report khi chưa xem nội dung. Output mặc định không chứa transcript. Backend processes, MCP discovery, network và model không được inspector khởi động.

Shared entry point: src/inspection.mjs exports inspectProject(options), renderInspection(report, options). inspectProject không thay process.exitCode; CLI quyết định exit code. Không cần owner lease để đọc. Native inventory refresh sẽ là operation riêng nếu tích hợp sau.

Software coverage: test/inspection.test.mjs kiểm snapshot/schema/config không đổi, WAL read, candidate drift/broken/rescue, uninitialized/corrupt DB, native history/frozen model, redaction/control chars, paging/section/full, CLI exit codes và legacy/unknown schema. Full suite/static result xem trạng thái thực thi trong plan; evidence v1 cũ không được ghi đè bằng tuyên bố mới.

Kết quả kiểm tra 29/10/2026: full deterministic suite **212/212 pass, 0 skipped**, Node 24.22.1; static checks **67 JavaScript + 4 Python** pass. Suite ngoài Windows sandbox mất khoảng 160 giây, gồm fixtures, không live LLM benchmark. Lượt trong sandbox gặp EPERM atomic rename ở các fixtures cũ; chạy lại ngoài sandbox pass. 8 test mới của inspect cũng pass riêng. Chưa thực hiện human layout acceptance I0 hoặc live GUI checks. Historical v1-evidence.json không được tái tạo trong lượt này.
