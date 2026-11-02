# Selected upstream and execution boundary

paper-lookup parsers are vendored without modification from the commit in vendor/paper_lookup/UPSTREAM.json, with its MIT license. Only arxiv_atom.py, openalex_abstract.py and their _common.py dependency are included. No upstream bootstrap, network client, credential setup or biomedical workflow is activated.

The harness owns one bounded HTTP path and explicit page continuation for three scholarly sources. It reuses the arXiv parser's error-feed/version handling. The OpenAlex abstract parser is available as an offline helper, not a second search client. This replaces the initially proposed import of the complete paginate.py CLI: process ownership, shared request envelopes and raw receipts require the harness transport.

BibtexParser is installed from pinned wheels. citation-management is guidance only; its custom parser/formatter/dedup is not executed. Duplicate-key failed blocks are retained/reported, never silently dropped or rewritten. No scientific verdict is inferred from any helper receipt.

The worker runs only enumerated actions and a bounded symbolic AST, with no arbitrary eval/source entrypoint. General project code stays in the backend sandbox. PDF text uses pypdf; rendering binds the already installed Poppler binary/dependencies. No notebook, MCP daemon, hidden model, global skill or account setup is installed.
