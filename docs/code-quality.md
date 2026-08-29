# Repository-owned source quality

All tracked Pi Stuff code is Repository-owned Source. Local, forked, vendored, upstream-derived, generated, test,
prototype, script, and quality-tool code receives the same maintainability standard. Provenance determines attribution
and licensing, not quality exemptions. Machine state, caches, worktrees, build artifacts, binary assets, and prose are
not code and remain outside code checks.

## Required standard

- Every tracked code directory participates in Biome, Oxlint with the anti-slop rules, strict TypeScript where
  applicable, and unused-file/dependency analysis. Do not grant directory-wide or provenance-based exemptions.
- TypeScript profiles may differ only where their runtime needs different libraries, module resolution, or targets.
  They must not disable the shared strictness, unused-code, indexed-access, optional-property, override, side-effect,
  or erasable-syntax rules.
- A formatted hand-maintained file should contain 200–400 physical lines. More than 500 lines requires an explicit
  cohesion review; 800 lines is the merge limit. A function should contain 20–50 lines, requires review above 80, and
  may not exceed 120 lines.
- `check:repository` enforces the 800-line limit across repository code and recursively enforces the 120-line function
  limit in JavaScript and TypeScript. It audits tracked and non-ignored untracked files while excluding deleted files,
  binary assets, prose, and report artifacts.
- Splitting a file must reduce responsibilities, mutable state, branching, or concepts held at once. Moving unchanged
  complexity into mechanically named fragments does not satisfy the standard.
- Code-quality work reports before-and-after physical line counts. Treat the counts as review evidence, not an
  acceptance quota: investigate unexplained Capability growth and prefer deleting duplication, branches, wrappers,
  compatibility layers, or state. A neutral or positive delta is acceptable when it produces a deeper Module or
  preserves necessary explanation, validation, security, data integrity, accessibility, or compatibility. Never
  improve the metric through compressed syntax or weakened safeguards.
- Tests establish behavior and compatibility. Passing tests never substitutes for source review against this standard.

## Current repository remediation

The current whole-repository audit must resolve every reported structural and maintainability issue. The 24 audited
production files above 1,000 lines contain 36,313 physical lines before remediation. Track that audited set, every
module extracted from it, Capability totals, scripts, and tests so code movement and unexplained growth remain visible.
No aggregate percentage reduction or net-negative result is a completion condition. Completion depends on resolved
findings, Module cohesion, the file and function limits above, compatible behavior, real-Host acceptance, and review
convergence.

The remediation is one continuous Agent Session with no implementation handoff. It also resolves the accepted Code
Mode ledger/recovery and image-result work tracked by `ps-4hs` and `ps-6z2`; those defects are part of this program's
acceptance rather than deferred follow-up.

Work proceeds in small behavior-preserving batches:

1. Remove each quality-gate exemption together with the fixes it exposes, keeping the checked branch usable.
2. Repair explicit boundary defects and duplicated decisions before moving code: Web initialization error handling,
   provider dispatch, canonical helpers, and duplicate contracts.
3. Deepen the existing Capability Modules without moving lifecycle authority: Tool Display; Agents; Context
   Management, Goal, and Background Work; then MCP and Code Mode.
4. Bring oversized scripts, tests, prototypes, and quality tools under the same standard, simplifying them where that
   improves maintainability.
5. After implementation, run multi-turn acceptance in multiple fresh real Pi Host Sessions using `gpt-5.6-luna`,
   including continuation and recovery paths. Focused tests remain supporting behavior evidence rather than evidence
   that the structure is acceptable.
6. Run at least three complete Thermo-Nuclear Code Quality Review rounds. Fix every finding before the next round and
   finish only after two consecutive whole-repository rounds report no new issues.

For the `ps-6z2` Luna image study, exact digit recognition and the composite end-to-end rate that includes it are
observational model-quality evidence, not repository completion gates. Preserve the preregistered study and its failed
verdict unchanged. Hard compatibility acceptance remains on Suite-controlled behavior: Tool choice, exact image
transfer and integrity, exactly-once persistence, Session resume, valid instrumentation, zero Code Mode errors, and no
standing Provider-context increase.

The canonical work map lives in Beads. Record per-Capability baselines and acceptance criteria there before
implementation. Use line counts to expose code movement and unexplained growth, not as a deletion quota.
