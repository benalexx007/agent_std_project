# Nghiệm thu research harness v1 và cải tiến khi sử dụng

Ngày: 25/10/2026. Tiêu chí này có implementation và automated evidence trong [verification/v1-evidence.json](verification/v1-evidence.json); chưa phải quyết định nghiệm thu của người dùng. Đọc cùng [plan chính](research-domain-plan.md), [kế hoạch năng lực research](research-capability-plan.md) và [trạng thái implementation](implementation-status.md).

## 1. Quyết định phạm vi

Mục tiêu phát hành đầu tiên là một bộ công cụ dùng được, có thể điều khiển, truy vết và mở rộng để hỗ trợ nghiên cứu. Không yêu cầu thực nghiệm chứng minh năng lực khám phá tổng quát, số phát hiện mới, điểm novelty, paper được nhận, hoặc mức tiết kiệm so với baseline trước khi bàn giao.

Ba loại kiểm tra có mục đích khác nhau:

| Loại | Thời điểm | Vai trò với v1 |
|---|---|---|
| Kiểm tra phần mềm và quy trình hỗ trợ | Trước bàn giao, dùng local fixtures, static checks và walkthrough của người dùng | Bắt buộc cho phần nằm trong scope v1 |
| Kiểm tra tích hợp dịch vụ/backend thật | Khi backend được phép sử dụng; có thể là smoke check nhỏ hoặc lần sử dụng đầu tiên | Xác định capability nào đã live-verified; không bắt buộc một dự án nghiên cứu hoặc hai hãng chạy thật để nghiệm thu core |
| Kiểm chứng kết quả khoa học của dự án | Trong quá trình nghiên cứu, theo claim và nguồn lực của dự án | Vẫn bắt buộc khi cần để bảo vệ kết luận; không biến thành benchmark chứng minh toàn hệ thống |

Các benchmark tái khám phá, so sánh multi-agent, đo lợi ích đa nền tảng hay tiết kiệm token chỉ là lựa chọn phát triển sau này khi có nhu cầu/quyền. Mỗi campaign phải hỏi riêng người dùng kèm protocol chi tiết; quyền thiết kế proposal không tự mở quyền execute. Không tự chạy sau nghiệm thu. Thực nghiệm nghiên cứu thuộc dự án đang làm vẫn được thực hiện theo protocol đã được cho phép.

## 2. Quy tắc ra quyết định nghiệm thu

Mỗi gate bắt buộc có ID, phạm vi áp dụng, cách kiểm tra, evidence/version và trạng thái pass/fail/not_run/not_applicable. not_applicable cần lý do hợp lệ theo scope, không được dùng để miễn các trách nhiệm cốt lõi. Một lỗi bắt buộc hoặc kiểm tra bắt buộc chưa chạy giữ nghiệm thu ở pending.

Không tính điểm trung bình để che lỗi mất dữ liệu, dùng evidence sai revision, làm mất phản chứng hoặc báo đã xác minh khi chưa kiểm tra. Tính năng tùy chọn chưa có được ghi deferred/unsupported với đường dùng thay thế; không gắn nhãn pass. Những giới hạn native API, prover hay remote scheduler có thể công khai mà không cản trở core, nếu hệ thống xử lý đúng unsupported/unknown.

Các gate dưới đây xác minh công cụ có hỗ trợ/lưu/kiểm tra đúng hợp đồng và người dùng sử dụng được quy trình. Fixture được cung cấp record đúng/sai có chủ đích; không phải bằng chứng LLM tự phát hiện được mọi lỗi khoa học. Năng lực model thực tế vẫn được ghi là chưa đo hoặc ghi theo case sử dụng.

## 3. Các gate bắt buộc

