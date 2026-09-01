# Repository-owned source quality

All tracked Pi Stuff code is Repository-owned Source. Local, forked, vendored, upstream-derived, generated, test,
prototype, script, and quality-tool code receives the same maintainability standard. Provenance determines attribution
and licensing, not quality exemptions. Machine state, caches, worktrees, build artifacts, binary assets, and prose are
not code and remain outside code checks.

## Required standard

- Every tracked code directory participates in Biome, Oxlint with the anti-slop rules, strict TypeScript where
  applicable, and unused-file/dependency analysis. Do not grant directory-wide or provenance-based exemptions.
- When Effect is a direct dependency, Oxlint also enables `anti-slop-effect/no-service-constructor-imports`. It rejects
  relative project imports of named `make<Capability>` service constructors from runtime Source so Layers remain the
  composition seam. Package-alias, default, and namespace imports are outside this rule; the repository-safety Effect
  boundary audit remains the authority for runners and native effects.
- TypeScript profiles may differ only where their runtime needs different libraries, module resolution, or targets.
  They must not disable the shared strictness, unused-code, indexed-access, optional-property, override, side-effect,
  or erasable-syntax rules.
- The repository typecheck runs all profiles in one TypeScript build process and keeps one incremental-state file per
  profile under
  `node_modules/.cache/pi-stuff/typecheck/`. These ignored caches may shorten repeated checks but never replace a clean
  check: TypeScript invalidates them from Source, configuration, and dependency versions, and a clean worktree rebuilds
  them without weakening any diagnostic.
- A formatted hand-maintained file should contain 200–400 physical lines. More than 500 lines requires an explicit
  cohesion review; 800 lines is the merge limit. A function should contain 20–50 lines, requires review above 80, and
  may not exceed 120 lines.
- `check:repository` enforces the 800-line limit across repository code and recursively enforces the 120-line function
  limit in JavaScript and TypeScript. It audits tracked and non-ignored untracked files while excluding deleted files,
  binary assets, prose, and report artifacts.
- The same check owns the Effect migration boundary inventory. Production Source that imports Effect must be governed;
  Effect runners are allowed only in listed governed Pi-facing adapters, and direct native effects are denied by
  default across all Package production Source. Production Source imports each Effect namespace through its public
  `effect/<Module>` subpath; the root barrel is denied so direct-source loading and typechecking do not traverse
  unrelated Effect modules. A narrow native-only adapter may be listed independently without importing Effect.
  Inventory entries are exact existing Source paths: duplicates and missing paths fail the check, and each migration
  expands the governed set without creating a directory-wide quality exemption.
- Splitting a file must reduce responsibilities, mutable state, branching, or concepts held at once. Moving unchanged
  complexity into mechanically named fragments does not satisfy the standard.
- Code-quality work reports before-and-after physical line counts. Treat the counts as review evidence, not an
  acceptance quota: investigate unexplained Capability growth and prefer deleting duplication, branches, wrappers,
  compatibility layers, or state. A neutral or positive delta is acceptable when it produces a deeper Module or
  preserves necessary explanation, validation, security, data integrity, accessibility, or compatibility. Never
  improve the metric through compressed syntax or weakened safeguards.
- Tests establish behavior and compatibility. Passing tests never substitutes for source review against this standard.

## Thermo-Nuclear completion review

- Review every code change with the `thermo-nuclear-code-quality-review` Skill. Review the complete diff from a fixed
  base and the complete affected Capability. If the Skill is unavailable, this section remains the required approval
  bar; unavailability never waives the review.
- Approval requires no structural regression, no clear code-judo simplification left undone, no ad hoc branching or
  boundary leak, no unnecessary wrapper, cast, optionality, or duplicated helper, and no unjustified size growth or
  mechanical split. Inspect ownership, mutable state, coupling, type boundaries, canonical placement, and atomicity.
- A small isolated change requires one focused clean review. Broad, cross-Capability, architecture, whole-repository
  quality/refactoring/source-reduction, or release-risk work requires an independent reviewer and repeated review of
  the whole affected scope until two consecutive rounds report no findings.
- A finding blocks completion until the implementation is fixed or direct source evidence proves that the finding does
  not apply. A clean result certifies only the exact reviewed source: any later code change invalidates it. Run the
  relevant automated checks again and review the final source before completion.
