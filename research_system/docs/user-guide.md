# Hướng dẫn sử dụng Research System

**Dành cho người dùng làm việc với AI orchestrator qua GUI của backend.**

Phiên bản tài liệu: **31/10/2026**, áp dụng cho source **0.7.0**, cập nhật phân công orchestrator/cố vấn. Hệ thống hiện là software preview: đã có kiểm tra phần mềm, nhưng đường GUI/model/native subagent thực tế còn cần xác minh khi sử dụng. Tài liệu mô tả chức năng đã triển khai; không coi tạo file kết nối là bằng chứng backend đã nạp và thực thi đúng mọi chức năng.

Kiểm tra 31/10 xác nhận routing/cố vấn, nhưng 13 scientific-helper tests hiện bị chặn do Python nền khác hash đã pin. Xem [báo cáo kiểm tra](verification/advisor-routing-2026-10-31.md); không coi môi trường helper đã sẵn sàng chỉ vì source đã được cập nhật.

Bạn chủ yếu giao việc, trao đổi và review kết quả trong chat. Orchestrator chịu trách nhiệm gọi script, chuẩn bị cấu hình, chia việc và ghi nhận tiến độ. **Không cần tự viết task JSON hay học toàn bộ CLI để bắt đầu.** Các lệnh ở phần cuối phục vụ thiết lập thủ công và cứu hộ khi cần.

Không cần dán toàn bộ tài liệu này vào mỗi phiên chat. Dùng entry skill ngắn để khởi động; chỉ yêu cầu orchestrator đọc phần hướng dẫn liên quan khi cần.

## Đọc theo nhu cầu

| Bạn đang cần | Đọc phần |
|---|---|
| Bắt đầu với một project mới | 1–4 |
| Giao việc và review nghiên cứu | 5–6 |
| Đổi cấu hình, model, skill hoặc công cụ | 7–8 |
| Theo dõi, cắt ngang hoặc tiếp tục công việc | 9–11 |
| Xử lý lỗi, sao lưu và gỡ kết nối | 12–13 |
| Tự thao tác terminal hoặc xem tài liệu kỹ thuật | 14–15 |

## 1. Hiểu hệ thống trong vài phút

Bạn mở một project trong GUI của backend và trao đổi với agent tại đó. Agent này là **orchestrator**, tức người điều phối. Khi cần, nó dùng subagent của cùng backend hoặc gọi một worker thuộc backend khác.

Orchestrator mặc định thuộc nhóm **analysis** (Codex Sol High). Khi cần lập hoặc sửa kế hoạch khoa học có ý nghĩa, nó giao nhiệm vụ **synthesis_planning** cho cố vấn chuyên môn (Astra High): nhận các analyses và bằng chứng gốc, tự kiểm tra/research lại rồi trả kế hoạch chi tiết cho orchestrator tổ chức thực hiện. Cố vấn giống giáo sư đứng sau nhóm, không phải agent quản lý nhóm thứ hai. Câu hỏi nhỏ và thao tác thường lệ không bắt buộc gọi cố vấn.

Research System cung cấp hướng dẫn nghiên cứu, cấu hình dự án và bộ công cụ giữ tiến độ/bằng chứng ngoài lịch sử chat. Vì vậy, khi chat dài, đổi phiên hoặc cần phục hồi, orchestrator có thể đọc lại trạng thái đã lưu thay vì chỉ dựa vào trí nhớ hội thoại.

| Từ thường gặp | Ý nghĩa dễ hiểu |
|---|---|
| Backend | Nền tảng agent như Codex, Claude hoặc Antigravity |
| Orchestrator | Agent bạn đang trao đổi, chịu trách nhiệm điều phối |
| Cố vấn synthesis_planning | Agent tổng hợp/kiểm chứng và lập kế hoạch khoa học cho orchestrator, thường mang role researcher |
| Native subagent | Agent con được tạo bằng cơ chế sẵn có của backend |
| Managed worker | Worker do harness gọi qua adapter và theo dõi trong phạm vi nó quản lý; có thể thuộc backend khác |
| Harness/core | Các script và dữ liệu giữ luật thực thi, trạng thái, quyền, ngân sách và bằng chứng |
| Task | Một phần việc có mục tiêu, đầu vào, đầu ra và điều kiện hoàn thành |
| Work unit | Một đoạn nhỏ trong task, thuận tiện cho checkpoint/phục hồi |
| Attempt | Một lần thực hiện một work unit; chạy lại tạo attempt mới |
| Artifact/evidence | File kết quả hoặc bằng chứng để đối chiếu và review |
| Checkpoint | Mốc tiến độ đã lưu để tiếp tục hoặc bàn giao |
| Revision | Phiên bản của task hoặc cấu hình; mỗi loại có lịch sử riêng |
| Attachment/binding | Kết nối cục bộ giữa phiên điều phối và đúng project |

Ba vai trò **researcher, implementer, evaluator** là ba trách nhiệm phải được thực hiện. Chúng không bắt buộc tương ứng với ba agent riêng ở mọi bước. Một việc nhỏ có thể do một agent thực hiện; một nhánh cần đánh giá độc lập có thể giao worker khác.

## 2. Chuẩn bị trước khi bắt đầu

Bạn cần xác định:

1. **Thư mục project**: nơi chứa tài liệu, code, dữ liệu và kết quả nghiên cứu.
2. **Mục tiêu**: câu hỏi hoặc vấn đề muốn tìm hiểu.
3. **Đầu ra trước mắt**: chẳng hạn bản phân tích giả thuyết, suy dẫn toán học hoặc thiết kế thực nghiệm.
4. **Giới hạn làm việc**: tài liệu được phép đọc, phạm vi sửa file, có được chạy code/truy cập mạng hay chưa, và ngân sách bạn chấp nhận.

Phân biệt hai thư mục:

