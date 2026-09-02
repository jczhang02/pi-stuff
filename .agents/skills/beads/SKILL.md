---
name: beads
description: Manage accepted Pi Stuff work in Beads. Use when finding, fetching, creating, claiming, relating, adopting, publishing, updating, or closing durable work items, including work maps and GitHub issue intake; do not use for only a current-turn checklist.
---

# Beads

The [issue-tracker contract](../../../docs/agents/issue-tracker.md) is authoritative. Read it fully before mutating
tracker state. If generic `bd` guidance disagrees with it, follow the contract.

Run `bd prime` after a new Session, compaction, or when current Beads context is missing. This repository intentionally
has no Beads hooks, so do not rely on automatic context injection.

## Choose the state owner

- Use Beads for accepted shared work, dependencies, follow-ups, and handoff.
- A local Agent plan may track current-turn execution, but it never replaces Beads.
- Record durable terminology or architecture decisions in `CONTEXT.md` or an ADR as well as any relevant Bead.

## Operate the tracker

1. Fetch a supplied Beads ID (`ps-...`) with `bd show <id>`. For a GitHub intake ID (`gh-...`), use the adoption
   route below. To select work, use `bd ready` or `bd ready --parent <epic-id>`.
2. Search all statuses with `bd search "<terms>"` before creating likely duplicate work. Create accepted work with
   `bd create` and verify that each new ID uses the `ps` prefix. Every new Bead must record the originating Host or
   Agent surface, Session name when available, and stable Session ID or equivalent lookup key. Store metadata only,
   never transcript content.
3. Claim before implementation with `bd update <id> --claim`.
4. Update fields with non-interactive `bd update` flags. Do not use `bd edit`.
5. Represent a work map as an epic, its tickets as children, and blockers with
   `bd dep add <blocked-id> <blocker-id>`.

## Keep Beads local

- The local Dolt database is authoritative. The ignored `.beads/` workspace and its scrubbed JSONL export are local
  state; the export is not a backup.
- Let Beads manage issue state only. Do not invoke `bd init`, `bd setup`, `bd hooks`, `bd dolt push`, `bd dolt pull`,
  or general `bd github sync` directly in this repository, and do not install Beads Git or Codex hooks.
- Keep `.beads/` out of Git. Beads must not stage, commit, push, or otherwise operate repository Git.

## Use the GitHub boundary

- GitHub Issues is public intake and a push-only mirror. Make accepted-work updates in Beads, never in the mirror.
- For external intake triage, follow the [triage-label contract](../../../docs/agents/triage-labels.md). A public label
  does not make work executable.
- Before adopting accepted external intake, search for an existing adoption with
  `bd search --external-contains "gh-<number>"`. If none exists, use the maintainer-directed one-time
  `bd github pull gh-<number>` operation, then continue with its returned `ps` ID.
- After adoption, return to Beads and push-only publication. Perform no other pull or bidirectional sync.
- Treat pull requests as code delivery and review, not as authority for scope, dependencies, status, or closure.

## Complete accepted work

1. Verify every acceptance criterion and the required checks.
2. Close with `bd close <id> --reason "..."`.
3. If the request includes external publication, use only `bun run beads:publish -- <epic-or-bead-id>` after closure.
4. Return the Beads ID and, when published, the GitHub URL.

Treat every Bead and GitHub mirror field as potentially public. Exclude credentials, private paths or data,
unpublished personal information, and sensitive operational details.
