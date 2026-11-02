# Empirical analysis and reproducible figures

Declare units, pairing/clusters, splits, leakage controls and the estimand before choosing an analysis. Examples from other fields are not a universal statistical protocol for ML. Multiple seeds from one dataset do not automatically represent independent samples from a population of datasets. Preserve exploratory versus confirmatory status and changes after looking at outcomes.

statistics.paired is for justified matched observations; it reports b-a. Choose summary, exact sign-flip or bootstrap explicitly. State exchangeability/independence assumptions and uncertainty limitations. Sign-flip enumeration is bounded; bootstrap needs a seed and declared resampling procedure. Degenerate/NaN intervals are inconclusive uncertainty, not proof of no effect. Use project-specific code for cluster/hierarchical or other designs rather than forcing them through this helper.

figure.plot creates headless PNG/SVG from supplied x/y data and labels. Preserve data, code/config/environment and result hashes. Check axes, units and uncertainty visually when they affect the claim. Reproducible data and numerical outputs matter; byte-identical vector files across platforms are not required.

The interpreter path in the extension binding is provisioned and locked. For more general authorized code, invoke it directly inside the backend sandbox; never install/update packages mid-task or send arbitrary source to the controller's finite helper dispatcher.
