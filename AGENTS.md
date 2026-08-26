# Repository instructions

These instructions apply only while developing this repository. `AGENTS.md`, `CONTEXT.md`, and `docs/` are engineering
material, not Pi Runtime Resources; never copy them into a user's global Pi Agent directory.

## Read by task

- Before changing code, read `CONTEXT.md`, the relevant accepted ADRs, and `docs/compatibility.md`.
- Before quality, refactoring, fork-integration, or source-reduction work, also read `docs/code-quality.md`.
- For visible surfaces, also read `DESIGN.md` and the owning Module README or ADR. For work items, read
  `docs/agents/issue-tracker.md`.
- Use the glossary's canonical terms. Record durable terminology or architecture decisions in `CONTEXT.md` or an ADR,
  not only in Session history.

## Working rules

- Fix the shared root cause and inspect the complete affected Capability, not only the reported example. Prefer the
  smallest change at the owning seam and reuse Pi's public APIs, native behavior, and existing Suite components.
- Treat every tracked implementation, test, script, prototype, generated source, and repository quality tool as
  Repository-owned Source regardless of provenance. Source origin never permits a Biome, Oxlint/anti-slop, TypeScript,
  dependency-analysis, file-size, or maintainability exemption. Exclude only non-code machine state and artifacts.
- Follow the size and reduction gates in `docs/code-quality.md`. File splitting must deepen an owning Module and reduce
  concepts or state, not distribute the same complexity across mechanical fragments.
- For material design choices, compare viable options and evidence before choosing the smallest adequate one. Explain
  unfamiliar terms and the result in plain language.
- Make obvious, reversible repository-local decisions without asking. Ask one concise question in the conversation,
  not through a question widget, only when scope, authority, or a material product decision genuinely depends on it.
- Keep long-running work observable. The Agent owns focused checks and representative real-Host acceptance; do not hand
  routine verification back to the user. Use independent review for broad, cross-Capability, architecture, or
  release-risk work, and when the user requests adversarial review—not for every small isolated change.

## Hard boundaries

- Pi is the Host. Do not create another CLI, runtime, session layer, SDK, or TUI shell. Pi Stuff remains one local
  Package with one default Extension factory; Capability Modules are internal and not independently installed or
  published.
- Lifecycle authority stays with its owner: Pi owns ordinary foreground Agent runs, Goal owns Goal continuation and
  terminal policy, and Agents owns delegated execution. Context Management owns context projection, retrieval,
  compaction, and pressure handling—not task convergence or another lifecycle's limits or terminal decisions.
- Keep Extension import pure. Session startup must not access the network, spawn subprocesses, mutate Host settings, or
  create, rewrite, or migrate user configuration. First-use configuration waits for direct interactive/RPC input or an
  explicit command or Tool. Let initialization errors propagate rather than loading a partial Suite.
- Follow `DESIGN.md` for UI and keep each state at one visible authority. Ship TypeScript source without a `dist/`
  lane. Change `packages/pi-stuff/suite.json`, then run `bun run suite:generate`; never edit generated composition
  output alone.

## Workflow and safety

- Put every Pi Stuff Git worktree under repository-local `.worktrees/`.
- Use the versions in `docs/compatibility.md`; keep direct dependencies exact and `trustedDependencies` empty.
- During development, run focused tests and `bun run check:fast` from the root of the worktree containing the changes.
  Before marking a PR ready or merging, run `bun run check` there against the final changes. Checks from another
  worktree do not certify those changes. Public-seam certification cannot be claimed from mocks.
- Do not infer a merge from ancestry alone. Inspect the relevant patch or commits, every associated worktree's tracked
  and untracked state, and the target branch before reporting merge or cleanup status.
- Commit small, coherent checkpoints frequently after the relevant focused check; do not accumulate unrelated work in
  one commit. Use signed Conventional Commits.
- Keep current source, ADRs, maintainer instructions, and executable documentation in English. Update the owning
  current documentation in the same change whenever behavior, contracts, terminology, compatibility, or workflow
  changes; do not defer documentation until the end.
- When creating a Bead, record enough conversation provenance to retrieve its source Session: the originating Host or
  Agent surface (`Pi`, `Codex`, or another named surface), the Session name when available, and a stable Session ID or
  equivalent lookup key. Record metadata only and follow the public-data policy; never paste transcript content or
  sensitive Session data into Beads.
- Never commit credentials, auth, model stores, Sessions, caches, `.env`, machine state, or private absolute paths.
  Installing the Suite remains an explicit maintainer action through `pi install`; Suite code must not install itself.

Beads is the canonical issue tracker; GitHub Issues is its public push-only mirror and external intake. The five
canonical labels and the single-context domain layout are defined under `docs/agents/`.
