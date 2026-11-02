# Protocol nghiệm thu tối thiểu cho tích hợp backend

Ngày thiết kế: 26/10/2026; cập nhật 27/10/2026. Source 0.5.0 có [lát cắt nền](integration-foundation.md); số liệu S0 hiện hành theo verification, kế thừa 161 tests của 0.4.0 và bổ sung regression; xem [evidence](verification/v1-evidence.json) và [implementation](codex-native.md). L1/L2 bằng model thật còn not_run và chưa được duyệt, H0 còn pending. Tài liệu này triển khai [plan bản 4](runtime-integration-plan.md); không tạo quyền tự chạy benchmark. Coverage cho capability mới nằm ở mục 10; evidence cũ không tự chứng nhận implementation chưa có.

## 1. Phạm vi và số lượt tối thiểu

P0 lịch sử của source 0.4.0 đã thực hiện ngày 27/10/2026 cho Codex native read-only: metadata/static preflight pass với giới hạn; chưa tạo thread/turn hoặc inference. Xem [báo cáo và bằng chứng](verification/p0-2026-10-27/report.md). Effective thread policy/OS enforcement và entitlement inference vẫn cần evidence L1; L1/L2 chưa được duyệt hoặc chạy.

Mục tiêu: bắt lỗi có thể làm mất dữ liệu, chạy sai quyền/model, tính sai ngân sách hoặc báo kết quả sai trạng thái; xác nhận đường sử dụng đã chọn. Chất lượng khám phá và lợi ích dài hạn được cải tiến qua dự án thật.

| Gói | Khi cần | Số lượt thiết kế tối thiểu |
|---|---|---|
| S0 — phần mềm | Core hoặc driver có thay đổi | Một batch static + regression cuối trên candidate; 0 model calls |
| P0 — preflight | Trước bật profile hoặc sau đổi binary/config quan trọng | Version/schema/effective config/auth metadata; 0 inference |
| L1 — đường làm việc thật | Profile chưa có evidence tương đương | Một root attempt, một user turn; dùng một task nhỏ, không ép đủ ba roles/models |
| L2 — control/delegation | Chỉ khi bật capability chưa được L1 hoặc trace sử dụng hợp lệ chứng minh | Tối đa một root attempt thêm cho tập capability tương thích; tối đa một child và ba user turns |
| H0 — user review | Trước chấp nhận scope bàn giao | Một walkthrough dùng artifact S0/L1; 0 model calls |

Khởi đầu khuyến nghị: nghiệm thu core bằng S0+H0, rồi bật một Codex native profile qua P0+L1; thêm L2 khi profile cần mid-run control hoặc native_group. Không bắt chạy cả Codex/Claude/Antigravity, cả ba tầng model hay mọi tổ hợp permission/role. Một lần chạy là evidence cho đúng tuple đã chạy; các tuple còn lại giữ unverified và xác minh khi thực sự dùng.

Một root attempt có thể chứa nhiều model/tool rounds; một native child cũng gọi model riêng. Số attempt không phải số API calls. L2 có trần tổng cho root và child, không chỉ parent. Nếu các capability không thể gộp hợp lệ, ghi phần còn thiếu và giữ disabled; chỉ đề xuất lượt bổ sung khi nhu cầu activation đòi hỏi.

## 2. Chọn kiểm tra theo rủi ro và tái dùng evidence

Mỗi capability được bật phải có requirement -> oracle -> evidence -> verdict. Tái dùng test/trace khi source liên quan, protocol/binary, OS, model/effort, quyền và billing phù hợp. Thay transport không cần đánh giá lại novelty; thay usage normalizer phải kiểm accounting; đổi permission hoặc backend version ảnh hưởng controls phải kiểm lại phần đó.

Lỗi required hoặc required not_run giữ scope tương ứng pending. Optional disabled ghi not_applicable với lý do; không dùng nhãn này để miễn fencing, provenance, quota policy hay benchmark permission. Không lấy trung bình điểm để bù một lỗi nghiêm trọng.

