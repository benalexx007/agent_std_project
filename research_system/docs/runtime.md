# Runtime và hợp đồng thực thi v0.7.0

Source hiện tại là research harness software preview 0.7.0. [GUI integration](gui-integration.md) mô tả project entry/CLI services, native-observed và managed routes, config revisions và limits. Hướng dẫn record/feedback/overlay ở [research-workflow.md](research-workflow.md), evidence hiện hành ở [verification/gui-evidence.json](verification/gui-evidence.json); v1-evidence là baseline lịch sử 0.6.0.

V4 giữ compatibility. GUI services cần explicit upgrade-gui v4→v5 khi idle, backup và compatible v5 writer. V5 thêm attachments/config changes/revisions/operations/observations; không đổi scientific contracts. Inspect hỗ trợ v4/v5 mà không migrate. GUI attachment là local binding, không native identity proof. Config+overlay pointer commit cùng SQLite transaction; managed outputs vẫn journaled publication. Xem GUI guide cho rollback/uninstall và separate live acceptance.

Source 0.6.0 dùng state/handoff v4, thêm [Research extensions](extensions.md) với explicit migration/rescue từ v3; nền 0.5.0 trước đó, bổ sung [workspace/publication và native recovery foundation](integration-foundation.md), giữ Codex App Server và portable core. [Codex native](codex-native.md) mô tả commands và mức bằng chứng; các đoạn CLI một lượt dưới đây chỉ áp dụng adapters legacy. Không tự migrate storage hoặc enable external execution.

## Phân chia trách nhiệm

Agent điều phối đọc prepare-orchestrator, phân giải prompt thành task/override/control và quyết định phân công theo policy. Runtime Node không gọi một LLM điều phối ẩn; nó thực hiện admission, dispatch, lưu trạng thái, checkpoint, control và recovery. Một agent khác có thể tiếp quản bằng cùng CLI và artifact.

Role/skill được nạp vào context theo task. Orchestrator backend/model trong config là mô tả lựa chọn của người dùng; prepare-orchestrator tạo gói để agent được chọn sử dụng. CLI không tự thay model đang chạy cuộc chat này.

Preset điều phối mặc định analysis/medium. synthesis_planning/highest là task cố vấn chuyên môn riêng (thường researcher) để tổng hợp analyses, verify/research lại và trả kế hoạch chi tiết cho orchestrator thực hiện. Không tự spawn cố vấn khi attach hoặc hỏi status; scientific planning/replanning được giao khi cần. Policy sửa trong template không tự cập nhật registered config, task/attempt hoặc generated entry của project cũ; dùng cơ chế revision/update có kiểm tra.

model_policy tách ba tầng theo task class khỏi role. Codex hiện có highest=gpt-6-astra/high, medium=gpt-6.1-sol/high, low=gpt-6.1-sol/medium; provider khác chưa cấu hình. Task/attempt lưu selection snapshot và argv Codex truyền effort thật; lịch sử estimate phân biệt cả effort. Planning phải verify/research lại bằng nguồn gốc và audit mới trước completed, xem [model-routing.md](model-routing.md). Các gate chỉ xác minh record/provenance, không tự chứng minh chất lượng nội dung.

Task → work unit → assignment → attempt là các record logic trong một SQLite database. Task không khai báo work_units có một unit main. Unit được khai báo theo thứ tự dependency; runtime không tự đoán cách tách một nhiệm vụ khoa học từ văn bản.

## State v4

Nguồn trạng thái chính: workspace/.agentic/state.sqlite, SQLite WAL với synchronous=FULL. State v1/v2/v3 cần migrate-state với backup, không còn unsettled attempts/jobs hoặc pending publication. Emergency control/reconcile/recover-publication của v3 có chế độ tương thích hẹp trước migration. SQLite writer guard chặn code cũ cập nhật state v4. Publication pending phải được complete/rollback trước dispatch; xem integration-foundation.md. State gồm publications, task, work_units, assignments, attempts, checkpoints, recoveries, pools, decisions, events, runs, claims và ledger usage. Context/output theo attempt và checkpoint manifests nằm trong .agentic.