| Thư mục | Ví dụ | Chứa gì |
|---|---|---|
| Bộ hệ thống | `D:\Code\AI\agentic_std_proccess\research_system` | Source, scripts, schemas, skills dùng chung |
| Project nghiên cứu | `D:\Research\my-study` | Dữ liệu, code, kết quả và trạng thái riêng của dự án |

Đường project trong tài liệu là ví dụ; thay bằng thư mục của bạn. Không cần chép toàn bộ bộ hệ thống vào từng project. Connection của project tham chiếu về bộ hệ thống dùng chung.

Điều kiện kỹ thuật: Node.js **>=24**, backend và quyền đọc/chạy script phù hợp. Backend subscription, đăng nhập, model sẵn có và quyền của GUI vẫn do backend quản lý. Orchestrator có thể kiểm tra và báo thiếu; một prompt không tự cấp thêm quyền hệ điều hành.

### Prompt để chuẩn bị project

Sao chép mẫu này vào GUI mà bạn muốn dùng làm orchestrator:

```text
Tôi muốn dùng Research System cho project sau:

- Thư mục project: D:\Research\my-study
- Bộ hệ thống: D:\Code\AI\agentic_std_proccess\research_system
- Backend điều phối đầu tiên: Codex GUI.
- Câu hỏi nghiên cứu: [mô tả câu hỏi].
- Đầu ra vòng đầu: [mô tả đầu ra cụ thể].
- Quyền hiện tại: [đọc tài liệu/sửa file/chạy code/truy cập mạng].
- Ngân sách hoặc giới hạn: [điền giới hạn; nếu chưa biết, hãy đề xuất].

Hãy đọc integrations/research-project/SKILL.md trong bộ hệ thống,
kiểm tra trạng thái project và chuẩn bị kết nối/config phù hợp.
Nếu project chưa được khởi tạo, hãy tạo config riêng cho project.
Nếu đã có state, hãy giữ tiến độ và kiểm tra phiên bản trước khi thay đổi.

Trước mắt chỉ chuẩn bị và báo cáo preflight; chưa chạy worker model,
thực nghiệm nghiên cứu hoặc benchmark.
```

Mẫu này yêu cầu chuẩn bị; khi muốn chạy công việc thật, bạn giao mục tiêu và cho phép giai đoạn đó ở phần 5. Không cần chờ xác nhận lại cho từng thao tác thông thường đã nằm trong quyền bạn cấp.

## 3. Kết nối lần đầu: điều gì sẽ xảy ra?

Orchestrator thực hiện các bước dưới đây. Bạn chủ yếu xem phần tổng kết và xử lý những thông tin còn thiếu.

| Bước | Orchestrator làm gì? | Bạn nên nhận được gì? |
|---|---|---|
| Kiểm tra ban đầu | Xem workspace, Node, config/state và backend được chọn | Đúng project; các thiếu hụt được nêu rõ |
| Chuẩn bị config | Chọn template, đặt đường dẫn và mục tiêu, giữ giới hạn đã thống nhất | Config của project, quyền/model/budget có thể review |
| Tạo connection | Tạo entry skill và thông tin gọi script trong project | Các file kết nối; chưa có nghĩa GUI đã load chúng |
| Khởi tạo/nâng state | Init nếu chưa có; migrate/upgrade rõ ràng nếu cần | State phù hợp; upgrade có backup và bị chặn khi còn việc chưa rõ |
| Attach | Tạo binding theo project và owner epoch hiện tại | Attachment ID và đường auth file; token không đưa vào chat |
| Kiểm tra sau attach | Đọc status, frontier và inspect | Revision hiện hành, việc đang chờ và capability còn unknown |

**State v4 vẫn dùng được cho luồng core cũ. GUI services cần state v5.** Với project v4 đang idle, `upgrade-gui` tạo backup rồi nâng lên v5. Project cũ hơn cần xử lý theo migration tương ứng trước. Không sửa trực tiếp số phiên bản trong DB.

Các file entry theo host:

| Host điều phối | Entry trong project |
|---|---|
| Codex | `.agents/skills/research-project/SKILL.md` |
| Claude | `.claude/skills/research-project/SKILL.md` |
| Antigravity | `.agents/skills/research-project-antigravity/SKILL.md` |

Cùng thư mục entry có `connection.json` và `host.json`. Với Antigravity, dùng đường đọc entry trực tiếp cho đến khi loader của đúng App/IDE surface được xác minh. Không suy hành vi GUI từ việc CLI đã có version hợp lệ.

### Nếu GUI không tự nhận skill

Bạn có thể yêu cầu đọc file trực tiếp. Ví dụ cho Codex:

```text
Hãy đọc D:\Research\my-study\.agents\skills\research-project\SKILL.md
và connection.json bên cạnh. Dùng các đường Node/harness được ghi ở đó
để attach project, rồi báo status và những việc đang chờ.
```

Nếu chưa có entry, dùng prompt chuẩn bị ở phần 2. Không giả rằng viết tên skill trong chat là đã cài hoặc kích hoạt thành công.

### Điều kiện để bắt đầu công việc thật

Trước lần chạy đầu, nên biết rõ: project nào, model/effort mong muốn, route nào sẽ thực hiện, có quyền làm gì, giới hạn nào được bảo đảm và giới hạn nào chỉ là ước tính. Chưa xác minh được một capability thì để unknown hoặc chọn route đáp ứng được yêu cầu.

## 4. Dùng template đúng mục đích

Các file trong `examples/` là điểm bắt đầu, không phải cấu hình tài khoản đã sẵn sàng chạy thật.

| Template | Phù hợp để tham khảo |
|---|---|
| `examples/research.json` | Cấu trúc config cơ bản; mặc định dùng mock/manual và tắt external execution |
| `examples/codex-native.json` | Managed Codex App Server workers; có backend đọc và ghi riêng |
| `examples/research-isolated.json` | Workspace snapshot và publication có kiểm soát |
| `examples/research-extensions.json` | Profiles cho research helpers; mặc định chưa bật |
| `examples/codex-native-extensions.json` | Managed Codex workers kết hợp scoped helpers |

