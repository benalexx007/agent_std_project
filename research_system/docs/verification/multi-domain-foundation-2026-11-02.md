# Foundation đa domain — báo cáo kiểm thử 02/11/2026

## Phạm vi

Nhánh `feat/multi-domain-foundation` đưa các điểm phụ thuộc Research của shared harness qua một descriptor Research, thêm registry domain và chặn config/task/state/GUI connection sai domain. Orchestrator, model routing, Research records, checkpoint, publication và GUI v5 tiếp tục theo hợp đồng hiện có. `application` hiện chỉ là entry `enabled: false` và [bản nháp hợp đồng](../application-domain-contract-draft.md); chưa có Application runtime hoặc workflow end-to-end.

## Kết quả

- `node scripts/check-project.mjs`: hợp lệ; 77 file JavaScript được kiểm tra cú pháp, 4 file Python được kiểm tra, example schemas hợp lệ.
- Full software suite: 235/235 pass khi lock extension tạm thời được tái tạo theo môi trường Python/Poppler đang có; lock tracked được khôi phục trong `finally` sau test. Không gọi model hoặc benchmark.
- Test GUI/domain sau thay đổi cuối: 17/17 pass. Test mới xác nhận `connectGui` từ chối domain khác trước khi ghi và Research connection vẫn idempotent.
- So sánh cùng fixtures Research với commit backup `9d73de585b27b98836789c7fad2a896924d6911f`: config hash, task hash, context hash và context length bằng nhau. Lần lượt: `ac5a4e647411caa10d6a22446f3a23639c0a2c53a46487b1e01415a9f7bfaa1f`, `3cad344f4b70d5bb171f04947d856d11ed94697dbf25740fc34a64218623c811`, `7f622d6e297453d670eddbcddd7a5955734a60b5d2b9c97e519f6e98122cca74`, 10566 ký tự.

## Giới hạn môi trường

`extensions/research/lock.json` tracked vẫn pin environment cũ. Máy hiện tại đã thay base Python và một số file Poppler, vì vậy chạy extension-enabled config với lock gốc sẽ fail closed ở kiểm tra binding. Trong lần kiểm thử, 6604 file pinned của Python venv khớp inventory, các package import được; 123 đường dẫn Poppler hiện có, 65 file có hash đổi, `pdftoppm` báo phiên bản 26.07.0. Binding cục bộ trong `.research-environment/environment.json` (ignored) được cập nhật cho đúng các file đã kiểm tra, sau đó lock được tạo tạm để chạy suite và khôi phục lock gốc. Điều này chứng minh software suite chạy được trên binding cục bộ hiện tại; chưa phải migration lock cho các project cũ. Cần một đợt versioned environment/lock migration riêng trước khi coi extension-enabled execution trên checkout nguyên trạng là sẵn sàng.

## Chưa nghiệm thu

Application schemas, storage/writer guard, records, GUI entry, extension routing và workflow; live GUI host discovery, model invocation, benchmark khoa học và giá trị của kết quả nghiên cứu. Các phần này không được suy ra từ software suite.
