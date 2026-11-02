# Sửa lỗi sau review vận hành — v0.3.1

Rà soát: 25/10/2026; hoàn tất kiểm tra: 26/10/2026. Phạm vi: sửa các lỗi đã tái hiện trong review của người dùng và giảm ma sát liên quan đến output hashes/context. Đây là sửa phần mềm; không chạy model hoặc benchmark khoa học. Nghiệm thu cuối vẫn chờ người dùng.

## Mapping finding → hành vi mới

| Finding | Sửa đổi | Regression |
|---|---|---|
| #1: needs_review | Thêm reopen-task có owner/epoch, reason, tùy chọn rerun_units/evidence. Giữ completed units còn hợp lệ; reset phần cần làm lại và unit phụ thuộc. Không reset revision/attempts/budget/generation | Reopen sau inconclusive/upstream revision, giữ progress, chặn job chưa rõ và exhausted budget |
| #2: sai capacity state | Chỉ RESOURCE_ADMISSION được chuyển thành waiting_for_capacity ở cả ba nhánh runner; lỗi input/checkpoint/quyền không bị gộp | Thay input sau unit đầu → exception Input changed được truyền ra |
| #3: shared output path | Lưu immutable output snapshots; aggregate theo publication sequence, không theo thứ tự spec khi rerun. Kiểm cả public output cuối và snapshots lịch sử | Cùng file qua nhiều unit, tamper snapshot/public file, rerun unit sớm hơn trong spec, chặn sửa không khai phiên bản mới |
| #4: timestamps | Timestamp tới giây được xem như interval một giây; chỉ chấp nhận nếu giao với attempt start. Timestamp có phần thập phân vẫn kiểm >= start | Cùng giây được nhận, giây trước/millisecond trước bị chặn; audit khác attempt vẫn bị chặn |
| #5: completion exception | Bắt/reject exception từ completion callback, ghi root termination riêng và settle theo bằng chứng. Validate expected artifacts cấp task trước final publication | Missing output → failed/settled; rollback finish transaction không crash; descendants chưa rõ → unknown/unsettled |
| #6: pause/resume | Giữ suspended status, xử lý decision trong lúc paused, khôi phục yielded/capacity/pending state. Manual handoff không có process có thể resume cùng attempt | Decline không bị resume/reopen bỏ qua; replacement approval có scope; pause giữa units và manual import |
| #7: graph expansion | Forward dependencies giữ nguyên; reverse expansion chỉ evidence/reviews trong selected scope. Không tự kéo sibling hypotheses qua ancestor chung | Chọn H1 vẫn nhận counterevidence/review, bỏ H2/E2 không thuộc scope; [] là selection rỗng |
| #8: Windows/JSON | Preflight native executable và argv; không bật shell tự động. Native final message có thể chuẩn hóa đúng một JSON fence bao toàn message | Reject .cmd/.bat/.ps1 và argv quá 32767; reject prose/multiple fences; script result-json vẫn strict |
| #9: headroom/backoff | Default single unit chia một phần reservation cho checkpoint/margin; giữ tổng cũ. Tách streak failures và total_failures; chỉ reset theo recovery signal phù hợp | Default telemetry yêu cầu yield; rate limit không tự hết chỉ vì token snapshot dồi dào; success reset streak |
| #9: overlays | Validate tất cả files trước ghi. Nếu IO/transaction fail, chỉ dọn directory vừa tạo trong invocation đó sau confinement check | File thứ hai invalid không để orphan; IO rollback; giữ sentinel trong directory đã có từ trước |
| #9: checkpoint | Progress checkpoint chỉ nhận current active/unsettled attempt. Final checkpoint suy ra từ completed result bởi runner/manual import | Chặn failed/cancelled/unknown/settled publication; chặn ghi lại final checkpoint |
| #9: dictionary | Dùng own-property membership ở các tra cứu cấu hình/ID/dependency liên quan | Dependency kế thừa toString bị từ chối; task có ID toString được đăng ký như một own key hợp lệ |

Các ca chính nằm tại [test/operational-review.test.mjs](../test/operational-review.test.mjs); handoff B01 có regression ở [test/benchmark-preparation.test.mjs](../test/benchmark-preparation.test.mjs). Các test cũ vẫn được giữ.

## Reopen không là quyền chạy lại vô điều kiện