**Mock là worker giả lập dùng kiểm tra phần mềm.** Task mock hoàn thành không chứng minh model thật đã làm nghiên cứu.

Một số template lưu pin phiên bản backend từ thời điểm kiểm tra trước. Orchestrator phải đối chiếu binary/protocol đang cài trước live execution; không chỉ sửa chuỗi version cho khớp để bỏ qua kiểm tra tương thích. Các ví dụ tên lệnh như `codex` cũng cần được resolve đúng executable trên Windows; không tự bọc `.cmd` bằng shell để lách kiểm tra.

`study_type` của project/task là `empirical`, `reproduction`, `theoretical` hoặc `survey`. Mục tiêu phát triển tri thức trong `research_profile.goal` có thể là `discovery`, `extension`, `reproduction` hoặc `synthesis`. Hai trường này mô tả hai khía cạnh khác nhau; để orchestrator chọn theo mục tiêu thay vì giữ mặc định chỉ vì template đã có.

Kết quả của **dự án nghiên cứu** vẫn có thể là paper, proof, report hoặc artifact. Báo cáo xây dựng hệ thống agentic không giới hạn đầu ra của mọi project thành báo cáo.

## 5. Giao việc hằng ngày

### 5.1. Giao một bước nghiên cứu

Một yêu cầu tốt nói rõ câu hỏi, bằng chứng có sẵn, đầu ra và giới hạn. Ví dụ:

```text
Hãy bắt đầu vòng nghiên cứu đầu tiên cho câu hỏi:
Quy tắc chọn ngưỡng gradient clipping ảnh hưởng thế nào đến ổn định
của SGD khi nhiễu có đuôi nặng?

Đầu tiên hãy khảo sát nguồn sơ cấp liên quan, xác định giả định và
đề xuất các giả thuyết có thể bác bỏ. Nếu cần, khai triển một mô hình
toán đơn giản để làm rõ dự đoán. Hãy chỉ ra chỗ chưa biết và thiết kế
thực nghiệm phân biệt các lời giải thích cạnh tranh.

Được phép đọc tài liệu công khai và ghi kết quả vào project.
Chưa chạy thực nghiệm; báo lại thiết kế, tài nguyên và tiêu chí đọc
kết quả trước khi bước sang giai đoạn đó.
```

Đây là ví dụ giao việc, không phải tuyên bố câu hỏi hoặc phương pháp này mới. Tính mới cần đối chiếu tài liệu và đánh giá chuyên môn.

### 5.2. Với tác vụ nhỏ

Bạn có thể yêu cầu trực tiếp:

```text
Kiểm tra bước biến đổi thứ ba trong derivation này. Nêu điều kiện
để phép đổi thứ tự kỳ vọng và đạo hàm hợp lệ; sửa lập luận nếu cần.
Chỉ tạo thêm worker nếu có lý do cụ thể.
```

Orchestrator có thể xử lý inline. Không cần một planner và ba worker cho mọi câu hỏi. Khi phát sinh claim hoặc artifact cần truy vết, hãy ghi bằng chứng/trạng thái phù hợp vào project.

### 5.3. Với công việc lớn

```text
Hãy chia mục tiêu thành các phần có đầu ra và điều kiện hoàn thành
rõ ràng. Tách nhánh có thể làm độc lập, ghi dependencies, checkpoint
và ngân sách dự kiến. Dùng worker khi có lợi ích; giữ một điểm tích hợp
kết quả. Giao cố vấn synthesis_planning tổng hợp các analyses kèm
bằng chứng gốc, tự kiểm nguồn và research lại rồi trả kế hoạch chi
tiết cho orchestrator triển khai. Không coi analysis là ground truth.
```

Một task nên đủ nhỏ để giữ được tiến độ khi phải chuyển worker. Không có một kích thước token cố định phù hợp mọi dự án; phân chia theo đầu ra có thể kiểm tra và điểm bàn giao thực tế.

### 5.4. Chuyển sang implementation/thực nghiệm

Sau khi xem thiết kế, bạn có thể cho phép một phạm vi cụ thể:

```text
Tôi đồng ý thực hiện phương án đã review, trong giới hạn sau:
[datasets, số lần chạy, tài nguyên, thời gian và ngân sách].
Hãy implement và chạy phần việc này, lưu code/config/seed/raw results
để tái kiểm tra. Báo riêng kết quả quan sát được, diễn giải và những
giả thuyết chưa được kiểm chứng.
```

Nếu đang bị chặn bởi execution policy hoặc một human decision chưa có, orchestrator phải xử lý đúng cổng đó. Không tự đổi task thành mock để báo công việc thật đã hoàn thành.

## 6. Review kết quả nghiên cứu

Khi nhận kết quả, bạn không cần chỉ hỏi “đã xong chưa”. Có thể dùng:

```text
Hãy tổng kết theo các mục:
1. Những gì đã thực hiện và artifacts tương ứng.
2. Những claim hiện có bằng chứng hỗ trợ, kèm phạm vi giả định.
3. Những bước toán học còn nghĩa vụ chứng minh.
4. Phản chứng, kết quả âm và các cách giải thích cạnh tranh.
5. Bước tiếp theo có giá trị nhất và lý do.
```

| Trạng thái/kết quả | Có thể kết luận | Chưa thể tự kết luận |
|---|---|---|
| Process/attempt đã kết thúc | Lần thực hiện đã kết thúc theo observation được ghi | Task đạt mục tiêu khoa học |
| Result hợp lệ, task `completed` | Qua các hợp đồng/schema/evidence tương ứng | Lập luận đúng về ngữ nghĩa hoặc ý tưởng mới |
| Claim được ghi là supported | Có record/bằng chứng đáp ứng điều kiện ghi nhận | Đúng trong mọi trường hợp hoặc không còn confounder |
| Proof/review receipt được lưu | Có thể truy vết nội dung, phương pháp và bằng chứng review | Tương đương formal proof nếu chưa dùng verifier phù hợp |