S0 kiểm mọi invariant liên quan bằng fault injection có oracle rõ. L1/L2 chỉ kiểm phần native contract mà fixture không chứng minh được. Đưa sự cố thật có tái hiện vào regression; không thêm nhiều seeds, lặp best-of-N hoặc model grader để đẹp tỷ lệ pass.

## 3. Ma trận bao phủ S0

Các dòng là nhóm nghĩa vụ, không là yêu cầu tạo bấy nhiêu test file. Tái sử dụng tests hiện có; chỉ bổ sung hành vi mới/thiếu. Các crash point dùng snapshot độc lập để một lỗi không che những nhánh khác.

| ID / gate v1 | Fixture và thao tác | Oracle bắt buộc |
|---|---|---|
| A01 / V1-01,09 | Render cùng role sang backend profiles; model/effort overrides, unsupported field, global precedence, Windows invocation | Mapping đúng; không âm thầm downgrade hoặc nới quyền; command không shell-inject; thiếu capability bị chặn |
| A02 / V1-02–05 | Tái dùng C1–C4, planning audit hiện hành; context nhánh nhỏ, counterevidence, proof obligation, delta mất nền | Giữ assumptions/nguồn cần; stale audit bị từ chối; không nhận analysis như primary; context vượt cap báo rõ |
| A03 / V1-04 | Input đổi sau prepare; outputs nhiều unit cùng path; late output/generation cũ | Input identity nhất quán; receipt/version đúng; publication cũ không được nhận |
| A04 / V1-06 | Pool chung, quota stale/percent, input floor, cumulative/reset/duplicate events, aggregate+children | Không double-count/undercount đã biết; unknown không thành 0; reserve và cooldown đúng; không gọi model để đợi quota |
| A05 / V1-07 | Crash trước/sau submit, mất reply/handle, executor chết, lost stream; completed unit và pending job | Không relaunch mù; reconnect không tạo việc mới; giữ completed work/obligations; chưa rõ descendants thì còn reservation |
| A06 / V1-08 | Pause/resume waiting_for_user/yielded, decline, steer scope đổi, cancel sát completion, owner takeover | Barrier/revision và ACK/terminal/accepted phân biệt; lệnh owner cũ bị fence; decline không tự mở |
| A07 / V1-06–09 | Native group: child spawn quá trần, quyền/model sai, child còn sống khi parent xong, callback timeout | Enforce hoặc fail closed đúng profile; tập job còn tồn tại được theo dõi; không publish/settle sớm |
| A08 / V1-04,07 | Partial publication, disk full, path/junction escape, conflict; GC gặp blob đang được reference | Không báo success khi thiếu critical evidence; recover publication không gọi lại model; không xóa evidence đang dùng |
| A09 / V1-06,11 | Fake clock/control polls, slow streams/oversized frame, quota events, bounded warm sessions | 0 model cho housekeeping; 0 idle heartbeat writes; không rewrite toàn state mỗi tick; buffers/retention có giới hạn, critical events được giữ |
| A10 / V1-10,11 | Bundle activation/rollback; nếu đổi storage thì migration/old writer/restore; benchmark request thay scope | Policy có revision; old writer bị chặn; backup nhất quán; approval không tái dùng cho scope mới |

A08 isolation/concurrent writers và phần migration A10 chỉ áp dụng khi có thay đổi/tính năng đó. Shared-serial vẫn phải giữ writer exclusion và path/provenance checks. A09 là kiểm tra cơ chế với dữ liệu hữu hạn, không là stress/performance benchmark.

Sau implementation chạy một batch cuối: scripts/check-project.mjs + bộ node --test theo package script. Nếu dùng scripts/verify-v1.mjs thì nó đã gom static/suite/demo; không chạy thêm cả bộ lần nữa chỉ để có hai báo cáo. Trong quá trình sửa bug chỉ chạy test liên quan; sau thay đổi cuối chạy batch required. Không chạy lại suite vì chỉ chỉnh Markdown.