| ID | Phạm vi cần đạt | Cách kiểm tra và evidence tối thiểu |
|---|---|---|
| V1-01: mục tiêu và cấu hình | Tách role/skill/backend/model/permission/pool; ba role; output paper/proof/report; ba model tiers theo task class | Config/context và actual argv snapshots hợp lệ; override có scope; chưa map provider thì từ chối; fallback giữ tier; Sol High/Medium phân biệt effort. Báo cáo harness không ép output research |
| V1-02: hỗ trợ bốn năng lực | Role/skill/reference có lối đi cho hypothesis, derivation, experiment design và evidence update | Static/reference checks và walkthrough các case mục 4; context nạp đúng phần cần, không bắt mọi task dùng đủ bốn năng lực |
| V1-03: record khoa học | Lưu được giả định, prior work, obligations, dự đoán, phản chứng, verdict và lý do cập nhật; mỗi loại đúng phạm vi | Round-trip record/version; fixture thiếu/nhầm reference bị báo; hypothesis mới chưa kiểm tra không bị tự nâng thành claim supported hoặc novelty confirmed |
| V1-04: provenance và tính nhất quán | Nối claim–derivation–code–run–figure/source; kết quả phụ thuộc bị đánh dấu cần kiểm tra lại khi input/protocol đổi | Test thay revision/hash/dependency, giữ raw output và lịch sử; kiểm tra liên kết bị thiếu. Không tuyên bố hash check xác nhận nội dung nguồn hỗ trợ claim |
| V1-05: vòng nghiên cứu | Có thể ghi nhiều giả thuyết, sửa/bác bỏ/chờ, hoặc dừng vì chưa đủ dữ kiện; hỗ trợ paper theo yêu cầu | Walkthrough nhận evidence trái chiều rồi cập nhật scope/conclusion; gói review/output giữ các findings còn mở và mức bằng chứng |
| V1-06: work units và tài nguyên | Admission/reserves/pool accounting, unit dependencies, bounded retry, telemetry unknown, giữ phần đã hoàn tất | Local tests và fault injection: pool chung cạn, thiếu telemetry, counter lũy kế, no-progress; không suy ra quota riêng từ tên worker |
| V1-07: checkpoint và phục hồi | Khôi phục tiến độ khoa học và vận hành; fencing chống tích hợp output cũ; job unknown được reconcile | Fixture cạn tài nguyên không final answer, crash, worker B takeover; giữ assumptions/obligations/phản chứng và quyền hiện hành; không nhân đôi việc đã xác minh |
| V1-08: HITL | Status/steer/pause/cancel/resume có scope, ACK/terminal tách biệt, quyết định có revision | Test từ process khác, cancel sát completion, pause lúc transfer, phản hồi đến muộn; walkthrough người dùng hỏi/đổi hướng và tiếp tục |
| V1-09: khả năng thay agent | Bundle/context/handoff dùng chung; adapter command/parse/capabilities có contract; điều phối thay owner/epoch được | Ít nhất hai adapter ngoài có kiểm tra contract offline, mock/manual E2E và fencing. Ghi riêng live-unverified; không đòi mọi hãng có cùng native controls |
| V1-10: sử dụng và cải tiến | Hướng dẫn chạy/khôi phục, ghi feedback gắn phiên bản, đề xuất thay đổi và rollback có thể thực hiện | Người dùng đọc được status/evidence và hoàn thành checklist; local round-trip feedback/changelog. Không tự bật model calls hoặc global policy update |
| V1-11: bàn giao | Report phản ánh đúng phiên bản, gates và limitations; không claim tiết kiệm/khám phá chưa đo | Báo cáo hệ thống, capability matrix, lệnh tái tạo kiểm tra và unresolved list; người dùng quyết định nghiệm thu |

Không tạo một số lượng test mục tiêu để đạt hình thức. Bộ 60 test ban đầu đã được giữ và mở rộng; xem evidence source hiện hành cho số lượng/kết quả. Automated checks pass vẫn chờ user review, không tự chuyển nghiệm thu cuối thành complete.

## 4. Bộ walkthrough nhỏ, có đáp án kiểm tra cơ chế

Chuẩn bị dưới dạng artifact giả lập hoặc ví dụ toán đơn giản, chạy offline/manual trước. Tái dùng C1–C4 trong một walkthrough và evidence có sẵn, không tạo bốn lượt model riêng. Người dùng kiểm tra hệ thống lưu, truyền, hiển thị và kiểm tra trạng thái; không yêu cầu tạo phát hiện mới.