Evaluator có thể kiểm bằng phương pháp khác, đối chiếu nguồn, phản ví dụ, tính toán độc lập hoặc thực nghiệm. Đổi sang model khác tự nó chưa bảo đảm độc lập. Khi cần formal verification hoặc công cụ chuyên ngành, hãy yêu cầu toolchain phù hợp cho project đó.

## 7. Tùy chỉnh hệ thống qua hội thoại

### 7.1. Nói rõ phạm vi thay đổi

| Cách yêu cầu | Phạm vi nên hiểu |
|---|---|
| “Riêng bước này…” | Task override hoặc hướng dẫn cho phần việc hiện tại |
| “Từ giờ trong project này…” | Project config/instruction revision |
| “Dùng cho các project sau…” | Thay template/default có chủ đích; không tự áp lên project đang tồn tại |

Ví dụ:

```text
Riêng task tiếp theo, dùng evaluator để kiểm giả định độc lập.
Giữ ngân sách và quyền hiện có.
```

```text
Từ giờ trong project này, context.max_chars là 30000.
Hãy preview thay đổi, kiểm tra tính hợp lệ và áp dụng khi an toàn.
```

```text
Thêm yêu cầu luôn trình bày phản chứng trước kết luận vào hướng dẫn
nghiên cứu riêng của project. Hãy chuẩn bị instruction overlay có
review/check evidence rồi kích hoạt qua revision, giữ hướng dẫn gốc.
```

Config chỉ nhận các trường đã có schema. Một chức năng chưa tồn tại cần công việc sửa code/skill có kiểm tra; không phải thêm một key tùy ý là chức năng sẽ hoạt động.

### 7.2. Chu trình thay đổi

Orchestrator đọc revision hiện hành → chuẩn bị patch và ảnh hưởng → kiểm tra → lấy xác nhận nếu còn thiếu → apply ở thời điểm an toàn → báo revision đã có hiệu lực.

Bạn nên nhận được: thay đổi gì, ảnh hưởng task nào, có hoãn không, và đã có hiệu lực ở core hay còn cần thao tác/reload của host.

- `ready`: đã chuẩn bị, chưa đồng nghĩa đã apply.
- `pending_user`: còn cần xác nhận tương ứng.
- `deferred`: activation bị hoãn, thường do còn execution/operation chưa resolved.
- `applied`: config/overlay pointer đã commit ở revision mới.

Worker đang chạy giữ cấu hình đã đóng băng. Task đã đăng ký cũng có spec riêng; đổi model/input/protocol của task đó cần revise rõ ràng. Thay project config không tự biến mọi attempt cũ thành attempt dùng model mới.

Trong patch: object được merge; array được thay cả mảng; `null` xóa field nếu schema cho phép. Không sửa file JSON cũ rồi mặc định coi đó là config active của state v5: **registered snapshot trong DB mới là nguồn active**. Inspect báo drift nếu candidate file khác snapshot.

### 7.3. Những thay đổi cần xác nhận

Hiện các thay đổi execution, autonomy/quyền, backend, extensions, budget/quota, workspace policy, project hoặc research profile được phân loại protected. Chúng dùng exact-digest confirmation qua `confirm-gui-change`; agent không được tự ký thay con người.

Orchestrator chuẩn bị preview và thông tin confirmation để bạn review. Với CLI transport hiện tại, bước confirmation là human CLI path; việc bạn nói đồng ý trong chat chưa tự tạo một receipt xác nhận đã được host chứng thực. Đây là local attestation trong cùng tài khoản OS, không phải hệ thống xác thực con người độc lập.

Task decisions như đổi câu hỏi chính/tiêu chí thành công dùng decision tương ứng; benchmark có cổng riêng. Không cần xin lại những quyền đã được cấp và còn đúng phạm vi/revision.

### 7.4. Quay lại cấu hình cũ

```text
Hãy so sánh cấu hình hiện hành với revision 2. Tôi muốn quay lại
cấu hình/overlay của revision đó. Chuẩn bị rollback và nêu ảnh hưởng
trước khi apply.
```

Rollback tạo revision mới để giữ lịch sử. Nó không hoàn tác file kết quả đã công bố, thực nghiệm đã chạy hoặc chi phí đã phát sinh. Nếu rollback làm đổi phần protected thì vẫn phải qua confirmation tương ứng.

## 8. Model, backend, subagent và công cụ bổ sung

### 8.1. Ba tầng model đang cấu hình

Đây là mapping của project, không phải cam kết model đang có trên tài khoản hoặc model picker GUI đã đổi:

| Công việc | Tầng | Model/tuyến mặc định |
|---|---|---|
| Cố vấn tổng hợp analyses, research/verify lại và trả kế hoạch cho orchestrator | Highest | `gpt-6-astra`, effort `high` |
| Orchestrator, analysis, implementation, evaluation và trao đổi cần suy luận | Medium | `gpt-6.1-sol`, effort `high` |
| Thực hiện quy trình đã thiết kế, ít quyết định mới | Low | Antigravity: `gemini-3.8-flash-high`, effort `high` |

Việc xác định được làm bằng script thì không cần thêm model chỉ để thực hiện. Claude chưa có tier mapping; Antigravity chỉ có low cho automation. Low là tầng phân công, không phải mức reasoning: Flash High vẫn nằm tầng low. Quyền và khả năng truy cập model trên tài khoản còn cần xác minh khi dùng thật.

Trong preset mới, model_policy.default_task_class và model_policy.orchestrator_task_class đều là analysis; block orchestrator.task_class trong preset native cũng là analysis. Đây là mặc định phân công, không tự đổi model GUI. Một task synthesis_planning riêng (ví dụ researcher) chọn highest; orchestrator vẫn dùng analysis khi nhận kế hoạch về.