## 4. P0: preflight không inference

Chốt candidate source/bundle/schema hashes, driver/binary/package version, OS, environment, profile, task class/model/effort, auth type và quota pool identity không secret. Kiểm runtime thực sự hỗ trợ schema/flags/control cần; chỉ đọc metadata/account catalog nếu route cho phép, không tạo agent turn. Catalog không chứng minh entitlement inference.

Render context thật để kiểm size/input estimate/native overhead allowance, quyền đọc input/ghi output, tools cần, deadline và mode delegation. Khi cần sandbox, kiểm đúng OS/native enforcement; không coi prompt refusal hoặc worktree là sandbox. Không tự cài/nâng version hay đổi API key route.

Pin fixture/executable/parser/grader hashes vào execution manifest. Nếu thiếu model mapping, schema không tương thích, estimated floor vượt cap, hoặc không có cơ chế dừng/đối soát phù hợp: dừng ở P0, không tiêu model token. Khắc phục rồi cập nhật protocol trước xin chạy.

## 5. L1: một task thật có đáp án xác định

Fixture trong workspace tạm: primary-spec.md; values.csv gồm bốn hàng có value lần lượt 2, 4, 6 và trống; calculate.mjs đã review; output result theo schema dự án. Spec: bỏ hàng trống, đếm missing riêng. Oracle cố định: count=3, missing=1, sum=12, mean=4. Có analysis-note cố ý ghi mean=3 để phân biệt nguồn gốc với summary.

Chỉ chọn biến thể phù hợp profile đang bật:
- synthesis_planning: tự kiểm spec/data/code, đối chiếu analysis-note, trả kế hoạch ngắn và planning_review mới có primary/research checks theo contract. Chỉ kiểm vấn đề cục bộ; không yêu cầu web/literature không liên quan.
- analysis: kiểm phép tính và khác biệt trong analysis-note bằng nguồn gốc; trả findings/evidence đúng schema.
- automation: chạy script cố định và trả artifact; không thêm một agent suy luận để làm oracle.

Các biến thể là lựa chọn, không phải ba stage bắt buộc. Việc đọc/ghi/command của từng biến thể phải phù hợp permission profile. Nếu cần kiểm workspace-write, output phải là file thực sự do backend tạo, không để harness tạo hộ rồi coi đó là evidence.

Trình tự: P0 pass -> xin duyệt run cụ thể -> reserve/dispatch -> thu native IDs/config/events/usage -> kiểm bằng code -> publish/settle. Các trường do worker tự nói như model/quyền/token không thay runtime receipt.

Pass khi đúng artifact/schema/hash, oracle, model/effort được yêu cầu và trạng thái terminal, có accounting đúng mức coverage; đúng gate planning nếu áp dụng; không có job chưa rõ bị coi là đã xong. Không dùng LLM chấm LLM. Không tự sửa prompt/chạy lại khi fail.

Một read-only profile không chứng minh writer isolation; một model không chứng minh các model khác đã chạy được; một dữ liệu đơn giản không chứng minh năng lực nghiên cứu.

## 6. L2: chỉ kiểm native controls/delegation cần bật

Dùng workspace riêng, helper có heartbeat/counter và stop file, tất cả thay đổi trong scratch. Driver fixture đã biết cách thu child/process IDs. Chọn các bước thực sự áp dụng, ghi trước trong protocol:

