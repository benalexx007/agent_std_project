"""Finite, reviewed scientific helpers. No eval, package installation or network."""
import json
import math
import os
from pathlib import Path
import re
import sys


def bibliography(data):
    import bibtexparser
    text = Path(data["path"]).read_text(encoding="utf-8")
    library = bibtexparser.parse_string(text)
    failures = [{"kind": type(b).__name__, "raw": b.raw, "error": str(b.error)} for b in library.failed_blocks]
    recovered = [b.ignore_error_block for b in library.failed_blocks if hasattr(b, "ignore_error_block") and hasattr(b.ignore_error_block, "entry_type")]
    entries, issues, keys, dois = [], [], {}, {}
    for entry in list(library.entries) + recovered:
        fields = {f.key.lower(): f.value for f in entry.fields}
        key = entry.key
        doi = re.sub(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)", "", fields.get("doi", "").strip().strip("{}"), flags=re.I).strip().lower()
        identity = {k: fields.get(k) for k in ["title", "author", "year"]}
        if key in keys:
            issues.append({"kind": "citation_key_collision", "key": key, "retained": True})
        if doi and doi in dois:
            issues.append({"kind": "duplicate_doi" if identity == dois[doi] else "doi_metadata_conflict", "doi": doi, "retained": True})
        keys[key] = identity
        if doi:
            dois[doi] = identity
        entries.append({"key": key, "entry_type": entry.entry_type, "doi": doi or None, "fields": fields})
    return {"status": "partial" if failures or issues else "completed", "entries": entries,
            "issues": issues, "failed_blocks": failures, "rewritten": False,
            "note": "All original blocks retained in the pinned input. Identity checks do not verify cited scientific claims."}


def symbolic(data):
    import sympy as s
    symbols = {}
    for name, assumptions in data["symbols"].items():
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,29}", name):
            raise ValueError("Invalid symbol name")
        if any(k not in {"real", "positive", "nonnegative", "integer", "nonzero"} or type(v) is not bool for k, v in assumptions.items()):
            raise ValueError("Unsupported assumption")
        symbols[name] = s.Symbol(name, **assumptions)
    count = 0

    def expression(node, depth=0):
        nonlocal count
        count += 1
        if depth > 12 or count > 200 or not isinstance(node, dict):
            raise ValueError("Expression bound exceeded")
        if set(node) == {"symbol"}:
            return symbols[node["symbol"]]
        if set(node) == {"integer"} and re.fullmatch(r"-?[0-9]{1,12}", str(node["integer"])):
            return s.Integer(node["integer"])
        if set(node) == {"rational"}:
            p, q = node["rational"]
            if type(p) is not int or type(q) is not int or not q or max(abs(p), abs(q)) > 10**12:
                raise ValueError("Invalid rational")
            return s.Rational(p, q)
        if set(node) != {"op", "args"} or not isinstance(node["args"], list) or len(node["args"]) > 20:
            raise ValueError("Invalid expression AST")
        args = [expression(x, depth + 1) for x in node["args"]]
        functions = {"add": s.Add, "multiply": s.Mul, "power": s.Pow, "sqrt": s.sqrt,
                     "sin": s.sin, "cos": s.cos, "exp": s.exp, "log": s.log, "abs": s.Abs,
                     "differentiate": s.diff, "integrate": s.integrate}
        if node["op"] not in functions:
            raise ValueError("Unsupported symbolic operation")
        if node["op"] == "power":
            if len(args) != 2 or args[1].is_Integer and abs(args[1]) > 12:
                raise ValueError("Power exponent exceeds the finite helper bound; use sandboxed research code")
            if args[0].is_Integer and args[1].is_Integer and abs(int(args[0])).bit_length() * abs(int(args[1])) > 10000:
                raise ValueError("Integer power output too large")
        return functions[node["op"]](*args)
    original = expression(data["expression"])
    simplified = s.simplify(original)
    relation = None
    if "compare" in data:
        equal = simplified.equals(expression(data["compare"]))
        relation = "equal" if equal is True else "not_equal" if equal is False else "unknown"
    return {"status": "completed", "expression": str(original), "simplified": str(simplified),
            "latex": s.latex(simplified), "assumptions": data["symbols"], "relation": relation,
            "evidence_level": "symbolic_check_only", "open_obligations": ["Check statement, domain and assumptions independently."]}