model_policy.task_class_backends.automation=antigravity đặt tuyến mặc định cho automation mới. Explicit backend/model và task đã đăng ký không tự đổi; nếu muốn chuyển task cũ, yêu cầu revision/override chỉ rõ backend antigravity và task_class automation. Sol Medium trong codex.low là lựa chọn tương thích khi chủ động chọn Codex, không phải tuyến mặc định hoặc fallback ngầm của automation. Mẫu override-automation.json đã chọn Antigravity; permissions vẫn phải được cấp đúng scope.

Giao cố vấn bằng native subagent nếu đáp ứng đúng model/effort và yêu cầu task, hoặc managed worker phù hợp. Nếu không có đường đáp ứng, báo rõ và xử lý lựa chọn với người dùng; không âm thầm dùng Sol High rồi coi là đúng tầng cố vấn. Config không tự đổi model GUI theo từng hành động.

Project đã tạo trước 31/10/2026 không tự nhận mặc định mới. Yêu cầu orchestrator chuẩn bị thay đổi hai trường mặc định và orchestrator.task_class cũ nếu có; rà model/model_tier chỉ định trực tiếp. State v5 dùng preview/apply theo revision, task đã đăng ký cần explicit revision và entry skill đã sinh cần cập nhật có kiểm tra. Xem [model routing](model-routing.md) để chuyển đổi mà không sửa lịch sử hoặc ngắt việc đang chạy.

### 8.2. Khi nào dùng native, khi nào dùng managed?

| Tình huống | Cách xử lý |
|---|---|
| Hỏi trạng thái/thao tác xác định | Gọi core hoặc trả lời trực tiếp |
| Một bước nhỏ, không có yêu cầu vượt khả năng native | Có thể inline |
| Nhánh độc lập cùng backend | Có thể native subagent sau assessment |
| Worker thuộc backend khác | Managed adapter phù hợp |
| Cần capability mà native-observed chưa bảo đảm | Managed nếu đáp ứng được; nếu không thì báo blocked |

Native-observed không hứa hard budget, sandbox độc lập hoặc guaranteed interrupt. Những task yêu cầu live usage/steer… không được mượn guarantees từ managed adapter. Scoped extension tasks và benchmark dùng route được kiểm soát tương ứng.

Bạn có thể yêu cầu: “Ưu tiên native nếu đáp ứng yêu cầu, nêu lý do khi chọn managed.” Khả năng liên backend vẫn được giữ, nhưng không nên gọi mọi backend cho mọi task chỉ để đủ số agent.

### 8.3. MCP/skill/helper nào đang bật?

```text
Hãy mở inspect phần skills và capabilities. Phân biệt công cụ được
config cho phép, công cụ task đang chọn và inventory thực tế đã quan
sát được. Liệt kê những phần chưa biết, không suy từ tên backend.
```

Core helpers hiện có phục vụ retrieval/citation, toán symbolic, thống kê, hình và PDF theo profiles. Orchestrator phải kiểm tra profile, environment, quyền và scope trước khi dùng. Có source/helper đã provision không có nghĩa profile đã bật. Không cần cài lại environment ở mỗi lần attach.

Với công cụ chuyên ngành:

```text
Project này cần [công cụ]. Hãy kiểm tra backend/core hiện có đã đáp
ứng chưa. Nếu chưa, đề xuất integration phù hợp, phạm vi cài, quyền,
chi phí và cách kiểm chứng. Chỉ cài phần cần cho project này.
```

Không bật thêm MCP/skill chỉ vì có trong catalog. Native đã đáp ứng đúng contract thì có thể tái sử dụng; khi cần receipt/output có cấu trúc mà native không cung cấp, dùng helper phù hợp.

## 9. Xem tiến độ và cấu hình trên terminal

Trong chat, bạn chỉ cần nói:

```text
Hãy xuất inspect dễ đọc trên terminal: project, model policy,
skills/capabilities, config revision, task đang chạy/chờ và pending
decisions. Chỉ đưa tóm tắt liên quan vào chat.
```

Muốn tự xem, từ thư mục bộ hệ thống:

```powershell
node scripts/harness.mjs inspect-project --workspace 'D:\Research\my-study'
node scripts/harness.mjs inspect-project --workspace 'D:\Research\my-study' --section runtime
node scripts/harness.mjs inspect-project --workspace 'D:\Research\my-study' --section capabilities
node scripts/harness.mjs inspect-project --workspace 'D:\Research\my-study' --full
node scripts/harness.mjs inspect-project --workspace 'D:\Research\my-study' --format json
```

Nếu Node chưa trên PATH, dùng executable thực tế như phần 14. Inspect độc lập là read-only: không init/migrate, không gọi model hoặc query backend. Summary giới hạn lịch sử và có omitted count; dùng section/full để xem thêm.

| Phần inspect | Dùng để xem |
|---|---|
| `project` | Workspace, state version, owner và attachment metadata |
| `config` | Snapshot active, revision/change history, overlay và candidate drift |
| `models` | Model policy và trạng thái xác minh model GUI |
| `roles` | Backend/profile/skills được cấu hình cho từng vai trò |
| `skills` | Skills được khai báo, vai trò được dùng và task đã chọn |
| `capabilities` | Khả năng khai báo của adapters, extensions và observations có scope |
| `policy` | Quyền thực thi, context/budget/quota, recovery và workspace policy |
| `runtime` | Task/attempt/operation states, pending decisions, usage và publication |

**`unknown` không có nghĩa là disabled hoặc bị lỗi.** Nó thường có nghĩa hệ thống chưa có observation đủ để xác nhận. Receipt lịch sử cũng không chứng minh session GUI hiện tại có inventory giống vậy.

Token/cost trong harness có thể là số reported hoặc reservation estimate. Root GUI usage chưa tự được tính đầy đủ; native observation không phải authoritative usage receipt. Tổng worker là **partial project totals**. Không quy đổi phần trăm quota subscription thành một số token chắc chắn.

