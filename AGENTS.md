# Repository instructions

These instructions apply only while developing this repository. This file is not a Pi Package resource and must never be copied to the user's global Pi agent directory.

## Before changing code

- Read `CONTEXT.md` and the relevant records under `docs/adr/`.
- Use the canonical terms from the glossary in code, tests, issues, and documentation.
- Read `docs/agents/issue-tracker.md` before creating or changing work items.
- Target the certified host and toolchain versions documented in `docs/compatibility.md`.

## Architecture

- Pi is the Host. Do not create another CLI, runtime, session layer, SDK, or TUI shell.
- `@jczhang02/pi-stuff` is the one local Pi Package and has one default Extension factory.
- A Capability Module owns one coherent behavior inside that Package. Modules are not independently versioned,
  installed, or published.
- Lifecycle authority stays with its owner. Pi owns the ordinary foreground Agent run; Goal owns Goal continuation,
  budgets, convergence, pause, completion, and terminal state; Agents owns delegated Agent execution, limits, and
  termination. Another Module may expose observations or pressure signals through a narrow interface, but it must not
  enforce that lifecycle's policy or hard-code its commands, Tools, statuses, or terminal protocol.
- Context Management is the Magic Context Adapter. It owns provider context projection, retrieval, compaction, and
  context-pressure handling. It owns no task anchor or general work-convergence policy, must not impose generic turn,
  Tool, or delegation limits on Goal, Agents, or ordinary Pi work, and must not decide when those lifecycles pause,
  stop, complete, or fail.
- Keep Extension import pure: no network calls, file writes, subprocesses, or host-setting mutations. Session startup must not perform network calls, spawn subprocesses, mutate Host settings, or create, rewrite, or migrate user configuration. A documented Capability may initialize rebuildable derived local state before editor readiness when an accepted ADR requires that work off the message-submission path.
- During user-started work, a Capability may update its own documented derived local state across automatic continuations. First-use configuration creation must wait for direct interactive/RPC input or an explicit command or Tool; external, destructive, or unrelated effects still require an explicit user-triggered contract.
- The Statusline has one observation-only exception: after a complete user-driven Agent run settles it may run a bounded, no-lock `git status` read to obtain change counts that Pi does not expose. It must never run during import, initialization, `session_start`, individual model/Tool turns, or Extension-authored automatic runs, and failure must degrade to branch-only display.
- Let initialization errors propagate. A partially loaded Suite is not a supported state.

## UI contract

- Use Claude Code as the primary visible-behavior reference and Pi's native interaction grammar as the Host constraint. Reproduce the useful hierarchy, density, and lifecycle rather than copying source code or introducing another shell.
- Temporary focused surfaces are full-width, non-floating Command Dialogs. Settings use Pi's native SettingsList and keyboard behavior.
- Use Pi semantic theme tokens only. Never hard-code a personal theme, ANSI palette, or decorative frame for a focused
  Capability surface. The confirmed Claude-style bordered Welcome card is the sole exception: it is scrollable startup
  identity inside the conversation document, not a modal, overlay, or permanent Package dashboard.
- Preserve the conversation-first layout: reduce or omit lower-priority information at narrow widths before allowing overlap, stale chrome, editor displacement, or unbounded growth.
- Focus, Escape, draft, footer, working row, Todo widget, and Agent roster restoration are one deterministic cross-Capability contract.
- Keep information at one authority. Do not duplicate Todo, Agent, BTW, Permission, or Tool state in the Statusline or another permanent dashboard.

## Package contract

- Ship TypeScript source; do not add a `dist/` build lane.
- Pi core packages are wildcard peer dependencies and exact `0.84.2` development dependencies. Runtime certification
  uses the upstream source profile in `docs/compatibility.md`; never treat the same version string as sufficient proof.
- Declare external runtime dependencies once in `packages/pi-stuff/package.json`; internal Modules use relative imports
  and must never depend on a self-owned `@jczhang02/pi-*` package.
- Only files in the Package's explicit `files` allowlist may enter its local verification archive.
- Keep the Package private and do not add lifecycle or npm publication scripts.
- `packages/pi-stuff/suite.json` is the ordered composition source of truth. Run `bun run suite:generate` after changing it; never edit generated composition output alone.

## Verification seams

Tests observe behavior at these agreed seams:

- the Suite generator's result and committed artifacts;
- repository safety through its audit command;
- Extension discovery through Pi's public RPC protocol;
- the extracted local Package archive through Pi's Package loader.

Use `bun test` and integration-style assertions at these seams. Host and Package certification must use the public seams and may not be claimed from mocks or private helpers. Focused regression tests may exercise Module-internal pure logic and state, but supplement rather than replace seam-level certification. No test may call an LLM or require credentials.

## Tooling

- Create every Pi Stuff Git worktree under the repository-local `.worktrees/` directory; do not place worktrees elsewhere.
- Use Bun 1.3.14 for dependency management, scripts, and tests.
- Keep all direct dependencies exact and keep `trustedDependencies` empty.
- During development, run focused tests and `bun run check:fast`.
- Before marking a pull request ready or merging, run `bun run check` once against the final changes.
- Current source, ADRs, maintainer instructions, and executable documentation are English. Deliberately localized historical reports and CJK/UI fixtures may retain their language.
- Use Conventional Commits and preserve GPG signing.

## Generated and local state

- Never commit auth, model-store, session, cache, `.env`, or machine-specific state.
- Never put private absolute paths or credentials in Beads or public documentation.
- The repository root `AGENTS.md`, `CONTEXT.md`, and `docs/` are engineering material, not Runtime Resources.
- Installing the local Suite is an explicit maintainer action through `pi install`; Suite code must not perform installation.

## Agent skills

### Issue tracker

Beads is the canonical issue tracker; GitHub Issues is a public push-only mirror and external request inbox. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five canonical triage labels without aliases. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses a single-context domain layout. See `docs/agents/domain.md`.
