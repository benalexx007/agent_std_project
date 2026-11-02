# MCP và skills bên ngoài — nghiên cứu và đề xuất tích hợp

**Trạng thái mới 28/10/2026:** [Research extensions 0.6.0](extensions.md) đã triển khai software và provision local. Báo cáo bên dưới là snapshot nghiên cứu source 0.5.0 trước implementation; các câu “chưa tích hợp” trong snapshot không mô tả source hiện tại. Native effective scope/acceptance chưa live-verified.

Ngày khảo sát: **27/10/2026**. Baseline: source **0.5.0 / state v3**, [186 software tests và giới hạn](integration-foundation.md). Trạng thái tài liệu: **đề xuất**, chưa cài package/server/skill, chưa đổi runtime hoặc cấu hình cá nhân, chưa chạy inference/benchmark. Mở rộng theo [plan bản 4](runtime-integration-plan.md), ưu tiên domain Research cho AI engineering; một số ứng viên phục vụ Application khi có nhu cầu.

**Plan implementation chi tiết:** [external-integration-plan.md](external-integration-plan.md), gồm EX0–EX5, contracts/config, package boundaries, native scope, migration v4 dự kiến, rollback và acceptance tối thiểu. Plan này bổ sung source review độc lập và thay lựa chọn nhập citation-management scripts bằng BibtexParser + identity policy nhỏ; source 0.5.0 hiện tại chưa đổi.

## 1. Kết luận thiết kế

Nên tích hợp external capabilities có chọn lọc và có thể đổi provider. Giá trị lớn nhất là dữ liệu/công cụ chuyên biệt và procedural knowledge có ích cho một công việc cụ thể. Không cần biến core thành một agent platform hoặc MCP gateway tổng quát.

Ba quyết định khác nhau:

- **Skill** hướng dẫn cách làm, có thể kèm scripts/references; không tự cấp quyền hoặc tăng năng lực nền của model.
- **MCP** chuẩn hóa cách agent gọi công cụ/dịch vụ, đọc resources và trao đổi với host; không tự chứng minh kết quả khoa học hoặc process đã dừng.
- **CLI/library** thường đủ cho thao tác hữu hạn, deterministic; MCP có thể tốt hơn khi cần trạng thái tương tác, discovery hoặc host không có shell.

Native backend tiếp tục làm MCP client/skill loader khi đáp ứng contract. Core giữ selection, policy, budget, job identity, receipt/provenance, publication và scientific state. Một provider có cả CLI và MCP thì chọn route theo việc, không duy trì cả hai cùng scope vô thời hạn.

**Kết luận sau khi kiểm tra lại:** phân loại theo tần suất dùng và phần còn thiếu, không theo nhãn “chuyên ngành”. Research về AI engineering cần chuẩn bị từ đầu retrieval/citation, kiểm toán học và phân tích thực nghiệm; backend có shell hoặc model biết toán không tự cung cấp đầy đủ những công cụ này. Ngược lại, Azure/.NET, bioinformatics, nền tảng notebook/tracking hoặc formal toolchain riêng chỉ provision theo dự án.

| Quyết định hiện hành | Phạm vi |
|---|---|
| **Tái dùng trước** | Backend skill loader/MCP client và installer; công cụ shell/code/browser/document/PDF khi đúng phiên worker có và đáp ứng contract; core giữ planning/evaluation/scientific records, quota, recovery và publication |
| **Chuẩn bị từ đầu cho Research** | Retrieval/citation helpers có chọn lọc; SymPy; numerical/statistical/plotting toolchain nhỏ; bổ sung reference cho design/analysis vào sáu skills hiện có. Mục 10 xác định route và phần không import |
| **Theo dự án** | M02/Azure/.NET, OpenAI SDK docs, HF, Zotero, Lean, Wolfram, biomedical, advanced corpus parser, Jupyter/W&B/MLflow và các provider search bổ sung |
| **Loại khỏi baseline vì trùng** | Reinstall toàn bộ Anthropic skills/OpenAI plugins, nhiều search MCP tương đương, filesystem/git/memory/sequential-thinking MCP trùng tools/core, bootstrap điều phối/review thứ hai |

“Chuẩn bị từ đầu” là provision/lock capability trong bước implementation extension tiếp theo, không phải bật vào mọi task hoặc nạp toàn body vào prompt. Tài liệu này chưa cài gì. Chọn native, CLI/library hay MCP theo contract và tổng chi phí; không mặc định MCP mạnh hơn hoặc CLI luôn rẻ hơn.

## 2. Phạm vi và mức bằng chứng

Khảo sát Internet bằng các nhóm truy vấn: official registries/specification; scholarly retrieval/citations; web/docs/code; parsing; symbolic/formal mathematics; notebooks/experiment tracking; official/community skill libraries và nghiên cứu thực nghiệm về skills. Đọc nguồn sơ cấp: tài liệu vendor, repository README, một số SKILL.md và abstract paper; đối chiếu source local.