owner_epoch bảo vệ quyền điều phối; assignment generation bảo vệ quyền thực hiện/tích hợp một unit. Lease/heartbeat chỉ phát hiện trạng thái có thể đã mất, không cấp quyền chạy lại side effect.

Chuyển trạng thái thường gặp:

- Unit: queued → running → completed; unit còn dở có thể yielded, failed, unknown hoặc waiting_for_capacity.
- Assignment: active → ended/unknown; assignment đã chuyển có thể superseded.
- Recovery: ready → transferred, sau đó có outcome; hoặc blocked/waiting_for_capacity.
- Task chỉ completed sau khi mọi unit hiện hành hoàn thành và artifacts/checks phù hợp. Đây là nghiệm thu cấu trúc; evaluator vẫn chịu trách nhiệm khoa học.

Output luôn định tuyến theo attempt ID/revision. Kết quả tới muộn của assignment đã kết thúc không được tự ghi đè; late delivery được lưu riêng khi có. pause/cancel tạo dispatch barrier độc lập với model.

## Admission và budget

Mỗi unit có estimate: work_tokens, validation_tokens, checkpoint_tokens, margin_tokens, cost_usd và context_growth_tokens. reservation_tokens của task phẳng là estimate dùng cho unit main tương thích với cấu hình cũ.

Project giữ reserves cho orchestration, verification và recovery. Attempt bình thường không dùng phần recovery reserve; attempt recovery có thể dùng phần đó nhưng vẫn giữ dự phòng orchestration/verification và trần tổng. Cấu hình legacy mặc định reserves bằng 0; examples/recovery.json cung cấp preset có reserves để review.

Admission kiểm tra trần project, max_total_tokens của task nếu có, số attempt/segment, concurrency, writer overlap, context estimate và tất cả quota pools đã gán cho backend. Reservation được ghi nguyên tử với assignment trước dispatch. Tại bước spawn có kiểm tra barrier/generation lần cuối dưới cùng khóa SQLite.

Context chưa có tokenizer chính xác được ước tính bằng số ký tự/2 và ghi rõ estimated. Đây không phải cách đếm token chuẩn của mọi model. Nếu backend khai báo context_window_tokens, estimate gồm tăng trưởng dự kiến tới checkpoint và dự phòng. max_chars vẫn là giới hạn riêng; không cắt evidence âm thầm.

estimate_key gắn nhãn các unit có workload so sánh được. Khi có đủ mẫu reported cùng backend/model/role và nhãn, admission dùng giá trị lớn hơn giữa estimate cấu hình và phân vị lịch sử cộng dự phòng. Khi thiếu mẫu, giữ configured_estimate. Người điều phối phải gán nhãn đúng; runtime không tự kết luận hai câu hỏi nghiên cứu tương đương.

Quota pool là nhóm tài nguyên dùng chung, không phải tên worker. Snapshot có source, observed_at, precision, remaining_tokens và resets_at. Snapshot thiếu/cũ theo unknown_policy: block hoặc allow_bounded với cảnh báo. Hạn mức phần trăm không được đổi thành token. Không có quota API tự động cho các CLI hiện tại; update-quota nhận số liệu do operator/adapter đáng tin cung cấp.

Pool có concurrency, reserve và cooldown. Rate-limit/quota failure cập nhật cooldown với backoff/jitter; retry_after nếu quan sát được là thời gian chờ tối thiểu. Recovery có thể chọn pool độc lập hoặc trả waiting_for_capacity. Runtime không giữ một vòng gọi model để đợi; operator/scheduler gọi lại recovery sau khi có capacity. Snapshot mới không chứng minh quota được giữ riêng khỏi các ứng dụng ngoài harness.

## Usage và giới hạn

record-telemetry nhận delta hoặc cumulative trong phạm vi một attempt. Cumulative mới thay tổng trước, không cộng lại toàn bộ. Counter đã reset phải thuộc attempt mới; adapter phải chuẩn hóa usage cấp session trước khi gửi. includes_children=true biểu thị một aggregate đã gồm sub-agent, để ledger không cộng thêm child usage lần nữa.