1. Root chạy helper theo lệnh cố định, ghi marker bắt đầu duy nhất. Nếu bật native_group, yêu cầu đúng một child đọc một fixture nhỏ và báo nonce; không yêu cầu child giải bài nghiên cứu.
2. Khi đang chạy, ngắt riêng observer rồi nối lại qua native binding nếu route hỗ trợ; kiểm vẫn cùng job/session, marker không nhân đôi. Route chỉ hỗ trợ resume sau kết thúc không được gắn nhãn active reconnect.
3. Nếu bật steer, gửi nonce cùng expected active turn; cần cả receipt và dấu hiệu worker xử lý nonce. Không đổi model/quyền qua steer.
4. Nếu bật input callback, dùng câu hỏi chọn nhãn A/B vô hại, người dùng có thể trả lời một lần trong walkthrough. Nếu dùng câu trả lời định trước, ghi rõ chỉ test transport, không chứng minh UX thực tế.
5. Nếu bật pause/resume, kiểm semantics đã khai báo: boundary pause không phải OS suspend. Barrier không cho dispatch mới.
6. Cancel root trong khi helper/child còn active; quan sát đúng phạm vi dừng, không publish late output, không để unknown jobs được settle như thành công. Nếu scope gồm tree cancellation, child phải đang chạy helper có timeout hữu hạn tại thời điểm cancel và có identity để đối soát; child đã hoàn tất từ trước không chứng minh khả năng dừng child.

Có thể xếp các bước vào một attempt, nhưng không hy sinh tính kiểm chứng để ép số lượt. Nếu native_group/control không quan sát đủ hoặc ngân sách không đủ, giữ capability disabled và ghi thiếu evidence; không dùng screenshot/UI khác thay API evidence.

Pass dựa trên IDs, marker, event order có nghĩa theo protocol, trạng thái jobs và ledger. ACK chưa chứng minh worker dừng. Sai/thiếu bằng chứng -> fail/not_run đúng mục, đóng admission và reconcile; không tự relaunch.

## 7. Ngân sách và quyền chạy

Mỗi campaign L1 hoặc L2 có tài liệu điền đầy đủ trước xin xác nhận: mục tiêu/ID gates, profile/model/effort, prompts/fixture hashes, root/child/turn caps, tools/quyền, grading, token/cost/deadline, stop/recovery và artifacts sẽ lưu.

Trần đề xuất ban đầu cho việc chuẩn bị, không là dự đoán usage hay quyền execute:
- L1: 1 root attempt, 0 child, 1 user turn; tối đa 24.000 aggregate tokens, deadline 8 phút.
- L2: 1 root attempt thêm, tối đa 1 child và 3 user turns; tối đa 32.000 aggregate tokens, deadline 8 phút.
- Không auto retry hoặc paid fallback. Tắt auto-continuation/schedule ngoài scope nếu route có; không tắt policy an toàn để giảm token.
- Hạ trần theo context thực tế trước xin duyệt nếu đủ. Nếu context/overhead không vừa, sửa scope hoặc trình ngân sách mới; không tăng ngầm. Không chạy L2 khi không cần capability của nó.

Caps phải tính input lặp qua tool rounds, output/reasoning, children, compaction và retry native có thể quan sát; không chỉ độ dài final answer. Admission cap không là hard provider cap: có thể overshoot trong request đang chạy. Ghi latency telemetry/cancel và allowance còn cần để dừng an toàn. Nếu người dùng yêu cầu hard cap mà backend không enforce được, profile không đáp ứng.

Quota còn lại đọc ngay trước đề nghị chạy; không đổi phần trăm 5h thành token. Subscription incremental spend và API-equivalent cost estimate là hai số khác. Điền max_cost_usd theo accounting route hiện có và giải thích ý nghĩa; không ghi 0 để che unknown. Chưa có con số route-specific thì request chưa sẵn sàng approve.

Dùng purpose=benchmark và per-run request guard cho các campaign có chủ đích này, kể cả gọi tên smoke. Mỗi campaign xin riêng; người dùng duyệt protocol cụ thể, không tự xác nhận. Lần sử dụng dự án thật có thể cung cấp evidence thay thế nhưng không lén chèn hành vi thử nghiệm/cancel/child ngoài công việc đã được cho phép.

## 8. Các khoảng trống cần implement để protocol chạy đúng

Schema benchmark-request hiện có limits cho attempts/tokens/cost; chưa có fields riêng cho native children/user turns/deadline. Các cap bổ sung phải được runner/driver thực thi và ghim trong protocol/manifest; không nhét field chưa hỗ trợ vào schema hiện tại.