Đây không phải audit toàn bộ mã nguồn của mọi repo hoặc kiểm chứng compatibility trên máy. Các URL main/latest là snapshot nghiên cứu ngày trên; **chưa là package lock được duyệt**. Trước import phải pin release/commit/package digest, đọc scripts/resources liên quan và kiểm đúng route/OS/auth. Số sao, nhãn validated, tên official hoặc registry listing không thay conformance.

[MCP Registry](https://modelcontextprotocol.io/registry/about) xác thực namespace/metadata; security scanning thuộc các package registries/aggregators. Dùng registry và skills.sh để discovery, rồi quay về upstream.

### 2.1. “Có sẵn trong backend” cần kiểm ở mức nào?

Phân biệt: **backend hỗ trợ loader/client → package bundled hoặc trong catalog → installed → enabled trong đúng profile → discoverable/callable trong worker → có trace đạt contract của harness**. Đây không phải một trạng thái duy nhất. Có sẵn chưa chứng minh worker kế thừa; callable chưa chứng minh quyền, receipt hoặc scientific validity đúng.

- [Codex skills](https://learn.chatgpt.com/docs/build-skills) có system/bundled skills; [plugins](https://learn.chatgpt.com/docs/plugins) có install/enable và một số connector cần auth. Repo openai/plugins là nguồn package, không có nghĩa toàn repo đã cài. Native progressive loading nên được tái dùng, không viết loader trùng khi contract đủ.
- [Claude skills](https://code.claude.com/docs/en/skills) có bundled skills như doctor/code-review và một số feature-gated. [Marketplace/plugin installation](https://code.claude.com/docs/en/discover-plugins) là lớp riêng. Vì vậy “Anthropic có skills sẵn” đúng một phần; toàn bộ anthropics/skills hoặc scientific skill library không tự nằm trong Claude.
- [Antigravity plugins](https://www.antigravity.google/docs/plugins?tab=cli) phân biệt App/CLI/IDE và plugin bundles. Tái dùng skill/MCP đã có ở đúng surface; không suy CLI inventory bảo đảm SDK worker hoặc backend khác nhận được.

**Metadata local đã kiểm ngày 27/10/2026, không gọi model:** Codex `plugin list --json` có 18 plugins installed/enabled, gồm documents/pdf/spreadsheets/presentations/browser; Claude cùng lệnh trả mảng rỗng; Antigravity có 5 plugins enabled, gồm **science 1.3.1**. Claude inventory rỗng không phủ định bundled skills hoặc MCP riêng. Chỉ đọc metadata và các file package được chọn, không đọc secret/config credentials.

Đã mở manifest, README, license, hai SKILL.md và phần script liên quan tại `<home>/.gemini/config/plugins/science`: **literature-search-arxiv** có search, PDF/HTML và source download; **literature-search-openalex** có resolve/query/metadata. Gói này có nhiều biomedical skills và biomolecular sidecar không liên quan Research AI engineering tổng quát. Các scripts chọn dùng uv/polite-http; instructions còn có quy trình credentials/home .env và rules cho sidecar. Vì vậy có cơ hội reuse rõ, nhưng không bật nguyên bundle/rules hoặc làm theo home/global setup mặc định. Chưa audit hết scripts, chưa xác minh các helpers chạy được trong worker.

Source hiện tại [codex-native.mjs](../src/codex-native.mjs) **tắt apps/plugins/memories** ở thread config và tắt shell của coordinator. Worker chưa có external allowlist/lock/receipt theo task. Do đó không được tính 18 plugins trên là capability đã tích hợp của harness; cũng không bật lại toàn bộ plugins chỉ để reuse PDF. Cần chọn exact component/profile và kiểm effective scope. Coordinator giao thao tác shell/PDF cho worker đủ quyền; không mở shell cho coordinator chỉ vì một helper cần nó.

Bundled desktop Python được kiểm bằng `importlib.util.find_spec` (không chạy tính toán): có numpy/pandas, chưa tìm thấy sympy/scipy/matplotlib/statsmodels/requests. Kết quả chỉ áp dụng interpreter desktop đang kiểm, không phải mọi Python trên máy hoặc environment worker. Không cài lại phần đã có và phù hợp pin; không giả định scientific stack đã đủ.

### 2.2. Đối chiếu chồng lấn trước khi chọn

| Capability | Đường đang có/ứng viên trùng | Quyết định |
|---|---|---|
| Paper discovery | Native web; AGY science arXiv/OpenAlex; paper-lookup; arXiv MCP; HF papers | Một binding chính theo backend/profile, chỉ thêm nguồn vì coverage cần. Dùng version/full text/partial receipts làm tiêu chí; paper search chung không thay xác minh citation |
| Citation/metadata | AGY OpenAlex; paper-lookup Crossref; citation-management; Zotero | Retrieval dùng binding trên; chỉ lấy DOI/BibTeX validation/format/dedup còn thiếu. Không import lại search workflow của citation-management |
| Web/docs/repo | Native search/browser, rg/git/gh; Context7/GitHub/DeepWiki/Exa/Tavily/Brave | Native/local trước nếu đáp ứng; tối đa một route chính cho cùng scope, có thể thêm nguồn độc lập khi câu hỏi đòi hỏi. Không cấm multi-source research |
| PDF/documents | Plugins documents/pdf đã installed; native extraction/render tools; Docling/MarkItDown/Anthropic document skills | Reuse đúng host/worker nếu dùng được. Chỉ thêm parser khi mất toán/bảng/layout cần thiết; tránh cài thêm cả hai document stacks. Giữ raw/page locators |
| Math/statistics | Core có assumptions/proof/experiment rubrics và shell; symbolic/statistical libraries còn thiếu ở interpreter đã kiểm | Bổ sung công cụ tính toán và hướng dẫn phương pháp; không thêm reasoning MCP hoặc xem CAS là proof |
| Planning/review/writing | Sáu research skills và core records đã làm; hypothesis/critical-thinking/peer-review/writing/Superpowers trùng đáng kể | Giữ một workflow; chỉ lấy reference mới, không import bootstrap, scheduler, second evaluator loop hoặc scientific state thứ hai |
| Tool loading/lifecycle | Native backend loader/client; core fences/quota/jobs/publication; runtime gateway ngoài | Reuse native, viết binding/receipt còn thiếu. Không thêm runtime/server-manager chỉ để quản lý một CLI call |

Một dependency/description tương đương chưa bảo đảm implementation tương đương. Nếu route hiện có thiếu coverage, permissions, reproducibility hoặc control cần thiết thì route mới vẫn có thể đáng tích hợp. “Một binding chính” là mặc định lựa chọn, không phải trần năng lực hay cấm fallback đã được kiểm.

## 3. Những cập nhật ảnh hưởng quyết định

1. [openai/skills README](https://raw.githubusercontent.com/openai/skills/main/README.md) hiện đánh dấu deprecated và chỉ sang [openai/plugins](https://github.com/openai/plugins). Không bắt đầu một importer dựa riêng catalog cũ.
2. [Anthropic skills](https://raw.githubusercontent.com/anthropics/skills/main/README.md) phân biệt các skill open source và các document skills source-available. Kiểm license từng directory trước khi copy/phân phối; không suy license từ repo.
3. [Playwright](https://github.com/microsoft/playwright-mcp) có cả MCP và [CLI + Skills](https://github.com/microsoft/playwright-cli). Vendor nêu CLI phù hợp coding workloads, MCP phù hợp những loop cần rich state/introspection. Đây là hướng lựa chọn, chưa là số tiết kiệm đã đo cho harness.
4. [Zotero MCP](https://github.com/54yyyu/zotero-mcp) cũng có CLI + skill, MCP và plugin Zotero. Chọn route đáp ứng công việc; không dùng tỷ lệ token do vendor nêu làm benchmark của mình. Server/CLI và plugin có license khác nhau.
5. [MCP 2026-07-28](https://blog.modelcontextprotocol.io/posts/2026-07-28/) thay đổi transport/control và đưa Tasks vào extension. Roots/sampling/logging legacy đang deprecated; không xây implementation mới phụ thuộc riêng các cơ chế này.
6. [Tasks extension](https://tasks.extensions.modelcontextprotocol.io/specification/draft/tasks) quy định cancellation cooperative; ACK không bảo đảm terminal cancelled. Core vẫn giữ job/evidence/reservation mạnh hơn mức protocol tối thiểu, kể cả khi client được phép bỏ task state.
7. Bootstrap của [Superpowers](https://raw.githubusercontent.com/obra/superpowers/main/skills/using-superpowers/SKILL.md) và [Science Superpowers](https://raw.githubusercontent.com/K-Dense-AI/science-superpowers/main/skills/using-science-superpowers/SKILL.md) áp dụng workflow rất rộng. Chúng có thể thêm nhiều bước ở task nhỏ và tranh điều phối với harness. Chọn subskill/rubric phù hợp thay vì nhập toàn bootstrap.

Không dùng latest spec để suy mọi backend đã hỗ trợ. Chốt protocol được hai phía negotiate; một server còn chạy protocol cũ có thể vẫn dùng được. Không viết MCP stack riêng chỉ để theo số version mới.

## 4. Catalog discovery tách khỏi quyết định tích hợp

[Catalog tham khảo](external-capability-catalog.md) giữ M01–M20 và các nguồn skill libraries để tra cứu sau. Không có mục nào tự trở thành integration chỉ vì xuất hiện trong catalog. Baseline, phần tái dùng và phần để theo dự án được chốt ở mục 1, 2 và 10 dưới đây. **M02/Microsoft Learn/Azure/.NET không thuộc baseline và không phải việc cần implement lúc này.**

## 5. Nội dung bên ngoài được cân nhắc

### 5.1. Review trực tiếp một số SKILL.md

Đã đọc nội dung trên branch hiện tại, chưa audit toàn bộ scripts đi kèm:

- [paper-lookup](https://raw.githubusercontent.com/K-Dense-AI/scientific-agent-skills/main/skills/paper-lookup/SKILL.md): bounded scholarly retrieval và provenance, Python standard library. Đây là ứng viên tốt để lấy nguồn nhiều database mà không dựng một MCP cho mỗi database. Không fan-out mọi endpoint.
- [sympy](https://raw.githubusercontent.com/K-Dense-AI/scientific-agent-skills/main/skills/sympy/SKILL.md): exact arithmetic/assumptions phù hợp derivations. Dùng toolchain/environment riêng; giữ CAS check khác formal proof.
- [experimental-design](https://raw.githubusercontent.com/K-Dense-AI/scientific-agent-skills/main/skills/experimental-design/SKILL.md) và [statistical-analysis](https://raw.githubusercontent.com/K-Dense-AI/scientific-agent-skills/main/skills/statistical-analysis/SKILL.md): bổ sung thiết kế, dependence, effect/uncertainty và diagnostics. Điều chỉnh sang ML units/splits/seeds/ablations, không ép biomedical rubric lên mọi nghiên cứu.
- [hypothesis-generation](https://raw.githubusercontent.com/K-Dense-AI/scientific-agent-skills/main/skills/hypothesis-generation/SKILL.md): phân biệt observations/hypotheses/predictions/alternatives; có local deterministic helpers. Nên merge phần mới vào research-design/reference hơn là tạo vòng lập kế hoạch thứ hai.
- [scientific-critical-thinking](https://raw.githubusercontent.com/K-Dense-AI/scientific-agent-skills/main/skills/scientific-critical-thinking/SKILL.md): evidence appraisal; optional figures có route API khác. Không auto-enable phần này; không dùng GRADE như thước đo mọi claim AI.
- [peer-review](https://raw.githubusercontent.com/K-Dense-AI/scientific-agent-skills/main/skills/peer-review/SKILL.md) và [scientific-writing](https://raw.githubusercontent.com/K-Dense-AI/scientific-agent-skills/main/skills/scientific-writing/SKILL.md): traceable review/drafting, offline helpers. Confidential review có điều kiện riêng; hosted coordinator đọc nội dung vẫn là external processing dù script chạy local.
- [citation-management](https://raw.githubusercontent.com/K-Dense-AI/scientific-agent-skills/main/skills/citation-management/SKILL.md): DOI/BibTeX và metadata checks. Google Scholar scraping chỉ là bổ sung; tránh biến endpoint dễ block thành dependency.
- [hf-cli](https://raw.githubusercontent.com/huggingface/skills/main/skills/hf-cli/SKILL.md): có phạm vi rất rộng gồm auth, cloud jobs và deploy. Import route đọc/search cần scope nhỏ hơn metadata mặc định; không làm theo installer Bash/global settings trên Windows.

Provider contracts phải được verify độc lập với skill. Ví dụ [OpenAlex authentication](https://help.openalex.org/api/authentication/) hiện mô tả basic no-key queries nhưng cần key để cursor paging sâu; [bài công bố cũ](https://blog.openalex.org/openalex-api-new-features-and-usage-based-pricing/) diễn đạt key requirement khác. Không hứa exhaustive retrieval chỉ vì metadata skill nói không cần credentials. Dùng đúng endpoint/auth/page coverage và ghi partial khi không đầy đủ.

## 6. Bằng chứng thực nghiệm công bố: hữu ích nhưng không phải nghiệm thu của harness

[SkillsBench v4](https://arxiv.org/abs/2602.12670v4) báo cáo cải thiện trung bình trên benchmark đa domain và thấy focused skills tốt hơn bundle lớn trong thiết lập khảo sát. [SWE-Skills-Bench v1](https://arxiv.org/abs/2603.15401v1) thấy nhiều skills không đem lại cải thiện, có token overhead và tác hại do version mismatch.

Hai kết quả có workload/harness/selection khác nhau. Chúng hỗ trợ việc đánh giá đúng task và chọn skill chuyên biệt, không cho phép suy ra một tỷ lệ tăng năng lực/giảm token trên source 0.5.0. Không lấy kết quả smaller-model+skills làm lý do thay model tiers người dùng đã chọn. Không chạy hai benchmark này để nghiệm thu bản đầu.

[Agent Skills specification](https://agentskills.io/specification) mô tả metadata/instructions/resources được nạp dần. Dùng nó cho packaging/progressive disclosure; mức host hỗ trợ optional metadata/tools vẫn phải kiểm riêng.

## 7. Khoảng trống cụ thể trong source 0.5.0

| Vị trí | Quan sát | Việc cần làm trước external activation |
|---|---|---|
| [config schema](../schemas/config.schema.json) / [config](../src/config.mjs) | Có map skills và role bindings; chưa catalog/lock cho external packages, endpoints, credentials, tool scopes | Extension manifest và lock riêng; task/role chọn capability, renderer chọn provider |
| [context](../src/context.mjs) | Nạp toàn body các active_skills; có scoped context/cache/read pagination, chưa native skill selection cho arbitrary imported packages | Giữ invariant bắt buộc nhỏ; metadata catalog + full body chỉ khi cần; native/renderer chỉ sở hữu một đường load |
| [improvements](../src/improvements.mjs) | Overlay chỉ Markdown của resources hiện có; không hỗ trợ import package scripts/assets mới | Không mở rộng allowlist cũ thành arbitrary code write. Thêm import/review/activation riêng cho package mới |
| [native driver](../src/codex-native.mjs) | Tắt apps/plugins/memories; chưa explicit task MCP policy hoặc receipt danh sách MCP hiệu lực | Không kết luận MCP từ user/project config đã bị tắt. Enumerate/disable ngoài allowlist trên đúng pin; fail closed nếu không kiểm được |
| Native callbacks | Có dynamic tools/user input/permissions, chưa handler riêng MCP elicitation và capture MCP tool receipts | Elicitation qua HITL có expiry/owner; unsupported vẫn reject. Persist primary tool result khi protocol cung cấp, không chỉ final summary |
| [workspace](../src/workspaces.mjs) / [publication](../src/publication.mjs) | Execution/control roots riêng; approved skill assets/scripts và MCP process chưa được materialize/bind theo extension | Pin assets, server cwd/mounts và job/output namespace vào execution root; servers không tự ghi public outputs/control DB |
| [resources/recovery](../src/resources.mjs) | Tokens/cost/reservations và external job registry có nền; chưa API credits/GPU/hidden tool-model cost từng extension | Dùng typed usage/coverage và ID thực, không đổi % thành token hay coi missing usage=0; timeout/cancel chưa đủ settle |

Đây là source review, không phải bằng chứng ambient MCP hiện đang chạy hoặc đã gây sự cố. Không đọc credentials/global config của người dùng để suy đoán.

## 8. Backend support và cách tích hợp

- **Codex:** [MCP options](https://learn.chatgpt.com/docs/extend/mcp) có enable/required, enabled_tools/disabled_tools, timeouts và output limits. Source pin còn có schema MCP status/tool-call/elicitation. Presence của schema không chứng minh driver đã dùng hoặc effective per-thread override hoạt động. Giữ App Server; không dùng codex mcp-server để làm coordinator bridge: [command đó đã bị loại bỏ](https://learn.chatgpt.com/docs/mcp-server).
- **Claude:** [MCP docs](https://code.claude.com/docs/en/mcp) có strict config và deferred tool search. Cần kiểm effective init receipt/errors, managed config/connector precedence; tool search giảm schema upfront khi route hỗ trợ, không là permission boundary.
- **Antigravity:** [MCP docs](https://antigravity.google/docs/mcp) có enabledTools/disabledTools, timeouts và permissions; [skills docs](https://antigravity.google/docs/skills?tab=cli) có project-local skills. Không suy support từ IDE sang CLI hoặc từ stream stdin sang elicitation/control contract.
- **Host khác:** common manifest/resource/result là phần portable; native config và activation là adapter-specific. Không copy một JSON/TOML hay frontmatter qua mọi host rồi giả định có hiệu lực.

Ưu tiên backend-native MCP client. Chỉ thêm proxy khi nó cung cấp enforcement/accounting/portability còn thiếu và code bị thay thế rõ. Root handshake không là filesystem sandbox, và latest MCP còn deprecated roots: server cwd/mount/arguments/credentials phải enforce scope thực.

## 9. Hợp đồng extension tối thiểu

Chưa phải config fields chạy được; đây là thiết kế để implement sau review.

**Catalog:** extension ID/namespace, kind=skill/mcp/cli/library, capability, upstream URL, license/attribution, reviewed scope, owner, status. Imported instructions là dependency được review; retrieved content/tool descriptions không được đổi system policy.

**Lock:** exact subtree commit/package digest và toàn cây scripts/assets/references; dependency environment; executable/container digest; endpoint identity và tool schema hash/protocol. Remote service thường không pin được implementation: lưu catalog/observed version, detect drift, và ghi giới hạn đó rõ.

**Binding:** task/role -> skills/tool allowlist, backend/profile, execution workspace, credential references, egress scope, timeout/call/output/API/compute limits. MCP config, hook set và generated skill metadata tham gia config/bundle/benchmark fingerprint. Không ghi secret values vào prompt/manifest/log.

**Receipt:** source URL/DOI/arXiv version/repo revision, query/filters/page coverage, retrieved_at và inspected_at riêng, raw response/PDF hash, parser version/config, derived artifacts + page/section/line locator. Summary là derived evidence, không thay raw nguồn cần thiết. Truncation/pagination/partial retrieval phải explicit.

**Lifecycle:** core lưu intent/handle trước external job có side effects, backend/server giữ loop của nó. Timeout/cancel ACK không release reservation. Skills chạy code sinh artifacts qua execution root và publication hiện có. Unknown outcomes reconcile trước retry; provider retry nội bộ cũng nằm trong budget/coverage đã công bố.

**Activation:** import project-local -> offline checks -> review diff/dependencies/license -> explicit activation -> rollback. Không lấy permission cho một task thành permission cài global hooks hoặc tự update mọi package. Ưu tiên native discovery/resource loading; không thêm một LLM router chỉ để chọn skill.

Policy đã duyệt có thể cho phép agent tự chọn extension và gọi tools trong cùng scope; không hỏi lại mỗi call. Optional frontmatter như allowed-tools không tự cấp quyền. Cần normalize metadata một lần lúc import, giữ nguồn/patch/license, rồi render theo backend; không ép arbitrary YAML/scripts qua Markdown overlay hiện tại hoặc thêm parser tự chế thiếu contract.

## 10. Plan provisioning đã điều chỉnh

E01–E03 là scope đề nghị cho lần implementation extension đầu: nền binding và bộ Research lặp lại. E04–E06 chỉ mở khi có nhu cầu. Đây là **plan**, không mô tả source 0.5.0 đã implement và không tự cấp quyền cài package hoặc chạy benchmark.

### E01 — Kiểm inventory, binding/lock và effective policy tối thiểu

Trước thêm dependency, kiểm đúng backend/profile: component bundled/installed, version/digest, enable/discovery thực tế, auth và environment. Installed inventory là input; effective worker receipt mới xác định capability được phép dùng. Không đưa toàn bộ global inventory vào prompt.

Manifest giữ capability ID -> exact component/provider/route, provenance/license, dependencies, ownership và supported backend; lock pin cây scripts/assets/references thực sự dùng. Capability không buộc gắn một vendor hoặc tạo thêm agent. Reuse installer/native loader và client; renderer chỉ thêm phần cần thiết để bind project/task. Không xây package manager, marketplace hoặc daemon riêng.

Đóng ambient extras bằng cơ chế backend có thật rồi ghi effective tools/skills/rules/hooks. Nếu không enforce/observe được scope thì chưa bật scope đó; không đổi một cờ plugins=false thành true để lấy cả bundle. Native configuration/script path/environment pin tham gia fingerprint, không đọc/copy secret values. Một component có thể được bind lại mà không cài lại nếu exact artifact sẵn có và kiểm được.

### E02 — Scholarly retrieval và citations, sẵn sàng từ đầu

**Lý do:** đọc paper, đối chiếu related work và kiểm nguồn là công việc lặp lại của Research, gồm cả phát triển toán và thực nghiệm. Web search model chưa bảo đảm version, pagination, metadata identity hoặc full-text coverage. Chuẩn bị capability này trước workflow nghiên cứu đầu, không đợi lỗi search mới bắt đầu thiết kế.

**Binding đề nghị:**

- **Codex trước:** chọn phần arXiv/OpenAlex/Crossref của [paper-lookup](https://raw.githubusercontent.com/K-Dense-AI/scientific-agent-skills/main/skills/paper-lookup/SKILL.md), dùng scripts/API hữu hạn, không bật 18 database. Đã đọc arxiv_atom.py và paginate.py cùng contract; còn phải audit helpers/dependency closure và lock trước import. Không dựng arXiv MCP chỉ để search/download.
- **Antigravity khi mở backend này:** ưu tiên hai skills science đã installed nếu scripts/dependencies, credential scope và receipts đạt cùng contract. Không phải cài thêm paper-lookup cho cùng scope. Nếu native package khó scope hoặc không cung cấp evidence cần thiết thì dùng portable binding đã kiểm.
- **Backend khác:** dùng helper/library portable đã lock qua worker đủ quyền; không mặc định package bundled của hãng khác tự có. Không cài/copy thư mục cá nhân AGY thành dependency ngầm của Codex.

**Citation bổ sung — cập nhật sau review sâu:** dùng [BibtexParser](https://bibtexparser.readthedocs.io/en/main/) làm parser/serializer và DOI/Crossref transport dùng chung; citation-management là nguồn rubric. Formatter upstream có thể dedup hai tài liệu khác DOI chỉ vì trùng key, nên không nhập nguyên formatter/validator/parser. [Plan chi tiết mục 5.1](external-integration-plan.md#51-retrievalbibliography) quy định collision/version identity, giữ raw input/macros và output diff; không import lại search workflow hoặc coi DOI lookup là kiểm chứng nội dung paper. Requests chưa là dependency bắt buộc cho route đã chọn.

Một skill/library chính có thể phục vụ nhiều endpoint; nhiều database không đồng nghĩa nhiều MCP. Crossref metadata check khác arXiv search, nên không loại chỉ vì đều “tìm paper”. Publisher corrections/retractions kiểm khi ảnh hưởng claim; không kết luận novelty hoặc không có retraction từ một search rỗng. Zotero chỉ bind thêm nếu người dùng có thư viện/annotations cần sử dụng.

### E03 — Toán và thực nghiệm lặp lại, sẵn sàng từ đầu

**Toolchain đề nghị:** Python environment riêng, lock và reuse các packages phù hợp đã có; **SymPy + NumPy + SciPy + Matplotlib** cho symbolic, numerical/statistical calculations và scientific figures. Không thêm MCP chỉ để chạy Python. Pin package/transitive dependencies và interpreter; portable là contract/output, không giả định desktop runtime là dependency luôn hiện diện.

SymPy bổ sung exact arithmetic/assumptions/derivation checks mà shell và research-design hiện có chưa cung cấp. NumPy/SciPy hỗ trợ tính toán và kiểm thống kê, Matplotlib cho figures có thể tái tạo. Đây là toolchain sẵn sàng, không phải yêu cầu task nào cũng gọi đủ bốn thư viện. Không preinstall PyMC/Pingouin/pyDOE/torch/GPU/Jupyter/statsmodels toàn bộ chỉ vì một skill ví dụ có dùng; bổ sung method-specific dependencies khi cần.

[experimental-design](https://raw.githubusercontent.com/K-Dense-AI/scientific-agent-skills/main/skills/experimental-design/SKILL.md), [statistical-analysis](https://raw.githubusercontent.com/K-Dense-AI/scientific-agent-skills/main/skills/statistical-analysis/SKILL.md) và [sympy guidance](https://raw.githubusercontent.com/K-Dense-AI/scientific-agent-skills/main/skills/sympy/SKILL.md) là nguồn tham khảo để bổ sung **references của skills hiện có**: unit of analysis/paired observations, splits/leakage, seeds/repeats, effect/uncertainty, multiple comparisons, assumptions/singularities và counterexample search. Scope phương pháp theo câu hỏi, không mặc định iid/t-test/p-value hoặc biomedical reporting. Kiểm license từng subtree trước copy/adapt, giữ attribution; metadata SymPy trỏ license upstream chưa đủ xác minh license mọi nội dung hướng dẫn.

Không import hypothesis-generation/critical-thinking/peer-review/scientific-writing thành bốn active workflows mới: phần core đã có được giữ, chỉ lấy phần bổ sung có ích. CAS/numerics không là general proof; scientific judgment vẫn cần evidence/evaluator. Lean/mathlib hoặc Wolfram có thể mạnh hơn cho bài toán cụ thể nhưng không là dependency bắt buộc của bộ khởi đầu.

**Tài liệu/PDF/browser:** baseline tái dùng component native đã installed khi đáp ứng worker contract; không provision Anthropic document pack/Docling/MarkItDown song song chỉ vì tên khác. Nếu không bind được công cụ cần thiết, hiển thị pending hoặc chọn route đã kiểm có chất lượng tương đương; không âm thầm hạ chất lượng extraction.

### E04 — Theo stack hoặc domain hẹp

**M02 Microsoft Learn/Azure/.NET rời khỏi scope khởi đầu.** Tương tự OpenAI-specific docs, Context7 theo library, GitHub/HF theo thao tác còn thiếu; biomedical/genomics, Lean/Wolfram theo bài toán. Không tạo adapter/dựng environment trước cho chúng. Native web/local docs hoặc CLI đủ thì reuse; MCP chỉ khi cải thiện coverage/control/workflow thật.

Exa/Tavily/Brave là các lựa chọn bổ sung cho gap của native search, không cài cả ba. Việc nhiều nguồn có ích được quyết định theo câu hỏi, không fan-out vô điều kiện. Installed science không làm toàn bộ biomedical skills trở thành baseline AI Research.

### E05 — Nền tảng/stateful tools theo workflow

Docling khi parsing corpus là bottleneck thực; Zotero khi có library; Jupyter khi workflow notebook-first cần kernel tương tác; W&B/MLflow khi dự án dùng nền tảng đó. Không dựng service/vector DB/notebook server mới chỉ để có MCP. Reuse scripts/native runner và artifact tracking đã có nếu đáp ứng. Jobs/kernel/remote calls phải có ID/observe/stop/reconcile/accounting, timeout/cancel ACK chưa là stopped.

### E06 — Harness MCP facade chỉ khi consumer cần

Codex tiếp tục dynamic tools hiện có. Khi Claude/Antigravity hoặc coordinator khác cần cùng core contract và facade giảm net code, dùng một MCP adapter mỏng tái dùng handlers/fencing. Không tạo MCP stack/client riêng, không expose grant-budget/permissions/confirm-benchmark, không thay scientific state hoặc scheduler.

### Quy trình provision và load

1. Inventory đúng profile, so với core/native/extensions đã có và chọn phần thiếu; baseline E02/E03 dùng tần suất lặp dự kiến, scope hẹp theo task dùng trigger thực tế.
2. Review exact subtree/scripts/dependencies/license, auth/egress, output/receipts và Windows compatibility; pin artifact, giữ attribution và adaptation diff.
3. Provision/lock phần đã chọn trong environment/project được cho phép. Có sẵn thì bind/reuse, không cài lại. Không đổi personal/global skills hoặc home .env theo default của upstream.
4. Metadata-first; chỉ load body/references cho task cần. Tool/process chỉ khởi động khi được dùng, tắt khi xong nếu không có lợi reuse đã kiểm. Không chạy toàn bộ toolchain mỗi task.
5. Kiểm contract offline/preflight, sau đó dùng cho công việc đúng quyền. Chỉ hỏi khi thiếu quyền/auth/budget; không xin lại mỗi call trong scope đã duyệt. Benchmark vẫn cần protocol và phê duyệt riêng.

Baseline là capability sẵn sàng có thể thay provider, không phải cố định thư viện bên ngoài mãi mãi. Khi cùng contract đã được native đáp ứng tốt hơn, bỏ dependency thừa. Nếu một task thật cần capability mạnh hơn, mở scope tương ứng thay vì giữ bộ nhỏ bằng mọi giá.

## 11. Nghiệm thu ít lượt và tối ưu trong sử dụng

Bổ sung coverage vào [protocol hiện có](acceptance-minimal-protocol.md), không tạo benchmark cho mọi server/skill.

| Gói | Kiểm tối thiểu | Điều không cần chạy riêng |
|---|---|---|
| S0 extension policy | Unknown/denied tool, inherited extra server, malformed metadata, path escape, catalog drift, secret redaction, package tamper/rollback | Không model calls cho selection/lock validation |
| S0 helpers baseline E02/E03 | Khi implement: một fixture flow arXiv/OpenAlex/DOI/BibTeX có partial/error/identity và raw receipts; một notebook-free calculation có exact symbolic oracle, statistical edge case và reproducible figure. Kiểm cả dependency import/path scope | Không model calls, không exhaustive upstream suites hay mô phỏng tạo tri thức mới. Assertions riêng, không bỏ lỗi vì đã pass một happy path |
| S0 lifecycle | Timed-out tool còn job, cancellation ACK nonterminal, unknown reservation, stale owner, output ngoài execution root | Không thuê GPU/remote jobs để mô phỏng điều code fixture kiểm được |
| P0 profile | Exact version/protocol, effective tools/permissions/roots, dependencies và auth route cần thiết, catalog sizes/timeouts | Không inference hoặc tác vụ có billing ẩn; nếu discovery có phí phải khai báo |
| L1 hoặc trace thật | Một công việc đúng profile chứng minh agent gọi được tool/skill, có raw receipt và output hiện hành | Không test mọi backend/model/tool permutation |
| L2 conditional | Elicitation/control/stateful job semantics chưa được trace hợp lệ chứng minh | Chỉ bật capability được chứng minh, không chèn fault experiment vào công việc thật |

Mọi deliberate live benchmark vẫn xin user duyệt riêng kèm protocol; quyền research hay import không là quyền chạy benchmark. Không chạy SkillsBench/UPskill eval tự động.

Theo dõi từ sử dụng: time-to-accepted-result, lỗi API/version, manual handoffs, repeated retrieval, actual usage/credits, tool selection sai và rework. Tắt/chọn lại route gây overhead mà không giúp task; vẫn giữ capability mạnh khi cần, không đặt trần số tools/skills tùy tiện làm mất năng lực.

## 12. Quyết định đề nghị để review

**Scope đề nghị tiếp theo:** E01 cùng E02/E03 — binding/lock tối thiểu, scholarly retrieval/citation và toolchain toán/phân tích/figures sẵn sàng từ đầu; reuse native documents/browser và skills đã có. Không có external MCP server nào bắt buộc ban đầu theo các contract đang xét; nếu route script/library thiếu contract cần thiết thì xem lại, không áp chính sách cấm MCP.

**Scope theo dự án:** E04/E05/E06 khi có trigger; không biến M02 hoặc toàn bộ catalog thành backlog. Nghiệm thu chỉ áp dụng component/profile thực sự bật; baseline E02/E03 phải đạt contract cần thiết trước khi gọi là sẵn sàng. Hiệu quả lựa chọn, UX và chất lượng khoa học tối ưu qua sử dụng, không cần campaign benchmark mới cho mỗi package.

**Chưa nên thêm đồng loạt:** toàn bộ scientific skill library, bootstrap Superpowers, nhiều search providers, filesystem/memory/reasoning MCP trùng core, notebook/vector service mới, autonomous skill generation/evaluation hoặc MCP gateway lớn.

MCP và skills bổ sung dữ liệu, công cụ và cách làm. Chất lượng suy luận, tính mới và giá trị khoa học tiếp tục cần review/evidence của dự án; việc cài thêm chúng không là chứng nhận năng lực nghiên cứu.

