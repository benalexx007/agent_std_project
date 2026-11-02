# Symbolic tools and obligations

The finite math.check helper takes an expression AST and explicit symbol assumptions, not executable source. Inspect its contract before use. Examples of AST nodes: {"symbol":"x"}, {"integer":2}, {"rational":[1,2]}, {"op":"sqrt","args":[...]}. Use add, multiply, power and supported calculus functions as needed. Bounded helper limitations leave an obligation open; more general project code runs under the authorized backend sandbox.

Check domains, singularities and quantifiers independently. For real x, sqrt(x^2) is Abs(x), not x in general; without assumptions simplification may remain unknown. Exact symbolic equality, finite counterexample search and numerical agreement are different evidence levels. Retain the original statement, assumptions, transformation and raw tool result; a helper success never promotes a record to verified_proof automatically.
