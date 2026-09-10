# Issue tracker: GitHub + Beads

[Chinese reading reference](../i18n/zh-CN/agents/issue-tracker.md). English is authoritative; the translation is for human readers.

Repository: `jczhang02/pi-stuff`.

GitHub Issues holds requirements, acceptance criteria, public progress, decisions, and PR links. Beads holds agent execution context: investigation notes, dependencies, blockers, and handoffs. Retain enough context in Beads for another agent to resume work.

## Linked tasks

Behavior changes and multi-step work need a tracked task. Typo and formatting fixes may go directly to a PR without a separate issue or Beads record. Explicitly authorized repository bootstrap work may also proceed without Beads while initialization is pending; disclose this in the PR.

Before creating a task, search both trackers for an existing record. Use one linked GitHub issue and Beads record for the same task; do not independently create duplicates with `gh issue create` and `bd create`.

For a GitHub issue without a linked Beads record, import it with `bd github pull <issue-url>` before claiming work, then verify its external reference. For a new Beads task intended for publication, use `bd github push <bead-id>` and verify the link. Read and reconcile existing linked tasks through the work cycle below; do not pull them again. Record the association in Beads and include the Beads ID in the initial GitHub progress comment when available.

When a skill says "publish to the issue tracker," publish a GitHub issue and establish its Beads association. When it says "fetch the relevant ticket," read the GitHub body, labels, comments, and associated Beads context.

## Session ownership

An agent-owned task has one current execution-owner session and may involve several sessions over its lifetime. Identify a session with its platform and stable session ID, such as `pi:<session-id>`, plus an available conversation link or locator. A model name or display nickname alone cannot identify the execution context.

Store the current owner identity in the Beads assignee field. Keep its platform, session ID and locator in task metadata or notes; associate other sessions with their actual roles, such as investigation, implementation or independent review. For a child agent, retain the parent session and the tool-provided child identifier. If a stable session ID is unavailable, record that limitation and the available locator instead of inventing an ID. Session references identify the conversation; retain the actionable findings and remaining work in Beads as well.

Use `bd --actor <platform:session-id>` for the session performing an update. The actor is the writer of that operation; the assignee owns delivery. A reviewer records their own identity without replacing the execution owner. Reflect the current owner and relevant handoffs in the GitHub issue body or progress comments; GitHub account assignees do not represent agent sessions. Publish useful session references without exposing private transcripts or personal filesystem paths.

Claim unassigned work with `bd --actor <platform:session-id> update <bead-id> --claim`. Keep native Beads claims; metadata and notes retain session context but do not replace the claim mechanism. If an initial GitHub import brings an account assignee, resolve that assignment before claiming rather than silently replacing it with a session.

When another session takes over, check the existing claim, update the current assignee, and retain the previous and new session identities, reason, completed work and next steps. Use guarded reassignment when supported and resolve live claims rather than overwriting them. Resuming the same session keeps the same identity. For example, a task can have session B as its current owner, session A as its previous owner, and session C as its independent reviewer.

## Before using sync

Read `docs/agents/beads.md` for the local workspace, shared-worktree behavior, and transient GitHub authentication. Load the official `beads` skill and run `bd prime` when starting or recovering task context.