## 10. Tương tác và cắt ngang khi đang chạy

### Bổ sung thông tin hoặc hỏi tiến độ

```text
Có thêm tài liệu này. Hãy kiểm tra tác động lên giả định/plan trước
khi đổi hướng; giữ mục tiêu hiện tại nếu chưa có lý do thay đổi.
```

```text
Cho tôi biết task nào đang chạy, task nào đang chờ và bước nào cần
tôi quyết định. Chưa yêu cầu dừng công việc hiện tại.
```

Đây là tương tác với orchestrator, không bảo đảm mọi worker nhận ngay thông tin mới. Orchestrator chọn steer nếu route có hỗ trợ; đổi input/model/protocol/quyền có thể cần checkpoint, revise và attempt mới.

### Tạm dừng để review

```text
Hãy tạm dừng project qua control event. Chặn dispatch mới, lưu tiến
độ theo capability và báo riêng: đã nhận yêu cầu, đã áp dụng, worker/
descendants nào đã xác minh dừng, phần nào còn unknown.
```

Pause thường có boundary, không đồng nghĩa kill tức thì giữa một phép tính. Chỉ resume khi core cho phép và đã xử lý các execution chưa rõ. Resume cũng không tự bảo đảm đã khởi chạy phần việc kế tiếp; orchestrator kiểm tra trạng thái rồi tiếp tục dispatch/recovery phù hợp.

### Hủy một phần việc

```text
Hãy cancel task [task_id], giữ artifacts và lịch sử, kiểm tra cả
descendants trước khi cho phép chạy lại công việc liên quan.
```

Cancel là quyết định kết thúc trong phạm vi đó, không dùng thay pause. Task đã cancelled cần phần việc mới phù hợp; project đã cancelled không được resume trực tiếp như project paused.

**Nút Stop của GUI có thể chỉ dừng lượt root agent.** CLI transport hiện không có hook chứng minh mọi child/external job đã dừng. Nếu đã bấm Stop, lần tiếp theo cần inspect và reconcile trước khi dispatch lại. Khi GUI không phản hồi, dùng control CLI ở phần 14.

## 11. Tiếp tục sau khi đóng GUI, mất điện hoặc đổi phiên

```text
Hãy tiếp quản project D:\Research\my-study bằng Research System.
Đọc entry/connection và persisted state trước. Kiểm tra owner epoch,
active/unknown jobs, pending publication và checkpoints. Chưa tạo
attempt mới khi chưa biết việc cũ đã dừng hay chưa. Sau đó tóm tắt
phần đã xong, phần còn lại và đề xuất bước tiếp tục.
```

Orchestrator cần đọc DB/receipts/checkpoints, không chỉ tin nội dung chat cũ. Nếu cần takeover owner, phải thực hiện fencing và attach lại theo epoch mới; takeover không tự dừng process của owner cũ.

Một worker mất heartbeat hoặc không còn PID hiển thị chưa đủ chứng minh descendants/remote side effects đã kết thúc. Unknown phải được reconcile bằng observation/evidence phù hợp. Khi đủ điều kiện, hệ thống có thể giữ các unit đã hoàn thành hợp lệ và tiếp tục phần còn lại; không hứa mọi backend hỗ trợ checkpoint giữa lượt hoặc resume native session.

Đổi backend điều phối cũng theo cách bàn giao này: entry của host mới → đọc portable state → xử lý ownership/jobs → xác minh mapping/capabilities → tiếp tục. Không chuyển được native session của hãng A thành native session hãng B chỉ bằng một flag.

## 12. Các trạng thái và lỗi thường gặp

| Dấu hiệu | Ý nghĩa/cách xử lý |
|---|---|
| `queued` | Đã xếp việc, chưa có nghĩa worker đã được gọi |
| `waiting_for_user` | Còn decision; review đúng task/revision và trả lời qua đường tương ứng |
| `waiting_for_capacity` | Admission chưa đủ capacity/quota/budget; xem lý do trước khi đổi giới hạn |
| `yielded` | Có điểm bàn giao; orchestrator kiểm checkpoint và recovery plan |
| `needs_review` | Kết quả inconclusive, dependency thay đổi hoặc cần review; dùng reopen sau review hoặc revise khi đổi spec |
| `failed` | Lần thực hiện thất bại; kiểm side effects, jobs và nguyên nhân trước recovery |
| `unknown` / operation `submit_intent` chưa resolved | Chưa biết chắc outcome; không đổi key rồi gửi chạy lại để “thử” |
| `External execution disabled` | Template/policy chưa cho phép; chuẩn bị protected change đúng scope và confirmation |
| `Stale/read-only GUI owner` | Binding không có quyền ghi theo epoch hiện tại; kiểm takeover/attach, không sửa epoch bằng tay |
| `Change conflict` / stale revision | Config đã đổi; preview lại trên base revision mới |
| `deferred` khi apply config | Còn execution/operation/publication phải xử lý; idle attachment không tự khóa activation |
| `Config changed` / inspect drift | File config đang dùng khác registered snapshot; với v5 dùng change workflow hoặc CLI --workspace phù hợp |
| Version/protocol/model mismatch | Preflight chưa phù hợp; xác minh compatibility/mapping trước, không hạ requirement âm thầm |
| Artifact hash mismatch / dependency not current | File hoặc bằng chứng đã thay đổi; xác minh, review và cập nhật bằng revision phù hợp |
| Publication pending/conflict | Còn journal hoặc output conflict; recover/rollback có kiểm soát trước dispatch mới |
| Context vượt giới hạn / response oversized | Chọn task/record/input scope nhỏ hơn hoặc đọc ref theo trang; không cắt bằng chứng âm thầm |
| `Connection file conflict` | Entry đã khác nội dung generated; review thay đổi trước update, không ghi đè |
| Snapshot workspace khác control root | DB bị copy/di chuyển hoặc cấu hình đường dẫn không khớp; cần kế hoạch relocation, không tự sửa vài path rồi chạy |