| Case | Tình huống | Điều cần quan sát |
|---|---|---|
| C1: giả thuyết và bằng chứng trái chiều | Có hai giải thích cho một quan sát; thêm một kết quả làm suy yếu một giả thuyết | Lưu prior/alternative/prediction; evidence update giữ lịch sử và phản chứng; không ép chọn một giả thuyết nếu chưa phân biệt được |
| C2: toán học và proof chưa hoàn tất | Artifact có một suy dẫn chia cho x và còn nghĩa vụ xử lý x=0; kết quả số chỉ kiểm tra hữu hạn điểm | Record/context giữ miền x≠0, obligation x=0 và nhãn numerical/proof sketch. Validator chặn transition thiếu record kiểm chứng theo contract; reviewer kiểm tra nội dung, không claim runtime tự hiểu mọi phép toán |
| C3: thực nghiệm và cập nhật | Protocol phân biệt hai dự đoán; record kết quả gồm một run thất bại và một kết quả âm; thay một giả định | Run/code/config truy vết được, failed không thành negative finding; conclusion bị yêu cầu review đúng phạm vi, kế hoạch mới có revision và lý do |
| C4: thay worker khi nghiên cứu dở | A bị ngắt sau lemma/experiment record, còn obligation và job chưa rõ; B nhận handoff; người dùng pause | Giữ điều kiện lemma, phản chứng và pending job; không launch trùng; pause chặn B. Sau reconcile/resume hợp lệ, nhận đúng phần còn lại |

Thêm một task nhỏ kiểm tra citation để xác nhận không tự mở nhánh discovery, tạo proof hoặc spawn đủ ba worker. Dùng các case này làm regression của cơ chế; nếu sau này chạy model trên chúng, ghi riêng điều kiện và kết quả, không gọi là đánh giá novelty.

## 5. Khả năng backend và mức bằng chứng

Planning completed phải có planning_review của attempt hiện hành: tự đọc primary sources/code/data, research lại điểm quan trọng, đối chiếu analysis và giữ bất đồng/assumptions; analysis không được giả làm primary evidence. Tests phải chặn thiếu audit, audit cũ, nguồn trùng analysis, blocker chưa giải và nguồn đổi sau publication. Đây là gate provenance trong V1-05, không chứng nhận nội dung khoa học. Routing local pass chưa là live verification của Astra/Sol hoặc provider khác.

Capability matrix cần ghi tên/phiên bản interface, command/parse checked, offline contract checked, live transport checked, native control đã xác minh, cách fallback và limitations. Không gộp tất cả vào một nhãn “supported”.

Nếu v1 chỉ được kiểm tra local/manual thì báo cáo nói rõ v1 đã nghiệm thu ở phạm vi đó. Trước khi sử dụng provider mới, thực hiện preflight và một tác vụ nhỏ trong phạm vi người dùng đã cho phép; giữ lỗi tích hợp trong usage feedback. Live-unverified không được trở thành live-ready chỉ vì mock pass.

Không cần native streaming, quota API, children tracking hoặc theorem prover trên mọi hãng để phát hành core. Nhưng hệ thống phải báo thiếu capability và dùng đường manual/artifact hoặc từ chối thao tác phụ thuộc khi không có cách hợp lệ.

**Tối ưu/tích hợp native.** [Plan bản 4](runtime-integration-plan.md) đánh giá lợi ích trước khi mở rộng workspace/publication, recovery/accounting, session reuse, parallel writers và native groups; giữ năng lực/tính đúng làm ràng buộc. Source 0.5.0 có [integration foundation](integration-foundation.md) và software regression; kế thừa nhánh Codex và [P0 lịch sử source 0.4.0](verification/p0-2026-10-27/report.md). Chưa có inference thật; các capability ngoài scope foundation còn conditional. [Protocol nghiệm thu tối thiểu](acceptance-minimal-protocol.md) nối coverage C01–C18 với S0/P0/L1/L2 và evidence thật hợp lệ; không chạy tích Descartes backend × model × role. Mỗi campaign có chủ đích cần xác nhận riêng kèm protocol, kể cả smoke. Evidence cũ không tự chứng nhận feature chưa viết.

## 6. Điều kiện bàn giao báo cáo hệ thống