Telemetry tăng reservation nếu chi phí quan sát đã vượt estimate và có thể yêu cầu yielding khi bước tiếp theo không vừa headroom. Mock có live telemetry/yield; CLI một lượt chưa hỗ trợ tín hiệu này theo cùng giao thức. Chúng bị giới hạn qua unit boundaries, timeout, output cap và các tùy chọn native đã thực sự hỗ trợ.

Chi phí đã dùng được quyết toán một lần. Unknown jobs giữ reservation. Thiếu số liệu được ghi unknown/ước tính reservation, không ghi 0 như đã đo. Error envelope có usage có thể được hạch toán dù không có final answer. Usage fixture là số giả định.

Native sub-agent spawning chưa được adapter v0.2 quản lý như một cây budget riêng. Capability native_subagents=false. Muốn worker tự spawn native children cần adapter đăng ký cây/job, chuẩn hóa accounting và kiểm thử quyền/cancel trước khi bật; không có bảo đảm hard cap qua một prompt.

## Checkpoint

save-checkpoint xác minh identity/generation, protocol/input/bundle hashes và artifacts. Manifest được ghi file tạm, fsync rồi rename; chỉ sau đó mới công bố record trong SQLite. Manifest không được công bố là orphan và không được dùng để tiếp tục. Tính bền vững vẫn phụ thuộc hệ điều hành/phần cứng; loader luôn kiểm tra lại file và hash.

Manifest chứa completed/remaining units, summary, remaining_actions, checks, uncertainties, artifacts, inputs, role/skill fingerprints, permissions/decisions, job handles và usage. Nó không sao chép suy luận nội bộ.

Unit completion tự tạo checkpoint. Worker có thể tạo checkpoint giữa lượt qua CLI; mock sử dụng IPC. Khi chuẩn bị recovery, loader chọn manifest hợp lệ mới nhất và có thể lùi về bản trước nếu manifest cuối hỏng. Artifact/input/bundle đã thay đổi sẽ chặn blind reuse; bản v0.2 chưa tự khôi phục filesystem từ snapshot hay hợp nhất diff dở. Operator/agent phục hồi cần kiểm tra diff rồi tạo revision/checkpoint phù hợp.

## Chuyển A sang B

1. Phân loại failure từ structured evidence. Text stderr chứa chữ quota không đủ để tự đổi backend.
2. Xác minh attempt cũ đã kết thúc và side effects/job đã rõ; unknown giữ chặn. Writer cần checkpoint hợp lệ.
3. Giữ completed units. Chọn unit còn lại và checkpoint; tính chi phí tiếp quản trong admission.
4. Chọn ứng viên từ nguồn cũ và recovery_policy.candidates; kiểm tra quyền execute, required capabilities, pool, retry/transfer/segment limits và tiến độ.
5. beginAttempt tăng generation, reserve budget và ghi assignment mới trong một transaction. Task/protocol revision giữ nguyên khi chỉ đổi worker; nguồn/model đổi được ghi vào attempt.
6. B nhận context/checkpoint và remaining units; kết quả cũ tới muộn không tự được tích hợp.

Khởi điểm: 1 retry cùng backend, 2 transfers, 4 segments/unit và 1 recovery không có tiến độ mới; đều có thể cấu hình. Planned yield có bộ đếm riêng và vẫn chịu tổng segment/attempt/budget. Fingerprint tiến độ loại bỏ ID/timestamp; tạo checkpoint ID mới với cùng nội dung không đủ để chứng minh tiến triển.

Quota failure loại ứng viên cùng pool chưa phục hồi; fresh snapshot đủ capacity cùng cooldown đã hết có thể cho phép thử lại. Backend có pool không xác định không được tự coi là độc lập. Không còn nguồn phù hợp thì trả waiting_for_capacity cùng gói bàn giao.

User pause/cancel luôn ưu tiên. Policy không mua credit/reset, đổi tài khoản, mở quyền dữ liệu, tăng budget hay bật external execution.

## External jobs và trạng thái chưa rõ

register-job lưu scheduler/job handle dưới attempt. Root process thoát không làm job ngoài tự completed. Job còn chạy giữ recovery khỏi relaunch; observe-job nhận bằng chứng để xác nhận trạng thái. cancel project vẫn kiểm tra registered job của agent đã completed.