Benchmark closure hiện tự completed khi mọi task completed. L2 có planned cancellation nên cần kết quả campaign tách khỏi task execution: completed-check/failed-check/aborted và audit closure sau khi mọi job/usage đã rõ. Chỉ bổ sung lifecycle tối thiểu này khi triển khai L2; không giả đổi task cancelled thành completed, không tái dùng request started. Nếu chưa có closure an toàn, hoãn L2 hoặc dùng evidence phù hợp từ công việc thật.

Source 0.4.0 đã có native protocol fixtures và benchmarks/native/prepare.mjs, grade.mjs cho L1 analysis read-only một root, không children/retries. Preparer tạo request pending, config/protocol/manifest và yêu cầu cost estimate tường minh; không chạy model hoặc tự approve. Native control/checkpoint/input có software fixtures, nhưng L2 thật và closure cho planned cancellation còn conditional/deferred. Các biến thể planning, automation hoặc writer L1 cần protocol/preparer phù hợp trước xin chạy; không suy ra chúng đã được nghiệm thu từ analysis L1.

## 9. H0, báo cáo và tối ưu trong sử dụng

Một walkthrough đọc status/capability, trace C1–C4 đã tạo, một đường pause/recovery mock và artifact L1 nếu có. Người dùng kiểm tra hiểu được output, uncertainty, cách tiếp tục và giới hạn. Tái dùng artifact; không yêu cầu bốn dự án hay bốn model runs.

Báo cáo mỗi gate gồm: scope/version/hash, expected/observed, status, evidence refs, lỗi còn mở, usage provenance và người quyết định nghiệm thu. Giữ failed attempts và chi phí; không chỉ lưu lần cuối pass. Software test pass, live transport pass và human acceptance là các trạng thái khác nhau.

| Không làm benchmark nghiệm thu riêng | Thay bằng | Khi nào cần phép đo riêng |
|---|---|---|
| Novelty, chất lượng proof/ý tưởng trên bài toán mở | Review claim/proof/experiment của dự án thật | Dự án có yêu cầu khoa học cụ thể và protocol được duyệt |
| Một agent vs nhiều agent; hãng/model nào tốt nhất | Ghi outcome/rework/token theo task scope | Có quyết định routing cụ thể mà trace hiện có chưa giải được |
| % tiết kiệm cache/token và throughput chung | Usage/duration sẵn có, so công việc tương đương có chú thích | Một bottleneck lặp lại, phép đo có khả năng thay quyết định |
| Nhiều giờ soak/load test, mọi tổ hợp backend | Fault injection cơ chế + quan sát lỗi thực tế | Triển khai tải/độ tin cậy cao hơn scope đã nghiệm thu |
| UX mô phỏng bằng model; chấm tiện dụng từng lượt | Feedback tự nhiên và review tại milestone | Một thao tác gây ma sát rõ cần nghiên cứu thêm |

Vẫn kiểm cơ chế bounded memory/streams, deadline và control bằng S0/L2 khi áp dụng; trì hoãn long-run metrics không có nghĩa bỏ những giới hạn này. Không buộc logging nặng, chấm điểm hàng ngày hay LLM summary định kỳ. Khi có incident: lưu case tối thiểu -> xác định nguyên nhân -> thêm regression có oracle -> sửa -> dùng tiếp.

## 10. Coverage capabilities bản 4 — không tạo thêm ma trận benchmark

Ma trận C01–C18 trong [khảo sát tích hợp](capability-integration-research.md) được nối vào A01–A10 hiện có như sau. Đây là nghĩa vụ nghiệm thu cho implementation tương lai; software fixtures 0.5.0 chỉ xác nhận scope trong integration-foundation.md, không bao phủ các feature chưa viết. Mỗi slice chỉ thêm assertions có oracle cần thiết vào fixtures phù hợp.

