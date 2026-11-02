# Mathematical development

Define objects, notation, domain and assumptions before the statement being derived. Break a difficult argument into lemmas with explicit dependencies and open obligations. Record the derivation itself, not a claim that an unspecified calculation works. Check boundary cases, division by zero, signs, units, quantifiers and assumption compatibility when relevant.

Use derivation records. Levels are conjecture, unchecked_derivation, proof_sketch, reviewed_proof and verified_proof. Numerical or symbolic checks have their own scope and do not imply a general proof. A proof-level record requires no open obligations, a matching statement verification and hashed evidence. A formal verifier receipt must specify tool/library version and no admitted goals; separately review whether the formalized statement matches the scientific claim.

Use exact arithmetic, symbolic algebra, counterexample search, a solver or a proof assistant according to the problem and available capabilities. The command/manual adapter can run an authorized verifier; record its command, version, input and raw output. Missing tools leave the corresponding obligation unchecked. Harness validation checks the record and provenance; it does not authenticate a proof from a JSON declaration.

At handoff preserve assumptions, checked lemmas, open obligations, failed approaches and critical counterexamples. Do not split tightly coupled reasoning merely to increase agent count.