GitHub pull maps its account assignee, including an empty value, onto the Beads assignee used for session claims. This mapping exists in both checked versions, v1.2.1 and v1.2.2; see the [v1.2.2 GitHub mapping](https://github.com/gastownhall/beads/blob/6c124203e771433a3550c348771a5b5e27fd3c21/internal/github/mapping.go) and [tracker pull updates](https://github.com/gastownhall/beads/blob/6c124203e771433a3550c348771a5b5e27fd3c21/internal/tracker/engine.go). Use initial imports and selective pushes; do not run bidirectional sync or pull over existing tasks, even when every task is approved for publication. This is a repository usage boundary for the current integration, not a custom synchronization tool.

Check `bd version`, `bd github --help`, and `bd github status`. If Beads is not initialized or authentication is unavailable, report the blocker; do not claim synchronization succeeded or initialize infrastructure implicitly.

The intended repository setting is:

```bash
bd config set github.repository jczhang02/pi-stuff
```

Provide credentials through `GITHUB_TOKEN`; never commit credentials. Preview an initial import with `bd github pull <issue-url> --dry-run`. Before the first publication, or after changing its approved scope, run:

```bash
bd github push <bead-id> --dry-run
```

Inspect the proposed changes before proceeding and name only the approved records. Selective push operates on whole records, not individual fields, and does not atomically merge concurrent GitHub edits. Read the current GitHub fields and reconcile changes before publishing. Beads is not inherently private: check database remote access before storing nonpublic information.

`bd sync` synchronizes Beads data; `bd github sync` synchronizes with GitHub. Do not treat them as interchangeable.

## Work cycle

1. At task start or resumption, find the linked records and read their current state. Import only a GitHub issue that has no linked Beads record, before claiming it.
2. Read GitHub discussion with `gh issue view <number> --repo jczhang02/pi-stuff --comments`. Inspect the current title, body, state, labels and assignees too; use `--json title,body,state,labels,assignees` when needed.
3. Reconcile relevant changes through explicit `bd update` or `bd close` operations, preserving the session assignee, metadata, dependencies and handoff history. Summarize new requirements, feedback and decisions with source links. A GitHub account assignment or closed state alone does not authorize session reassignment or establish task acceptance.
4. Before claiming work, check Beads blockers and ownership. Claim using the actual session identity and record execution state, findings and next steps in Beads. Triage labels do not replace execution state.
5. After task-field changes, read the current GitHub fields again, resolve any concurrent edits, then run `bd github push <bead-id>` and verify the result. Publish milestone comments separately as described below.
6. Before ending the session, reconcile new GitHub feedback, publish approved changes and record a Beads handoff with remaining work and pending publication. Avoid repeating unchanged updates.

If both sides have changed, inspect the differences before updating or pushing. Ask the user to resolve ambiguous requirements or acceptance criteria rather than applying whole-record conflict preferences. Keep unresolved changes pending and report them. These explicit reads and updates use existing `gh` and `bd` commands; they do not provide unattended bidirectional synchronization or an atomic cross-tracker transaction.

## Comments and public updates

Before writing or substantively updating GitHub titles, descriptions, comments, or summaries, follow [Contributing: Language and presentation](../../CONTRIBUTING.md#language-and-presentation), including English-only Issue/PR titles, English-first/Chinese-second bodies, and proportionate Markdown. Preserve identifiers and canonical fields when syncing; machine-generated bot metadata and historical discussions do not need bulk translation.

In the checked `bd 1.2.1` integration, `bd github sync` does not synchronize comments. Read GitHub comments explicitly and post public summaries with:

```bash
gh issue comment <number> --repo jczhang02/pi-stuff --body-file <summary-file>
```

Publish a concise comment at these points:

| Event                          | Include                                                           |
| ------------------------------ | ----------------------------------------------------------------- |
| Work begins                    | Scope and next step                                               |
| Blocked or awaiting a decision | Cause, impact, and the specific action needed                     |
| Significant milestone          | Completed work, observed verification results, and remaining work |
| Task completion                | Outcome, actual verification, PR links, and known limitations     |

Keep detailed investigation and execution notes in Beads. Publish useful summaries, not a mirror of every internal note. If nothing substantive changed, do not repeat an update.

After posting, record the GitHub comment URL and a short publication marker in Beads. Before retrying, check GitHub comments for the same update, including when a command failed after the server may have accepted it.

If posting fails, save the intended text and failure reason in Beads, mark it pending, and report the failure to the user. Retry pending updates on resumption. If Beads itself is unavailable, preserve the pending text in the handoff to the user. Task completion and publication completion are distinct: report any outstanding publication.

Remove credentials, personal information, and nonpublic details from public summaries. Use Sepia for both Beads prose and GitHub prose, as required by `AGENTS.md`.

## Issue operations

Use `gh` for GitHub reads, comments, and any direct GitHub edits. Explicitly target this repository when the working directory is ambiguous.

Issues created through the CLI must contain the same information as the matching template and have an explicit triage label; web templates do not enforce CLI submissions. After direct GitHub field changes, read the affected issue and reconcile those changes through explicit Beads updates before further local edits or publication.

Close tasks only when acceptance criteria are met, recording the result in both trackers. Opening a PR is not completion. Use `Closes #<number>` only when merging the PR will satisfy the issue's acceptance criteria; otherwise use `Refs #<number>`. After merge-driven closure, verify the merge and acceptance results, then close the Beads task explicitly without pulling over its session ownership.

## Parent tasks and dependencies

Link children from the parent and link each child back to its parent. Beads holds the execution dependency graph; show collaboration-relevant blockers and links on GitHub. Do not assume native sync preserves every dependency or discussion detail.

For wayfinder, use one map issue labeled `wayfinder:map` and child tickets labeled `wayfinder:<type>` (`research`, `prototype`, `grilling`, or `task`). Use GitHub sub-issues where available; otherwise use a task list in the map and `Part of #<map>` in each child. Show blockers using native GitHub dependencies where available, or a `Blocked by: #<number>` line otherwise. Maintain these links explicitly if sync does not map them.

To find the frontier, inspect the map's open children in map order and check their associated Beads records for open blockers or existing claims. Claim an eligible ticket before execution and reflect the owner on GitHub. On resolution, publish the answer, close the accepted task, and add a summary plus source link to the map's decisions.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Automation boundary

These are agent workflow rules, not a deployed scheduler or comment bridge. No background synchronization is installed by this configuration. Report sync and publication results explicitly rather than promising unattended updates.