| Capability | S0 tối thiểu và oracle | Native evidence còn cần khi bật | Tái dùng / không chạy riêng |
|---|---|---|---|
| C01/C02/C03/C16: workspace, writers, publication, streaming | A03/A08: hai execution roots từ baseline có dirty/untracked inputs; outputs không chồng được publish đúng. Cùng path/base conflict bị chặn; crash giữa các bước journal phục hồi; path/junction escape bị từ chối; stream bytes được hash chính là bytes pin, memory bounded | Một đường writer thật trên provider/OS được chọn: worker ghi đúng root, core nhận đúng artifact; nếu tuyên bố sandbox, cần evidence enforcement riêng phù hợp | Không cần nhiều model chỉ để tạo conflict/crash: fixture tạo được. Không chạy parallel speed benchmark; hai writer thật chỉ khi cần xác minh native provider concurrency chưa có trace |
| C04/C05/C06: process/session reuse và fork | A01/A04/A05/A09: lease single-owner; compatibility mismatch từ chối reuse; TTL/count/RAM cap; baseline usage không charge history cũ; fork history không tự nhận workspace mới | Một turn tiếp theo trên đúng ID có receipt policy/model/tools/usage và context cần thiết; xác minh fork riêng chỉ nếu bật fork. Process reuse quan sát PID/identity, không đo bằng tự báo của model | Lần tiếp tục công việc thật có thể làm evidence. Không bắt warm process, reused history và fork cùng run; không giả định token savings từ reuse |
| C07/C08/C09/C11: collect/reconnect/continue/jobs | A05/A06/A07: mất reply trước/sau submit; collect không inference; late output fenced; unknown giữ reservation; child còn chạy không settle; continuation chỉ sau reconcile | Với active reconnect phải thấy cùng turn đang chạy, khôi phục control/terminal/usage không tạo turn mới; với stop tree cần identity và bằng chứng descendants dừng đúng scope | Trace sự cố thật hợp lệ có thể thay run. Không cố ngắt/cancel công việc thật để tạo evidence. C08 chưa có route ổn định thì disabled, không bắt benchmark reconnect |
| C10/C12: native group và accounting | A04/A07: vượt count/depth/model/policy bị chặn ở mức đã công bố; aggregate+child không cộng trùng; counter reset/duplicate/out-of-order không bị charge sai; unknown coverage giữ trạng thái rõ | Một child thật là đủ kiểm group path; usage scope và effective policy phải do runtime thể hiện. Tree cancellation chưa được chứng minh chỉ đánh dấu phần đó thiếu, không suy từ parent exit | Gộp vào L2 khi compatible và có oracle. Không benchmark một agent vs nhiều agent để nghiệm thu contract; evaluator independence không được chứng minh chỉ bằng hai session IDs |
| C13: quota | A04: stale/reset/multiple pools/percent-only; unknown không thành zero token budget | P0 metadata snapshot đúng pool/time; sự kiện rate-limit thực tế nếu cần parser | Không tiêu quota để cố làm nó hết; fault injection kiểm cooldown/fallback policy. Phần trăm 5h không dùng làm token oracle |
| C14/C15/C17: context/cache/telemetry | A02/A09/A10: delta thiếu baseline/ACK -> snapshot; required evidence không mất; bundle đổi hash invalidates cache; coalescing giữ terminal/intents/usage; retention không xóa reference; old writer blocked nếu migration | Chỉ cần live nếu thay native context/session semantics; thay cache/I/O nội bộ không tự tạo nhu cầu L1 mới | Script/static sizes và regression đủ cho cơ chế; token savings và responsiveness đo từ dùng thật, không tạo summary/grader model |
| C18: backend kế tiếp | A01/A04–A07 áp vào route được chọn, explicit unsupported; render Windows/auth/model/permissions và usage normalizer | P0 + một L1/trace đúng profile; L2 chỉ capabilities control/group/reuse còn thiếu | Không chạy đủ cả hãng/model/role. SDK/API khác auth/billing không được lấy CLI trace làm bằng chứng tương đương |

