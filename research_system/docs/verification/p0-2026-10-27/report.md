# P0 — Codex native preflight, 27/10/2026

Verdict: **PASS với giới hạn được nêu rõ** cho metadata/static preflight của profile Codex native read-only. Thu metadata khoảng 13:08–13:09, múi giờ Asia/Saigon. Đây không phải nghiệm thu inference, chất lượng nghiên cứu hoặc so sánh native với runtime ngoài.

## Kết quả

| Hạng mục | Bằng chứng / kết quả |
|---|---|
| Binary | codex-cli 0.164.0-alpha.11.1; khớp version pin; lưu path và SHA-256 trong result.json |
| Protocol | Tạo lại schema từ binary thật; 9 file protocol trọng yếu khớp SHA-256 pin trước |
| Phần mềm | Static check pass, 51 module; 116 source hashes khớp evidence S0 có 161 tests pass. Không chạy lại suite |
| Auth | account/read trả loại chatgpt, plan plus; không lưu email hoặc account ID |
| Model policy | Catalog có gpt-6-astra/high, gpt-6.1-sol/high và gpt-6.1-sol/medium; chưa xác nhận entitlement inference |
| Metadata RPC | initialize, account/read, account/rateLimits/read, model/list, config/read, configRequirements/read thành công |
| Managed requirements | RPC trả null; chưa quan sát thấy ràng buộc managed xung đột |
| Context analysis dự kiến | 11.935 ký tự / giới hạn 96.000; input ước tính 5.968 token; reservation ước tính 17.968 / cap đề xuất 24.000 |
| Inputs | Fixture nhỏ có hash và đọc được bởi harness; không thay thế kiểm quyền đọc thực tế của backend |
| Vòng đời observer | Process kết thúc với exit code 0; không tạo thread/turn, attempt hoặc benchmark request |
| Config gốc | Không đổi; external execution vẫn disabled |

Quota tại 13:08:58: cửa sổ 5 giờ còn 97%, tuần còn 66%; ordinaryUsageAllowed=true. Đây là snapshot dùng chung tài khoản, không phải phần quota được giữ riêng. Không quy phần trăm sang token. Pool trong scratch vẫn unknown theo thiết kế; không tự nhập phần trăm vào token ledger.

## Giới hạn và bước tiếp theo

- Ambient config có approval_policy=on-request và approvals_reviewer=auto_review. Driver render tham số thread tường minh never/user, sandbox read-only, tắt native delegation và model fallback. P0 chưa gửi thread/start nên chưa có receipt chứng minh các override được áp dụng. Driver phải kiểm receipt trước turn/start ở L1.
- Chưa kiểm thực thi sandbox, tools, entitlement model hoặc hủy cây process thật. Native metadata/fixtures không chứng nhận các năng lực đó.
- Ước tính input dùng ký tự/2; reservation không phải usage đã đo hoặc hard provider cap. Kích thước context có thể thay đổi khi task/config/workspace được đóng băng cho L1.
- Cost estimate L1 còn thiếu; giá trị 0 trong config scratch chỉ là placeholder không thực thi, không phải khẳng định chi phí bằng 0.
- L1/L2 chưa chạy và chưa được duyệt. L1 cần protocol/manifest/config/task được đóng băng cùng cơ sở ước tính chi phí và xác nhận riêng trước khi chạy. Refresh quota gần thời điểm đó.

## Bằng chứng

- [Kết quả máy đọc](result.json), [manifest](evidence-manifest.json), [static checks](static-check.json).
- [Context analysis](analysis-context.json), [tham số native chưa gửi](native-thread-params-not-submitted.json).
- [Collector](check.mjs), [finalizer offline](finalize.mjs). Collector chỉ cho phép RPC metadata qua allowlist; finalizer không khởi động process/network.
- Schema được giữ trong protocol/; phiên bản/hash nguồn và binary nằm trong result.json. Không có LLM grader hoặc model call.

Ranh giới metadata và inference tham chiếu [OpenAI App Server](https://learn.chatgpt.com/docs/app-server); evidence quyết định ở đây là phản hồi của binary đang cài, không suy diễn từ tài liệu web.
