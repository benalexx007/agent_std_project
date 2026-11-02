# Implementation 0.5.0 — nền tích hợp bản 4

Ngày: 27/10/2026. Source 0.5.0, state/handoff v3. Đây là lát cắt RT1/RT2 và phần RT3, cùng parallel-writer admission dựa trên snapshot. Không có model inference/benchmark được chạy trong implementation này; mức kiểm chứng là software fixtures. Số liệu cuối nằm trong [verification](verification/v1-evidence.json).

Verification cuối: **186/186 tests pass**, **59 file syntax checks**, demo recovery mock pass. Source fingerprint được đối chiếu lại sau batch; H0 và inference native vẫn pending.

## Scope đã có

| Capability | Implementation | Giới hạn |
|---|---|---|
| C01/C02 | Execution root riêng, control DB duy nhất; snapshot_directory theo manifest, max_files/max_bytes/max_writers; shared_serial mặc định | Chưa Git worktree/native workspace provider; không phải OS sandbox hoặc hard disk/CPU/RAM quota |
| C03/C16 | Stream vào blob theo hash ngoài DB lock; publication intent, base comparison, serialized install/accept, complete/rollback sau crash | Hash validation vẫn synchronous có buffer cố định; recovery có thể phải copy lại temp. Không cam kết filesystem multi-file atomic hoặc power-loss durability của directory entries |
| C07/C09 | Read đúng native thread/turn, export candidate, tách collection và acceptance; checkpoint portable giữ tiến độ đã hoàn tất | Không reattach active stdio, không submit lại turn unknown; history có thể không trả final/usage đầy đủ |
| C11 | Registry jobs hiện có, import unknown yêu cầu owner và evidence dừng root/descendants; registered remote jobs phải resolve riêng | Chứng cứ là operator attestation, chưa tự chứng minh mọi descendant/process tree đã dừng |
| C12 | Counter identity/epoch/scope/baseline, delta accounting, duplicate/out-of-order guards, giữ nguyên reservation semantics | Foundation cho reuse/group; chưa bật reused session hoặc native group. Không tự rebase counter reset |
| C13 | Đọc rate-limit metadata Codex, chọn limit/pool rõ, lưu windows và chặn ordinary usage khi exhausted/denied | Không chuyển % sang tokens, không chuyển paid route, không daemon polling |
| C14/C15 | Scoped context hiện có, paginated resource reads, bounded bundle cache, bỏ role/schema/output instructions trùng ở native prompt | Chưa session delta/ACK; provider prompt cache và quota savings chưa được đo |
| C17 | Streaming có backpressure và heartbeat tách polling giữ từ 0.4.0; payload/file operations mới có giới hạn | Chưa hot tables, usage coalescing hoặc GC tự động |

Các phần warm process/session reuse, native resume/fork, active reconnect, native groups và Claude/Antigravity deep adapters còn theo điều kiện của [plan bản 4](runtime-integration-plan.md). Không thêm SDK/runtime mới khi chưa có workload/model/auth mapping cần chúng. Cross-backend core-managed delegation và model tiers giữ nguyên.

## Cấu hình workspace

[research-isolated.json](../examples/research-isolated.json) là cấu hình mẫu mock; external execution vẫn false:

    "workspace_policy": {
      "mode": "snapshot_directory",
      "include": [],
      "max_files": 512,
      "max_bytes": 67108864,
      "max_writers": 2
    }

Không có workspace_policy hoặc mode=shared_serial giữ một writer/project như trước. Snapshot mode áp dụng cả reader để có execution baseline riêng. Include chỉ định file/thư mục nguồn cần thêm; task inputs, artifacts của dependencies và expected outputs đang có cũng được materialize. Không copy toàn project mặc định.

Đường dẫn canonical dùng dấu /, tương đối. Từ chối traversal, control directories, symlink/junction, Windows device/alias và output aliases. Declared task inputs là bất biến: output không được trùng input. Code cần chỉnh sửa được đưa vào include và expected_artifacts; dữ liệu/primary spec bất biến đưa vào inputs. Khai báo generated evidence thành expected artifact để được publish, không trỏ một evidence ref tới file mới ngoài publication scope.

Worker chỉ nhận thư mục thực thi; bridge giữ control_root ở kênh core. Native prompt không chứa đường control DB. Đây là cô lập workspace logic; quyền filesystem thật vẫn do backend/OS profile enforce. Không chọn command backend thiếu sandbox cho công việc cần sandbox chỉ vì nó có snapshot.

Snapshot checkpoint pin partial artifacts thành blob mà không công bố chúng. Khi tiếp tục, core materialize bindings về đúng logical paths. Research records tham chiếu artifact mới được ghi sau publication, hoặc tham chiếu artifact đã công bố; chưa có đường publish research record với filesystem riêng giữa turn.

## Publication và phục hồi

Luồng: validate execution result -> pin immutable blobs/candidate -> kiểm revision/owner/dependencies/input/base -> durable intent -> install public files -> accept result và journal trong DB. Dispatch mới bị chặn khi publication pending; API currentTaskResult không coi kết quả đang công bố là current.

Artifact baseline thay đổi: trả conflict và giữ publication-candidate.json cùng execution files; không overwrite bản khác. Worker không được chạy lại chỉ để giải quyết copy/publication. Writer độc lập có thể execute song song, nhưng publication được serialize. max_writers là cap do người dùng chọn cho host; chưa có scheduler tự đo CPU/GPU/RAM.