Ví dụ CLI:

    node scripts/harness.mjs reopen-task --config CONFIG --task TASK_ID --file REVIEW_JSON --owner OWNER --epoch EPOCH

REVIEW_JSON theo [task-review.schema.json](../schemas/task-review.schema.json). reason ghi review thực tế; rerun_units có thể yêu cầu làm lại thêm unit. Runtime tự thêm unit không còn hợp lệ và dependency closure cần chạy lại.

Task phải needs_review, không bị cancel, không có active/unknown attempts hoặc external jobs chưa giải quyết; upstream phải current. Input đã pin bị đổi vẫn cần revision/spec thích hợp. Reopen không tăng budget hoặc bỏ benchmark approval guard.

Decision decline cần một decision mới có supersedes_decision_id và approval thật theo workflow hiện có. Approval giải quyết đúng chuỗi decision được thay thế, không bỏ qua một decline khác. Đây vẫn là trusted-local-operator attestation, không phải cơ chế xác thực người dùng độc lập.

## Output pinning và immutable receipts

Chỉ artifacts là declared writable outputs được bỏ sha256 để harness tính hash từ bytes hiện tại. Không áp dụng cho historical inputs, evidence_refs, research_refs hoặc planning sources. Một declared output trỏ cùng physical file với input lịch sử cũng bị từ chối.

Harness giữ output snapshots tại .agentic/output-snapshots/<sha256>. Result vẫn dùng logical public path, attempt giữ snapshot receipt và unit giữ publication sequence. File bị sửa sau publication, snapshot bị tamper hoặc input/evidence đổi vẫn bị phát hiện.

Snapshots có thể được tái sử dụng theo content hash; chưa có automatic garbage collection. Backup/handoff cần database và files, không chỉ JSON summary. State v2 được mở rộng bằng optional fields; records cũ không có bytes snapshot không được giả dựng lại từ một file đã đổi.

## Context và khả năng điều khiển thật

research_record_ids là lựa chọn roots rõ ràng. Packet giữ forward premises và counterevidence/reviews liên quan; excluded_latest_records hiển thị phần ngoài scope. Một relevant record quá lớn vẫn bị từ chối theo max_chars, không cắt âm thầm.

Handoff B01 chọn dependencies theo phase; reviewer vẫn nhận toàn bộ chuỗi liên quan và planning audit, outputs được archive đầy đủ. Đây là giảm copying trong workflow cụ thể, không phải lời hứa mọi chuỗi agent tự có context hằng số.

Capabilities bổ sung checkpoint_boundary, checkpoint_midrun và cooperative_yield. One-shot CLI có boundary checkpoint; chưa có automatic midrun IPC/telemetry/steer. Không triển khai SDK/App Server hoặc mở quyền ghi SQLite cho worker read-only trong bản này.

Windows preflight báo unsupported rõ nếu chỉ có shell shim hoặc argv quá dài. Nó không tạo stdin/file transport mà CLI đích chưa hỗ trợ. Config cần trỏ .exe thật hoặc Node command adapter; không tự đổi executable/model/quyền.

Runner ghi termination.json khi xác nhận root đã thoát, trước publication vào SQLite. Receipt giữ attempt/PID/exit code và mức biết về descendants để hỗ trợ reconciliation; root exit không tự xác nhận descendants đã kết thúc.

## Kiểm tra và giới hạn

    node scripts/check-project.mjs
    npm test
    node scripts/verify-v1.mjs

verify-v1 dùng Node trực tiếp, chạy software fixtures/static checks/mock recovery và ghi [evidence](verification/v1-evidence.json). Không chạy benchmarks hoặc live models. Số test và source/evidence hashes lấy từ evidence của source hiện hành.

Không có kết luận mới về scientific quality, novelty hoặc mức tiết kiệm token. Native model availability, OS sandbox và real CLI compatibility vẫn cần xác minh trong scope được người dùng cho phép. Automated pass vẫn chờ user review.

B01 v2 đã chuẩn bị trước bản sửa là artifact lịch sử: source/path fingerprints đã cũ, protocol/manifest không bị sửa ngầm. Nếu sau này cần chạy phải chuẩn bị request mới và xin xác nhận riêng. B02/B03 vẫn là templates; chưa campaign nào được thực thi.