### Yêu cầu phân tích lỗi

```text
Hãy chẩn đoán lỗi gần nhất. Đọc log/receipt liên quan theo task,
attempt hoặc operation ID; chỉ trích phần cần thiết và redact secrets.
Nêu nguyên nhân có bằng chứng, trạng thái side effects và cách sửa
ít ảnh hưởng nhất. Chưa retry execution khi outcome còn unknown.
```

GUI service errors có correlation ID trong stderr và log `.agentic/logs/gui-errors.jsonl`, với một file `.previous` khi xoay. Managed launcher có `stdout.log`/`stderr.log` dưới `.agentic/gui-operations/<operation_id>/`; attempt còn có context/raw output/receipts tương ứng dưới `.agentic/attempts/` tùy route. File bằng chứng và checkpoint có vòng đời riêng, không bị log rotation xóa.

Nếu lỗi filesystem làm không ghi được log, stderr có thể báo `logging_unavailable`. Không phải mọi lỗi khởi động trước service đều có GUI log; giữ stderr và command liên quan để chẩn đoán. Không gửi nguyên auth file hoặc toàn bộ raw logs vào chat.

## 13. Kết thúc buổi làm việc, sao lưu và cập nhật

### Kết thúc một buổi

```text
Hãy tổng kết buổi làm việc: kết quả/bằng chứng, phần chưa giải quyết,
checkpoint/handoff cần giữ và bước tiếp theo. Báo có worker/jobs nào
còn active hoặc unknown trước khi tôi đóng GUI.
```

Không cam kết worker sẽ tiếp tục chạy khi GUI hoặc máy tắt. Nếu muốn dừng, thực hiện control/reconciliation tương ứng trước; detach và disconnect không thay thế stop.

### Sao lưu

Giữ cả source/config cần tái lập, dữ liệu/artifacts, `.agentic` và các file referenced liên quan. Handoff là bản ghi bàn giao, không phải bản sao đầy đủ của mọi artifact. Auth files có credentials; giữ riêng, không commit hoặc chia sẻ công khai.

Với SQLite đang chạy, không copy riêng `state.sqlite` rồi mặc định backup nhất quán: WAL có thể còn dữ liệu. Yêu cầu orchestrator tạo bản sao nhất quán khi đã xử lý jobs và đóng các kết nối liên quan, hoặc dùng cơ chế backup SQLite phù hợp. Backup JSON của migration cũng không tự sao lưu toàn bộ file bằng chứng.

### Update/gỡ entry

Update hệ thống không tự cập nhật các project đã tạo connection. Orchestrator phải kiểm source/binding/version và các generated files trước khi cập nhật. Gỡ entry dùng `disconnect-gui`; file bị sửa được giữ lại và báo conflict. Muốn thu hồi binding thì detach riêng; muốn dừng jobs thì control/reconcile riêng.

Không xóa runner/adapters hoặc snapshot chỉ để làm project trông gọn hơn. Không tự di chuyển bộ hệ thống/project khi vẫn còn bindings tuyệt đối hoặc execution chưa resolved; đường dẫn và dữ liệu có liên quan cần được xử lý đầy đủ.

## 14. Tham khảo terminal: thiết lập và cứu hộ

**Phần này tùy chọn.** Bạn có thể giao orchestrator thực hiện các bước chuẩn bị. Các lệnh bên dưới là thao tác thật khi chạy; đặc biệt init/upgrade/control có thay đổi state. Không cần chạy chúng chỉ để đọc hướng dẫn.

### 14.1. Đặt đường dẫn và kiểm tra Node

Trong PowerShell:

```powershell
$harnessRoot = 'D:\Code\AI\agentic_std_proccess\research_system'
$projectPath = 'D:\Research\my-study'
$harnessScript = Join-Path $harnessRoot 'scripts/harness.mjs'
$nodeExecutable = 'node'
& $nodeExecutable --version
```

Cần version >=24. Nếu Node chưa trên PATH, nhờ orchestrator xác định executable đã có. Trên máy dùng bundled runtime tại vị trí tương ứng, có thể kiểm đường sau mà không cài thêm Node:

```powershell
$nodeCandidate = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
if (-not (Test-Path -LiteralPath $nodeCandidate)) {
  throw 'Không tìm thấy Node ở đường ví dụ; cần xác định executable thực tế.'
}
$nodeExecutable = $nodeCandidate
& $nodeExecutable --version
```

Không tự tạo connection trỏ vào một executable không tồn tại. Các lệnh sau dùng đường script tuyệt đối nên không phụ thuộc thư mục terminal hiện tại.

### 14.2. Chuẩn bị một project mới, chưa chạy model

Thư mục project phải tồn tại trước connect. Để orchestrator tạo config ở `$configPath`, với bundle_root/project.workspace đúng đường tuyệt đối, rồi kiểm:

```powershell
$configPath = Join-Path $projectPath 'config.json'
& $nodeExecutable $harnessScript validate-config --config $configPath
& $nodeExecutable $harnessScript inspect-project --config $configPath
```

Nếu project **chưa có state**, init rồi upgrade GUI:

```powershell
& $nodeExecutable $harnessScript init --config $configPath
& $nodeExecutable $harnessScript upgrade-gui --workspace $projectPath
```

Init hiện tạo state v4; upgrade-gui đưa lên v5. Nếu đã init, không init lại. State cũ hơn cần kiểm tra `migrate-state` theo [runtime guide](runtime.md); active/unknown work phải được xử lý trước migration.

Số phiên bản state và schema của file config là hai thứ khác nhau. Không đổi `schema_version` của config thành 5 chỉ vì GUI services dùng state v5.

Tạo connection và attach Codex:

