# Điều chỉnh orchestrator, cố vấn khoa học và automation — 31/10/2026

## Kết quả triển khai

- Orchestrator mặc định analysis/medium = GPT-6.1 Sol High. Sửa cả model_policy.orchestrator_task_class, orchestrator.task_class trong native presets và task-orchestrator.json.
- synthesis_planning/highest = GPT-6 Astra High là nhiệm vụ cố vấn chuyên môn riêng, thường researcher: tổng hợp analyses và bằng chứng gốc, tự research/verify lại, trả kế hoạch chi tiết cho orchestrator triển khai. Giữ nguyên planning_review hiện hành và các cổng kiểm chứng; không thêm root coordinator.
- Automation mới mặc định Antigravity Gemini 3.8 Flash High. task_class_backends.automation chọn backend khi chưa có lựa chọn riêng; family Antigravity có low, không suy đoán highest/medium. Explicit/frozen selections vẫn giữ nguyên. Codex low còn để tương thích khi chủ động chọn Codex.
- AGY adapter truyền --model gemini-3.8-flash-high và --effort high, một user event NDJSON qua stdin rồi EOF. Không đưa prompt lớn vào argv, không warm session hoặc native auto-resume. Parser đòi đúng một terminal result SUCCESS; usage từ terminal counters, không cộng lại step/thinking/cache breakdown.
- Cập nhật bảy config mẫu, ví dụ cố vấn mới, override automation, role/skill, hướng dẫn sử dụng, model routing và các plan liên quan. Không sửa config/state/entry đã sinh ở project người dùng hoặc artifact benchmark lịch sử.
- B01 preparation bỏ default backend routes của project template vì campaign cố định chỉ có các stage Codex và script tính toán; preparation vẫn tạo request pending, không chạy benchmark.

## Kiểm tra đã chạy

| Kiểm tra | Kết quả |
|---|---|
| Model routing, planning, runner và benchmark-preparation regressions | **42/42 pass** |
| Toàn bộ software regressions | **231 tests: 218 pass, 13 fail, 0 skip** |
| Static/schema/config/skill checks | Pass; **74 JavaScript + 4 Python** syntax checks |
| CLI resolve-model cho Antigravity automation | executed=false, gemini-3.8-flash-high, effort high, tier low |
| agy.exe --help | Có --model, --effort, --input-format và --output-format stream-json |
| agy models trong sandbox | Không xác minh được inventory; lỗi ghi log/state, network và không lấy được phiên đăng nhập |
| skill-creator quick_validate.py | Không chạy được do interpreter thiếu PyYAML; metadata/size/reference checks của check-project đã pass |
| Live inference / benchmark | **Không chạy** |

Mười ba failures đều trong extensions.test.mjs, tại bước xác minh môi trường, với cùng lỗi **Base Python binding changed**. Hash executable Python nền hiện tại khác environment manifest được provision từ trước:

- Expected: 73dbf1f40507275d6fa636b49eb80b4753e313f649f52591abba86b31f1a1bce
- Actual: f8b45d63047da9d9adf09892e4cc4317b859e86a93a478cc9616bc69d3b176e5

Venv executable vẫn khớp hash đã pin. Không thay môi trường, repin hash, tắt integrity guard hoặc skip tests để làm xanh bộ test. Các helper scientific cần được xác minh/provision lại trước khi sử dụng; kết quả lần này không phải full-suite acceptance. Bộ kiểm tra baseline 29/10 được giữ nguyên như bằng chứng lịch sử, không dùng để chứng nhận source đã sửa.

Tests mới kiểm tra default của tất cả presets, explicit/frozen selection precedence, class-to-backend routing và tier thiếu, effort/large-prompt transport, terminal/error/duplicate parser, vai trò cố vấn không dùng orchestration tools, dependency kế hoạch và invalidation khi nguồn gốc đổi. Các software tests không đo chất lượng khoa học hoặc chứng minh model thật truy cập được.

## Dùng cho project hiện có

Đọc [model routing](../model-routing.md) và [hướng dẫn sử dụng](../user-guide.md). Với state v5, orchestrator chuẩn bị config change có preview/apply; task đã đăng ký cần revision/override rõ ràng. Khi đổi automation, kiểm tra backend, permissions, quota và extension scope. Không tự bật execution hoặc sửa model picker của GUI. Entry skill đã copy vào project cần cập nhật có kiểm tra; template mới không tự đồng bộ.

## Bằng chứng

- [Full regression log](advisor-routing-2026-10-31-tests.tap)
- [Static checks](advisor-routing-2026-10-31-static.json)
- [Machine-readable report và source hashes](advisor-routing-2026-10-31.json)
- [AGY headless reference](https://antigravity.google/docs/cli/headless/) xác nhận model slug, effort và dạng stream; CLI help chỉ xác nhận flags, không chứng nhận model/account/live execution.
