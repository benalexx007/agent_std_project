# Catalog tham khảo MCP/skills — không phải danh sách tích hợp

Ngày rà soát: **27/10/2026**. Tài liệu này lưu phạm vi discovery rộng, không phải backlog, bộ cài mặc định, thứ tự ưu tiên hoặc điều kiện nghiệm thu. **Quyết định hiện hành nằm ở [plan tích hợp có chọn lọc](external-mcp-skills-research.md), đặc biệt mục 1, 2 và 10.** Mã M01–M20 chỉ là ID tham chiếu. M02/Azure/.NET và các công cụ phụ thuộc stack nằm ngoài baseline Research.

Trước chọn phải so với backend/runtime/core và extension đã có, kiểm phiên bản/license/dependencies, rồi chỉ provision phần có lợi. Một provider có nhiều route không đòi hỏi cài tất cả; metadata trong catalog chưa là package lock hoặc bằng chứng callable.

## MCP và công cụ tương đương: phạm vi discovery

Ưu tiên là đề xuất theo nhu cầu, không phải trạng thái installed/supported. Mỗi hàng phải so với khả năng native/CLI đang có trước activation.

| ID | Ứng viên / nguồn sơ cấp | Lợi ích thực tế | Route/chi phí và quyết định |
|---|---|---|---|
| M01 | [OpenAI Docs MCP](https://developers.openai.com/learn/docs-mcp) | Tra cứu API/Codex theo tài liệu chính chủ; giúp implementer và planner kiểm nguồn | Read-only documentation, không gọi inference API hộ. Ưu tiên khi làm OpenAI; không bật cho mọi task chỉ vì coordinator là Codex |
| M02 | [Microsoft Learn MCP + skills/CLI](https://github.com/microsoftdocs/mcp) | Nguồn SDK/Azure/.NET khi dự án dùng stack đó | Conditional theo stack. So CLI-first với MCP-first của upstream; không import toàn ecosystem Azure |
| M03 | [Context7](https://github.com/upstash/context7/tree/master/packages/mcp) | Tìm docs/code examples theo library, giảm API hallucination | Shortlist cho implementation. Tool names hiện có resolve-library-id/query-docs; pin tên/schema. Đối chiếu source/version gốc, không coi mọi nội dung aggregating là primary evidence |
| M04 | [GitHub official MCP](https://github.com/github/github-mcp-server) | Remote code/issues/PR/CI phục vụ research về implementations | Chọn read-only + một số tools/toolsets, không all. Local repo dùng rg/git trước; remote operations so với gh. Write scope chỉ khi task cần và đã được cho phép |
| M05 | [Hugging Face official MCP](https://github.com/huggingface/hf-mcp-server) | Search models/datasets/papers và truy cập hệ sinh thái Hub | Shortlist ML. So hf CLI + skill; ban đầu chỉ discovery/read. Spaces/inference/jobs có scope và billing khác, không tự bật toàn bộ proxy/dynamic tools |
| M06 | [arxiv-mcp-server](https://github.com/blazickjp/arxiv-mcp-server) | Đọc outline/section từ LaTeX nguồn, BibTeX, paper corpus local | Community server có giá trị cho paper toán/ML đọc lặp. Chỉ search/metadata dùng API/script có thể đủ. Watches không mặc định vì thêm background work |
| M07 | [Zotero MCP](https://github.com/54yyyu/zotero-mcp) | Tìm/đọc paper, annotations và bibliography trong thư viện cá nhân | Ưu tiên nếu có thư viện Zotero thật. Coding worker có shell xem CLI+skill trước. Read library trước; writes/semantic embeddings là scope riêng |
| M08 | [Exa MCP](https://github.com/exa-labs/exa-mcp-server) | Search/fetch web khi native search không đủ coverage/contract | Một lựa chọn cho lớp search. Tool mặc định search/fetch; agent_run là scope khác cần auth và budget riêng. Không thay coordinator bằng một agent tool ẩn |
| M09 | [Tavily MCP](https://github.com/tavily-ai/tavily-mcp) | Search/extract/map/crawl có cấu trúc | Lựa chọn thay Exa theo workload. Search+extract trước, không crawl toàn site mặc định. Kiểm auth/billing và output bounds |
| M10 | [Brave official MCP](https://github.com/brave/brave-search-mcp-server) | Search provider độc lập; hữu ích khi cần coverage khác | Có API key/plan riêng. Chọn search surface cần thiết; answers có xử lý khác với raw search. Không dùng reference Brave server đã archive |
| M11 | [Firecrawl MCP](https://github.com/firecrawl/firecrawl-mcp-server) | Website khó đọc, extract/crawl/parse/browsing | Conditional khi simple fetch/native browser không đủ. Crawl/Agent/Monitor có chi phí/lifecycle riêng, không chọn chỉ vì nhiều tools |
| M12 | [Docling MCP](https://github.com/docling-project/docling-mcp) | PDF cấu trúc, tables/layout và cache conversion cho corpus lặp | Có lợi khi Markdown đơn giản mất thông tin. Python/service/model footprint; so library/CLI batch. Pin client/SDK compatibility, không suy latest package tương thích mọi host |
| M13 | [MarkItDown MCP](https://github.com/microsoft/markitdown/tree/main/packages/markitdown-mcp) | Chuyển tài liệu về Markdown qua một tool | Simple conversion thường dùng library/CLI đủ. MCP hợp host không shell. Không coi Markdown là bản chính xác của toán/bảng; giữ raw PDF và locators |
| M14 | [Lean LSP MCP](https://github.com/oOo0oOo/lean-lsp-mcp) | Goal state, diagnostics và tương tác Lean cho phát triển proof | Ưu tiên khi có formalization task thật. Cần Lean/mathlib/toolchain, build/cache/RAM. Phải audit theorem statement, sorry/admit và allowed axioms; diagnostics sạch không tự là proof đầy đủ |
| M15 | [Wolfram AgentTools](https://github.com/WolframResearch/AgentTools) | Symbolic computation/notebook chuyên sâu | Conditional khi SymPy/local code không đáp ứng. Local engine và remote service có điều kiện khác; optional LLMKit tăng scope. CAS output vẫn cần assumptions/domain checks |
| M16 | [Datalayer Jupyter MCP](https://github.com/datalayer/jupyter-mcp-server) | Điều khiển notebook/kernel đang dùng, inspect outputs, local/cloud | Có lợi khi workflow thực sự notebook-first. Kernel/job có thể sống sau disconnect. Cần ID/namespace/stop/reconcile và replay clean; script hữu hạn thường đơn giản hơn |
| M17 | [W&B MCP](https://github.com/wandb/wandb-mcp-server) | Tìm/filter runs, config, sparse history của dự án có W&B/Weave | Chỉ khi đang dùng nền tảng đó. Read-only/tool profile + bounded responses; giữ local evidence, không thay scientific records bằng vendor score |
| M18 | [MLflow MCP](https://mlflow.org/docs/latest/genai/mcp/) | Truy cập traces/feedback/metadata của MLflow | Conditional với MLflow hiện có; feature docs còn experimental. Không mặc định nó là universal experiment scheduler hoặc evaluator khoa học |
| M19 | [DeepWiki MCP](https://docs.devin.ai/work-with-devin/deepwiki-mcp) | Overview/Q&A về public repositories | Hữu ích để định hướng repo lớn; AI-generated answer là analysis, cần mở code/docs gốc cho planning evidence. Không thêm nếu gh/rg/docs đã đủ |
| M20 | [MCP reference servers](https://github.com/modelcontextprotocol/servers) | Fetch/files/git/memory/sequential-thinking làm mẫu protocol | Tránh trùng shell, tools, state và reasoning core/native. Chỉ dùng phần còn thiếu có lợi. [Archived servers](https://github.com/modelcontextprotocol/servers-archived) không là default production choice |

**Các hàng trên không tự quyết định provisioning.** Baseline lặp lại và các nhánh theo dự án được quyết định trong plan chính. Exa/Tavily/Brave là các lựa chọn thay thế, không là danh sách cài đồng thời. Search đa nguồn vẫn được mở khi cần đối chiếu coverage hoặc một provider không đủ. Chỉ rà sâu package/version và viết adapter cho ứng viên đã có nhu cầu thực tế.

Không thêm filesystem/memory/sequential-thinking MCP chỉ để tăng tool count. Native reasoning và core durable records đã có trách nhiệm tương ứng. Library hoặc CLI mới vẫn là integration cần pin/dependencies/receipt, không mặc định miễn phí vì không qua MCP.

## Nguồn skills để tham khảo

| Nguồn | Phần nên xem | Phần cần thích nghi hoặc chưa ưu tiên |
|---|---|---|
| [K-Dense scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills) | paper-lookup, citation-management, sympy, experimental-design, statistical-analysis, hypothesis-generation, critical-thinking, peer-review/writing | Chọn module; nhiều package ngoài AI/ML không cần. Kiểm license và scripts từng skill; API/framework versions phải hợp project |
| [Hugging Face skills](https://github.com/huggingface/skills) | hf-cli, Trackio và workflow ML phù hợp | Upload/deploy/train/jobs/inference không tự được phép vì metadata skill liệt kê. Pin HF tool version; generated CLI guide không tự regenerate giữa run |
| [Science Superpowers](https://github.com/K-Dense-AI/science-superpowers) | Pre-registration, design/verification/reporting rubrics | Không nhập bootstrap/choreography; không tạo scientific state song song. prereg.sh cần Git và Git history không là external trusted timestamp hay bằng chứng chưa xem data |
| [Superpowers](https://github.com/obra/superpowers) | system debugging, verification-before-completion, review guidance cho Application/implementation | Workflow TDD/brainstorming/subagent mặc định không áp vào mọi research task nhỏ; không dùng thêm scheduler/review loop trùng |
| [Anthropic skills](https://github.com/anthropics/skills) | mcp-builder, webapp testing và tài liệu nếu cần | Document packages có license khác. Đây là patterns/examples, không tự chứng nhận kết quả của mọi backend |
| [OpenAI plugins](https://github.com/openai/plugins) | Skill-only/plugin packaging và tích hợp phù hợp stack | Packaging Codex không phải canonical config đa backend; chọn subtrees, không biến hệ thống thành phụ thuộc marketplace |
| [Microsoft skills](https://github.com/microsoft/skills) | SDK skill đúng stack Azure/Foundry nếu dự án dùng | Không cần bootstrap cả cloud/agent ecosystem cho Research tổng quát |
| [Playwright CLI + Skills](https://github.com/microsoft/playwright-cli) | Browser automation/E2E có shell | So với native browser và Playwright MCP; vẫn có browser/session lifecycle và network scope |
| [Zotero CLI + skill](https://github.com/54yyyu/zotero-mcp) | Bibliography/paper library thao tác hữu hạn | Khác MCP/annotation plugin; chỉ chọn nếu có workflow Zotero |
| [Vercel skills CLI/catalog](https://github.com/vercel-labs/skills) | Discovery/import tooling nếu giảm code thật | Catalog popularity không chứng minh skill hữu ích; không chạy auto-install/update từ catalog trong worker |
| [HF UPskill](https://github.com/huggingface/upskill) | Tham khảo skill generation từ traces cho vòng cải tiến sau | Có teacher/student models và eval trên HF Jobs theo default hiện tại. Chưa tích hợp vòng tự sinh/benchmark; cần run protocol và user approval riêng |