def paired(data):
    import numpy as np
    from scipy import stats
    a, b = np.asarray(data["a"], dtype=float), np.asarray(data["b"], dtype=float)
    if a.shape != b.shape or a.ndim != 1 or len(a) < 2 or not np.isfinite(a).all() or not np.isfinite(b).all():
        raise ValueError("Paired samples need matching finite observations")
    differences = b - a
    output = {"status": "completed", "n_pairs": len(a), "mean_difference": float(differences.mean()),
              "sample_variance": float(differences.var(ddof=1)), "method": data["method"],
              "unit_of_analysis": data["unit_of_analysis"], "seed": data.get("seed"),
              "warnings": [], "scientific_verdict": "not_assessed"}
    if data["method"] == "sign_flip_exact":
        if len(a) > 16:
            raise ValueError("Exact sign flip is bounded to 16 pairs")
        means = [sum((-1 if mask & (1 << i) else 1) * d for i, d in enumerate(differences)) / len(a) for mask in range(2**len(a))]
        output["two_sided_p"] = sum(abs(x) >= abs(output["mean_difference"]) - 1e-12 for x in means) / len(means)
        output["assumption"] = "Sign exchangeability under the declared null; pairing/unit must be scientifically justified."
    elif data["method"] == "bootstrap":
        if output["sample_variance"] == 0:
            output.update(status="partial", confidence_interval=None)
            output["warnings"].append("Degenerate paired differences; uncertainty not identified by this bootstrap.")
        else:
            result = stats.bootstrap((differences,), np.mean, rng=np.random.default_rng(data["seed"]),
                                     n_resamples=data.get("n_resamples", 999), method="BCa")
            lo, hi = map(float, result.confidence_interval)
            output["confidence_interval"] = [lo, hi] if math.isfinite(lo) and math.isfinite(hi) else None
            if output["confidence_interval"] is None:
                output["status"] = "partial"
                output["warnings"].append("Non-finite bootstrap interval")
    elif data["method"] != "summary":
        raise ValueError("Choose an explicit supported method")
    return output


def figure(data, output):
    import matplotlib
    matplotlib.use("Agg")
    from matplotlib import pyplot as plt
    if len(data["x"]) != len(data["y"]) or not all(math.isfinite(v) for v in data["x"] + data["y"]):
        raise ValueError("Figure coordinates must be matching finite arrays")
    fig, ax = plt.subplots()
    ax.plot(data["x"], data["y"])
    ax.set(xlabel=data["xlabel"], ylabel=data["ylabel"], title=data.get("title", ""))
    fig.tight_layout()
    for suffix in ["png", "svg"]:
        fig.savefig(output / ("figure." + suffix))
    plt.close(fig)
    return {"status": "completed", "files": ["figure.png", "figure.svg"], "points": len(data["x"]),
            "data": data, "backend": "Agg", "scientific_verdict": "not_assessed"}


def pdf(data):
    from pypdf import PdfReader
    reader = PdfReader(data["path"])
    if reader.is_encrypted:
        raise ValueError("Encrypted PDF requires a separate authorized workflow")
    selected = data["pages"]
    if any(p < 1 or p > len(reader.pages) for p in selected):
        raise ValueError("Page outside PDF")
    return {"status": "completed", "total_pages": len(reader.pages),
            "pages": [{"page": p, "text": reader.pages[p-1].extract_text() or ""} for p in selected],
            "coverage": "selected_pages_text_only", "layout_verified": False,
            "warning": "Inspect rendered source pages for mathematics, tables and layout-dependent claims."}


def vendored(data, module):
    sys.path.insert(0, str(Path(__file__).resolve().parent / "vendor" / "paper_lookup"))
    import arxiv_atom
    import openalex_abstract
    import contextlib
    import io
    output, errors = io.StringIO(), io.StringIO()
    parser = arxiv_atom if module == "arxiv" else openalex_abstract
    with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
        try:
            code = parser.main([data["path"]])
        except SystemExit as error:
            code = error.code
    if code:
        return {"status": "partial", "records": [], "error": errors.getvalue()[:1000], "parser_exit_code": code}
    return {"status": "completed", "data": json.loads(output.getvalue())}


if __name__ == "__main__":
    request_path, output_path = map(Path, sys.argv[1:3])
    request = json.loads(request_path.read_text(encoding="utf-8"))
    output_path.mkdir(exist_ok=True)
    action, data = request["action"], request["arguments"]
    actions = {"bibliography": bibliography, "math": symbolic, "paired": paired, "pdf": pdf,
               "arxiv": lambda d: vendored(d, "arxiv"), "openalex": lambda d: vendored(d, "openalex")}
    result = figure(data, output_path) if action == "figure" else actions[action](data)
    (output_path / "result.json").write_text(json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2), encoding="utf-8")