Sau khi hoàn thiện implementation thuộc scope v1 và các gate kiểm tra tương ứng, tạo docs/system-report.md để hoàn tất gate bàn giao V1-11. Nội dung:

- Mục tiêu, phạm vi v1 và kiến trúc; phân biệt harness với model và dự án research.
- Bốn năng lực nghiên cứu được hỗ trợ bằng workflow/artifact/tool nào; phần nào còn phụ thuộc agent hoặc chuyên môn người dùng.
- Cách sử dụng, cấu hình/override, HITL, ngân sách, checkpoint/fallback và handoff.
- Phiên bản môi trường/source, kết quả kiểm thử phần mềm và walkthrough, bằng chứng và lỗi đã sửa.
- Capability matrix cùng các tính năng chưa live-verified, chưa triển khai hoặc chưa đo hiệu quả.
- Hướng dẫn thu feedback, cập nhật có phiên bản, rollback và backlog sau bàn giao.

Không yêu cầu viết paper về hệ thống hoặc thực hiện dự án nghiên cứu mới để điền báo cáo. Số liệu hiệu quả nghiên cứu/token chỉ đưa vào nếu thực sự đã quan sát và nêu rõ phạm vi; chưa có thì ghi chưa đo, không cản trở gate V1-11.

## 7. Tối ưu dần trong sử dụng

Vòng lặp bình thường là làm dự án → lưu evidence/feedback → xác định lỗi hoặc điểm hữu ích → sửa nhỏ → kiểm tra hồi quy → dùng tiếp. Có thể review tại cuối một work unit đáng kể hoặc milestone; không đặt lịch tự động và không buộc người dùng chấm điểm mọi lần.

Các chiều quan sát giữ riêng: tính đúng/giới hạn của lập luận; mức hữu ích của ý tưởng; chất lượng thiết kế thực nghiệm; khả năng kiểm tra lại; công sức sửa; token/compute/thời gian và độ tin cậy vận hành. Nhận định novelty cần nguồn/phạm vi/chuyên môn, có thể chưa kết luận được. Không ép chúng thành một điểm thành công tổng hợp.

Bug có tái hiện và oracle rõ được đưa vào regression. Phản hồi chủ quan hoặc kết quả khác nhau do đề tài/model được giữ dưới dạng case note. Mỗi thay đổi skill/script/config ghi phiên bản và lý do, không tự tăng quyền/ngân sách. Các so sánh đối chứng lớn chỉ thực hiện khi người dùng thấy cần và cấp phạm vi riêng.

## 8. Hiện trạng bàn giao

- I1–I4 cùng research records/profiles/reference semantics và context/checkpoint/handoff đã có source và software checks.
- Role/skill/reference đã mở rộng cho hypothesis, toán học, experiment design và evidence updates; C1–C4 có fixtures trong test/research.test.mjs để người dùng review.
- Feedback, immutable project overlays, activation/rollback và history có kiểm tra; báo cáo nằm tại docs/system-report.md.
- Benchmark guard pin protocol/scope/budget và yêu cầu human confirmation từng campaign. Ba proposal đã thiết kế, chưa chạy.
- Backend thật còn live-unverified; xác minh khi được dùng với quyền phù hợp. Scientific quality/novelty chưa được đo, không phải gate phát hành core.

Implementation v0.4.0 sẵn để verify/review. Chạy node scripts/verify-v1.mjs để tái tạo automated evidence, rồi người dùng kiểm tra phạm vi/gates/giới hạn và quyết định nghiệm thu. Không tự chạy benchmark để hoàn tất review.

## 9. Regression sau review vận hành v0.3.1

Các lỗi vận hành được ghi và sửa tại [operational-review-fixes.md](operational-review-fixes.md); test/operational-review.test.mjs bổ sung evidence cho reopening, HITL, callback error propagation, output versions, checkpoint liveness và adapter preflight. Phải giữ cả positive và negative cases, bao gồm unknown descendants vẫn giữ reservation và declined decision không được tự mở.

Không dùng việc thêm tests để chứng nhận năng lực research. Core vẫn chờ người dùng nghiệm thu; backend thật và chất lượng khoa học phải được ghi đúng mức chưa xác minh. Benchmarks vẫn không bắt buộc.