Một fixture có thể kiểm nhiều assertions độc lập, nhưng mỗi critical failure point phải có oracle riêng và kết quả không che lỗi sau. S0 crash injection là test phần mềm được cho phép; deliberate native/live fault experiment vẫn là benchmark cần xin riêng.

Ghi evidence theo capability/profile: required, implemented, fixture-verified, native-verified, accepted là các trạng thái riêng. Chỉ cập nhật capability được chứng minh. Pin source và policy mới nếu chỉnh driver; evidence không liên quan vẫn tái dùng, tránh rerun toàn campaign.

Không tăng ngân sách L1/L2 từ các dòng trên: chuẩn bị run cụ thể trong caps mục 7 nếu đủ, hoặc đề xuất scope/caps mới để người dùng duyệt. Nếu không có bằng chứng cho gate cần thiết thì giữ scope pending; “sẽ tối ưu khi dùng” chỉ áp dụng hiệu quả/UX/chất lượng mở, không miễn accounting, permissions, provenance hay recovery safety.

## 11. External MCP/skills — coverage đề xuất

Chi tiết implementation và oracle tại [plan extension, mục 9](external-integration-plan.md#9-nghiệm-thu-tối-thiểu-có-oracle): X1–X8 nối vào các gate ở đây; gồm migration/writer fence dự kiến v4, native effective scope, retrieval/BibTeX integrity và mathematical/statistical fixtures. Đây không là approval chạy live; budget live trong plan là proposal phải đóng băng lại thành protocol/manifest đúng scope trước xin chạy.

[Research E01–E03](external-mcp-skills-research.md) đã có implementation software EX0–EX5 trong source 0.6.0/state4, xem [phạm vi/evidence](extensions.md); native acceptance và benchmark chưa chạy. E04–E06 vẫn theo nhu cầu. Khi mở scope này, dùng lại A01/A02/A04–A10: effective tool allowlist và inherited extras, lock/hash drift, package/script paths, auth/egress scopes, raw response/locators, timeout/job/cancel semantics, usage riêng của provider và rollback. Chỉ thêm fixtures cho phần mới; source 0.5.0 chưa được coi là đã kiểm các gate này.

Một profile thật có thể cung cấp evidence cho đúng skill/tool cần dùng. Không chạy benchmark cho từng server trong catalog, không mặc định chạy SkillsBench hoặc UPskill eval, không lấy tool annotation read-only hay cancel ACK làm bằng chứng quyền/terminal. Nếu chọn một deliberate live experiment, vẫn cần protocol và xác nhận riêng theo mục 7.

Plan cập nhật chọn E01–E03 làm scope extension khởi đầu: binding/lock/effective policy, retrieval/citation, symbolic/numerical/statistical/figure toolchain và bổ sung references vào skills hiện có. Khi implement, kiểm helpers bằng recorded-response/oracle offline: identity/version/partial/error, BibTeX/DOI, assumptions, calculation edge cases và tái tạo figure; kiểm dependency closure, paths và component scope đúng worker. Native/global installed inventory chưa là evidence tích hợp. Tái dùng fixtures/trace hợp lệ, không chạy upstream/model/provider matrix hoặc campaign mới để chứng minh chất lượng nghiên cứu.

M02/Azure/.NET và extension theo stack/domain/platform riêng thuộc E04–E06, không nằm trong required scope nếu chưa bật; không cài hoặc viết tests/adapters trước cho toàn catalog. Baseline E02/E03 đề nghị sẵn sàng từ đầu vì dùng lặp lại không đồng nghĩa mọi task phải load/gọi chúng. Gate quyền, provenance, accounting và recovery vẫn bắt buộc cho mọi scope bật; bất kỳ deliberate live benchmark nào vẫn cần protocol và xác nhận riêng. Source 0.6.0 đã provision local và có deterministic evidence; chỉ các gates có trace đúng profile mới được coi là native-verified/accepted.
