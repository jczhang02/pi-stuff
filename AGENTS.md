# Agent instructions

Use Sepia for all prose, including Beads entries; preserve facts and technical details.

## Git workflow

Commit each coherent, verified change promptly and push the working branch after committing and before handoff, unless the user asks otherwise. Stage only task-related changes. If verification or push fails, report the blocker; do not claim the work is complete or published. Never force-push without explicit permission.

Create worktrees under `.worktrees/<branch-name>` at the repository root. Keep `.worktrees/` ignored by Git.

## Agent skills

### Issue tracker

GitHub Issues is the collaboration surface; Beads holds execution context. Before creating, reading, updating, commenting on, or closing tasks, read `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels. Before triaging or changing labels, read `docs/agents/triage-labels.md`.

### Domain docs

Use a single context: root `CONTEXT.md` and `docs/adr/`. Before exploring code or proposing design changes, read `docs/agents/domain.md`.

### Contributions

Before creating an issue or PR, read `CONTRIBUTING.md` and use the corresponding template. Write repository documents, issues, PRs, and public comments in English; use the user's preferred language in conversation.
