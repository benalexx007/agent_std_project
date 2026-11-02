# Retrieval, identifiers and bibliography

When an extension profile is supplied, inspect the operation contract through harness_extension (omit arguments), then make bounded requests. Keep raw source/version and distinguish a metadata page, selected full text, search coverage and access failure. Use continuation explicitly; an empty/error/limited page is not a novelty finding. Read result files with bounded harness_read rather than loading the entire corpus into context.

Use arXiv versioned identifiers for downloads. Compare OpenAlex/Crossref metadata with the paper or publisher for central citations, corrections and version relations. A DOI that resolves does not establish that the cited claim is supported. Keyless OpenAlex may not support deeper cursor paging. Missing access is a recorded limitation; do not invent credentials or evade it with unbounded scraping.

Bibliography validation preserves the original input. A citation-key collision does not mean duplicate papers. Resolve differing DOI/title/version metadata before merging; if keys must change, preserve an old-to-new mapping and update manuscript references. Failed parse blocks and macros require explicit handling, not a successful-looking rewrite. The bundled helper reports collisions and preserves raw blocks; it does not rewrite the bibliography or adjudicate scientific claims.

Use paper.read for selected-page extraction and paper.render for layout-dependent mathematics, tables or figures. Text extraction does not verify visual fidelity. Keep page locators and the raw PDF hash. Re-inspect relevant primary sources during planning; label cached retrieval and current inspection separately.