Xem trạng thái và phục hồi bằng command deterministic:

    node scripts/harness.mjs status --workspace PATH
    node scripts/harness.mjs recover-publication --workspace PATH --owner local --epoch 1 --action complete
    node scripts/harness.mjs recover-publication --workspace PATH --owner local --epoch 1 --action rollback

Complete cần assignment/owner hiện hành và mọi target còn là baseline hoặc proposed bytes. Rollback khôi phục baseline, không overwrite third-party edits. Rollback giữ attempt unknown/reservation để đối soát executor/jobs; không chứng minh worker dừng. Owner takeover không được tự nhận output của owner cũ: complete bị fence, rollback có kiểm conflict.

Nếu directory rename/fsync hoặc máy mất nguồn khiến không còn baseline/proposed bytes, recovery báo conflict và giữ barrier; cần evidence/khôi phục thủ công. Không suy process-crash tests thành bảo đảm power-loss trên mọi filesystem. Không đặt SQLite WAL trên network filesystem.

Không GC tự động trong slice này. Execution roots, manifests, journal và blobs được giữ để review/recovery. Per-attempt transfer caps và project max_attempts giới hạn materialization dự kiến; chúng không thay hard OS disk quota hoặc policy retention cho dự án dài.

## Native collect, import và quota

Các lệnh mặc định chỉ preview; --execute cho các lệnh đọc này không tạo model turn:

    node scripts/harness.mjs collect-native --config CONFIG --attempt ID --execute --out candidate.json
    node scripts/harness.mjs refresh-native-quota --config CONFIG --backend NAME --pool POOL --limit LIMIT --execute

Collect dùng đúng turn_id đã ghi; thiếu ID sau lost submit reply thì không đoán last turn. Chỉ nhận final JSON từ turn completed, bỏ model-reported usage; candidate chưa được accepted và không giải phóng reservation. Core không tự thông báo metadata chứa account identifiers.

Import unknown cần operator xác nhận root và descendants đã dừng. Registered external jobs dùng observe-job với evidence riêng trước. Observation JSON:

    {
      "attempt_id": "attempt_ID",
      "descendants_verified": true,
      "evidence": [{"path": "evidence/stopped.json", "sha256": "OBSERVED_SHA256"}]
    }

    node scripts/harness.mjs import-result --config CONFIG --attempt ID --file candidate.json --observation stopped.json --owner local --epoch 1

Không dùng observation giả hoặc chỉ dựa PID còn sống/không sống. Native usage bị mất một phần không được nhận từ model JSON; import recovered native result dùng reservation estimate khi không có terminal accounting đủ. Scientific/provenance gates vẫn áp dụng.

Quota refresh yêu cầu backend có gán đúng quota_pool_ids và chọn limit_id tường minh. Snapshot lưu phần trăm/windows/reset riêng, remaining_tokens=null. Unknown policy của pool vẫn áp dụng; metadata exhausted hoặc ordinary usage denied chặn admission. Không tự nâng quyền, đổi account, chuyển API billing hoặc polling bằng LLM.

## Migration v2 -> v3 và rollback

    node scripts/harness.mjs migrate-state --workspace PATH

Migration v2 yêu cầu không còn active/unknown/unsettled attempts. Backup JSON được ghi trước, nội dung được so lại trong transaction; thay đổi giữa backup/commit làm migration bị từ chối. Config và lịch sử không bị reset. State v1 vẫn có đường migrate, giữ unfinished attempts ở unknown.

State v3 có SQLite trigger đòi hàm harness_writer_version() của runtime tương thích. Binary cũ thiếu hàm bị từ chối UPDATE dù mở trực tiếp DB; không chỉ dựa số schema. Store mới không cho downgrade schema qua transaction thông thường. Handoff v3 chứa publication journals.

Rollback code về 0.4.0 không được tiếp tục ghi DB v3. Cần dừng/đối soát mọi attempt, giải quyết publication, rồi khôi phục backup nhất quán vào workspace riêng để review; không ghi đè DB đang mở hoặc xóa evidence mới. Handoff/export và blobs cần được giữ khi khôi phục.

## Verification và scope chưa xác nhận

Tests mới kiểm baseline conflict, partial install/crash, rollback/new files, stale owner, checkpoint materialization, Windows paths/junctions, byte budget, old writer, actual fixture-created output, bridge Store root, usage scope/baseline/reset, paged bytes/cache, native history/quota và termination evidence. Pause/cancel trước spawn giữ zero model usage và resume đúng unit. Lỗi chuẩn bị chưa spawn ghi usage=0; nếu transaction rollback sau khi đã thử spawn, giữ unknown/job identity/reservation vì DB rollback không hoàn tác process OS. Đây là các fixture deterministic có oracle; không phải benchmark nghiên cứu.

Source/schema changes làm evidence manifest/P0 source fingerprint cũ trở thành lịch sử. Binary protocol pin vẫn được giữ, nhưng P0 cũ không chứng nhận candidate 0.5.0. Khi bật native profile cần preflight/evidence đúng scope theo [protocol](acceptance-minimal-protocol.md); mọi benchmark riêng vẫn cần người dùng duyệt kèm tài liệu.