```powershell
& $nodeExecutable $harnessScript connect-gui --workspace $projectPath --backend codex
$hostFile = Join-Path $projectPath '.agents/skills/research-project/host.json'
$bindingResult = & $nodeExecutable $harnessScript gui-attach --workspace $projectPath --file $hostFile | ConvertFrom-Json
$bindingResult.auth_file
& $nodeExecutable $harnessScript inspect-project --workspace $projectPath
```

Giữ auth file tại đường được trả về, không in nội dung token. Với host khác, thay --backend và hostFile theo bảng phần 3. Các bước này không bật external execution và không chứng nhận GUI loader.

### 14.3. Khám phá API và gọi status

```powershell
& $nodeExecutable $harnessScript gui-catalog
```

Catalog cho biết groups/actions và required/optional fields. File request JSON tối thiểu cho status:

```json
{"group":"project","action":"status","data":{}}
```

Lưu thành một file request riêng trong project, rồi gọi với auth file do attach trả về. Ví dụ trong cùng terminal vừa attach:

```powershell
$requestPath = Join-Path $projectPath 'status-request.json'
& $nodeExecutable $harnessScript gui-action --workspace $projectPath --auth $bindingResult.auth_file --file $requestPath
```

gui-action dùng request rõ ràng; action dispatch có thể khởi chạy worker khi policy cho phép. Không dùng một request dispatch thay cho request status. Hầu hết người dùng để orchestrator tạo/call các request này.

### 14.4. Inspect, pause và resume khi GUI gặp vấn đề

```powershell
& $nodeExecutable $harnessScript inspect-project --workspace $projectPath --section runtime
& $nodeExecutable $harnessScript status --workspace $projectPath
& $nodeExecutable $harnessScript control-task --workspace $projectPath --action pause --target project
```

Sau khi đã review và xử lý các attempts/jobs chưa rõ, có thể resume nếu trạng thái cho phép:

```powershell
& $nodeExecutable $harnessScript control-task --workspace $projectPath --action resume --target project
```

Nếu vẫn còn active/unknown attempts, resume có thể bị chặn. Để orchestrator chuẩn bị observation/reconciliation đúng; không tự bịa một file “stopped” hoặc xóa attempt để mở khóa. CLI v5 có thể dùng --workspace để đọc registered config; state cũ chỉ hỗ trợ đường --workspace cho những emergency commands tương ứng.

### 14.5. Confirmation được chuẩn bị để bạn review

Với protected config change, orchestrator đưa preview và một confirmation file gắn đúng change_id/digest. Sau khi bạn kiểm tra, human CLI path là:

```powershell
$confirmationPath = Join-Path $projectPath 'human-confirmation.json'
& $nodeExecutable $harnessScript confirm-gui-change --workspace $projectPath --file $confirmationPath
```

Sau confirmation, apply vẫn là bước riêng; yêu cầu orchestrator thực hiện và kiểm tra revision. Decision answers dùng answer-decision; benchmark dùng request/confirmation riêng. Không dùng confirmation của một thay đổi thay cho approval của một benchmark hoặc lần rerun khác.

### 14.6. Xem trợ giúp và gỡ connection

```powershell
& $nodeExecutable $harnessScript --help
& $nodeExecutable $harnessScript disconnect-gui --workspace $projectPath --backend codex
```

Disconnect giữ state/artifacts và không dừng jobs hoặc thu hồi attachment token. Nếu entry có chỉnh sửa, xử lý conflict trước thay vì xóa cưỡng bức.

## 15. Nghiệm thu và tài liệu tra cứu

Để đưa hệ thống vào sử dụng, bắt đầu bằng một phần việc có ích trong project thật, theo đúng quyền được cấp. Ghi lại những đường đã thực thi: đúng project, config revision, route/model quan sát được, artifacts/evidence và khả năng tiếp tục công việc. Chỉ kết luận cho phần có bằng chứng; một lần Codex hoạt động không chứng nhận mọi host/pair.

Không bắt buộc chạy benchmark để đánh giá chất lượng khám phá tri thức mới trước khi sử dụng. Theo dõi và tối ưu dần qua dự án. Nếu chủ động chạy benchmark hệ thống/model, **mỗi lần cần protocol cụ thể và xác nhận riêng**, gồm scope, models, grading, budget, stopping rules và execution manifest. Yêu cầu viết tài liệu hoặc implementation không tự cho phép benchmark.

| Tài liệu | Khi cần đọc |
|---|---|
| [README](../README.md) | Tổng quan và trạng thái release |
| [GUI integration](gui-integration.md) | Kiến trúc, service contracts, giới hạn, migration và deletion ledger |
| [Terminal inspect](project-inspect.md) | Chi tiết cách đọc snapshot và source/observation scopes |
| [Research workflow](research-workflow.md) | Records, hypotheses, math/experiments, feedback và evidence |
| [Model routing](model-routing.md) | Ba tầng model và nghĩa vụ independent planning |
| [Runtime](runtime.md) | State machine, migration, ownership và recovery |
| [Extensions](extensions.md) | Helpers/profiles, provisioning và scope; đối chiếu GUI guide cho v5 config changes |
| [Nghiệm thu GUI](plugin-acceptance-plan.md) | Software coverage và phần live acceptance còn cần |
| [Evidence 0.7.0](verification/gui-evidence.json) | Kết quả kiểm tra phần mềm và source hashes tại mốc 29/10/2026 |

### Mẫu dùng lại ở mỗi phiên

```text
Dùng Research System cho project [đường dẫn].
Đọc trạng thái đã lưu và kiểm tra việc còn active/unknown trước khi tiếp tục.
Mục tiêu phiên này là [mục tiêu], đầu ra là [đầu ra].
Quyền/ngân sách hiện tại là [phạm vi].
Chọn inline/native/managed theo yêu cầu thực tế, giữ bằng chứng và
chỉ hỏi khi thiếu thông tin hoặc xác nhận chưa được cấp.
Kết thúc bằng kết quả, giới hạn và phần còn lại.
```