V0.2 chưa có driver hủy/giám sát tự động cho scheduler/GPU từ xa. Khi job còn chạy, operator/agent điều phối theo dõi job cũ qua handle và cập nhật observation; worker thay thế không được khởi tạo bản sao. Native descendants không được đăng ký vẫn có thể tồn tại; CLI cancellation không được quảng bá là dừng toàn bộ cây.

reconcile-state đánh dấu unknown khi runner không còn hoặc lease đã hết. Observation muốn giải quyết unknown cần evidence artifact/hash. Với descendants chưa theo dõi, cần descendants_verified=true và bằng chứng cho cả phạm vi đó. Đây là xác nhận của operator/connector, không phải phép chứng minh rằng file ghi chú bất kỳ xác thực được trạng thái scheduler.

Không signal PID sau reconnect vì PID có thể được dùng lại. Không có exactly-once chung cho external side effects; cần idempotency key hoặc reconcile ở hệ thống đích.

## Migration và đổi config

State v1 được đọc cho status/control; thực thi v2 yêu cầu migrate-state rõ ràng. Migration lưu backup JSON trước khi thay đổi, giữ lịch sử task/attempt và map task phẳng thành unit main. Attempt chưa kết thúc trở thành unknown, không bị coi là job chưa từng chạy. Lệnh migration chạy lại không nhân đôi dữ liệu.

V0.3 thêm namespaces research (schema 1), improvements và benchmarks vào state v2 khi lần đầu sử dụng. Không sửa lịch sử v2 hoặc ép migrate chỉ để có record mới. Research records có revisions bất biến, hash refs, task/input/upstream snapshots, validity tách raw verdict; subject refs giữ quan sát lịch sử, dependency refs làm consumer cần review khi premise đổi. Checkpoint/handoff chứa research refs/history và bundle fingerprints.

Project overlays chỉ thay skill/domain Markdown trong context của project, được snapshot/hash và activate khi không còn active/unknown jobs. Không thay source gốc/personal skills hoặc quyền/model/budget. Rollback bằng change ID trước hoặc original. Checkpoint từ bundle policy khác cần review, không blind reuse.

Benchmark tasks phải khai purpose=benchmark và request ID. Request pin protocol hash, task/config/active bundle và aggregate limits; confirm-benchmark chỉ ghi actual human approval sau câu hỏi kèm tài liệu. Admission/final dispatch kiểm tra lại scope/protocol; request completed không tái sử dụng. Guard là kiểm soát trusted operator cục bộ, không phải authentication độc lập. Native model calls có thể vượt estimate trong một lượt; limits không phải provider hard caps.

Campaign driver có thể khai execution_manifest (path/hash) trong request; manifest được kiểm ở request/confirm/admission/final dispatch cùng protocol. B01 v2 pin manifest, kiểm executable/source/config/input hashes trước mỗi dispatch và journal derived inputs. supersede-benchmark chỉ thay trạng thái request pending chưa có attempt, giữ protocol/history và pointer tới request thay thế; không cấp quyền chạy.

Planning sources trong planning_review được hợp nhất vào result.evidence_refs; kể cả nguồn bổ sung ngoài inputs vẫn tham gia kiểm currentTaskResult khi file đổi. Hướng dẫn planning-verification chỉ nạp cho synthesis_planning và có bundle fingerprint. Xem [model-routing.md](model-routing.md) cho selection/snapshot/fallback và giới hạn attestation.

sync-config yêu cầu owner/epoch hiện tại và không có active/unknown attempt. Các native session ID chỉ là metadata; muốn chuyển máy cần mang config/bundle, state database và artifacts đầy đủ. JSON handoff là gói review/tiếp quản, không phải bản backup nguyên môi trường chạy.

## Capability matrix v0.2

| Interface | Đã kiểm tra cục bộ | Giới hạn cần giữ rõ |
|---|---|---|
| Mock process | Dispatch, live usage, checkpoint, yield, cancel, fallback | Không có LLM hoặc bằng chứng khoa học |
| Manual | Context và import structured result | Người/agent được chọn phải gửi kết quả đúng contract |
| Codex CLI | Dựng argv/stdin và parser JSONL bằng fixture | Chưa live-verify auth/flags; chưa App Server steer/quota API |
| Claude CLI | Dựng argv/stdin và JSON result/error usage parser | Chưa live-verify; chưa SDK streaming interrupt/handoffs |
| agy CLI | Dựng -p và --sandbox cho giao diện đã khảo sát | Chưa live-verify; output text phải chứa JSON, usage giữ unknown |
| Command | Spawn shell=false và parser theo protocol | Operator chịu trách nhiệm command/quyền/telemetry, không phải sandbox OS của harness |

Harness là công cụ điều phối cục bộ cho người dùng tin cậy; một người có thể sửa trực tiếp database/config. Ledger và fencing giúp tính nhất quán, không thay thế sandbox hoặc authentication của backend. Cờ writes_workspace là khai báo ownership; adapter tự thân không chứng minh agent không thể ghi nơi khác.

## Sửa lỗi vận hành v0.3.1

Chi tiết và regression: [operational-review-fixes.md](operational-review-fixes.md). State vẫn v2; fields review history/publication sequence/output snapshots được bổ sung, không sửa lịch sử. Checkpoint và snapshot files phải đi cùng database khi bàn giao.

reopen-task yêu cầu owner/epoch, reason và review rõ ràng; giữ unit completed có evidence hợp lệ, reset unit bị ảnh hưởng và unit dependencies. Không đổi task revision, generation/attempt history hoặc budget. Decline vẫn chặn qua pause/resume và reopen; replacement approval dùng supersedes_decision_id, kể cả một chuỗi replacement. Upstream/inputs đổi vẫn cần kiểm tra; đổi spec dùng revise-task.

Pause lưu trạng thái chờ; resume khôi phục yielded/waiting_for_user/waiting_for_capacity. Manual waiting_for_result không có process/job có thể resume cùng attempt. Runner bắt exception trong completion callback, phân biệt root đã thoát với descendants chưa rõ; không biến mọi exception ở unit sau thành RESOURCE_ADMISSION. Task-level expected outputs được kiểm trước publication cuối; inconclusive không phải giả báo completed.

Outputs được snapshot theo content hash trong .agentic/output-snapshots; mỗi unit giữ receipt riêng, aggregate chọn phiên bản theo publication sequence, kể cả rerun unit có thứ tự spec sớm hơn. Input và evidence không phải output vẫn dùng hash lịch sử. Hash public output cuối cùng và snapshot lịch sử đều được kiểm; không bỏ kiểm tra unit cũ.

save-checkpoint chỉ nhận active/unsettled assignment; failed/cancelled/unknown/settled worker không được ghi checkpoint mới. Final boundary checkpoint được tạo từ result đã validate bởi runner hoặc import-result, không nhận payload tự do của worker đã kết thúc.

Default single unit dành tối đa 10% reservation (không quá 256 tokens) cho checkpoint/margin, giữ nguyên tổng reservation. Pool failures là streak, total_failures giữ tổng lịch sử; success reset streak. Snapshot token dồi dào chỉ reset streak quota_exhausted sau cooldown, không tự chứng minh rate_limit kết thúc.

Windows invocation kiểm executable/argv trước spawn: không tự chạy .cmd/.bat/.ps1 qua shell; cấu hình .exe hoặc Node command adapter. Command line quá 32767 ký tự bị từ chối rõ, không cắt context. Native model final text có thể chuẩn hóa đúng một JSON fence bao toàn bộ message; prose/nhiều fences vẫn bị từ chối, result-json của scripts vẫn strict.

Capabilities tách checkpoint_boundary, checkpoint_midrun và cooperative_yield. Ngoài mock, Codex App Server có protocol fixtures cho usage, steer/input và checkpoint giữa lượt qua dynamic tool. Backend không ghi SQLite trực tiếp; bridge gọi core có fencing. Cooperative yield, warm native session reuse và native_group chưa được bật. CLI legacy giữ boundary-only controls.

research_record_ids chọn roots/dependencies; chỉ reverse-expand evidence/reviews liên quan, không đi xuống mọi sibling hypothesis qua ancestor chung. Empty selection [] là rỗng, excluded_latest_records cho biết phần ngoài packet. Không silently truncate một record hoặc bỏ counterevidence của scope đã chọn.
