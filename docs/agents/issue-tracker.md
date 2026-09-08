# Issue tracker: GitHub + Beads

[Chinese reading reference](../i18n/zh-CN/agents/issue-tracker.md). English is authoritative; the translation is for human readers.

Repository: `jczhang02/pi-stuff`.

GitHub Issues holds requirements, acceptance criteria, public progress, decisions, and PR links. Beads holds agent execution context: investigation notes, dependencies, blockers, and handoffs. Retain enough context in Beads for another agent to resume work.

## Linked tasks

Behavior changes and multi-step work need a tracked task. Typo and formatting fixes may go directly to a PR without a separate issue or Beads record. Explicitly authorized repository bootstrap work may also proceed without Beads while initialization is pending; disclose this in the PR.

Before creating a task, search both trackers for an existing record. Use one linked GitHub issue and Beads record for the same task; do not independently create duplicates with `gh issue create` and `bd create`.

For an existing GitHub issue, pull it into Beads. For a new Beads task intended for publication, push it to GitHub and verify its external reference. Record the association in Beads and include the Beads ID in the initial GitHub progress comment when available.

When a skill says "publish to the issue tracker," publish a GitHub issue and establish its Beads association. When it says "fetch the relevant ticket," read the GitHub body, labels, comments, and associated Beads context.

## Before using sync

Read `docs/agents/beads.md` for the local workspace, shared-worktree behavior, and transient GitHub authentication. Load the official `beads` skill and run `bd prime` when starting or recovering task context.

Check `bd version`, `bd github --help`, and `bd github status`. If Beads is not initialized or authentication is unavailable, report the blocker; do not claim synchronization succeeded or initialize infrastructure implicitly.

The intended repository setting is:

```bash
bd config set github.repository jczhang02/pi-stuff
```

Provide credentials through `GITHUB_TOKEN`; never commit credentials. Before the first sync, or after changing its scope, run:

```bash
bd github sync --dry-run
```

Inspect the proposed changes before proceeding. Full bidirectional sync can publish local tasks. If some records must remain unpublished, use selective operations supported by the installed CLI instead of full sync. Beads is not inherently private: check database remote access before storing nonpublic information.

`bd sync` synchronizes Beads data; `bd github sync` synchronizes with GitHub. Do not treat them as interchangeable.

## Work cycle

1. At task start or resumption, synchronize the approved scope. For a workspace whose full contents are approved for publication, run `bd github sync`.
2. Read GitHub discussion separately with `gh issue view <number> --repo jczhang02/pi-stuff --comments`. Check the current labels as well.
3. Summarize new requirements, feedback, and decisions in Beads, preserving source links. Avoid copying the same feedback again on each session.
4. Before claiming work, check Beads blockers and ownership. Record the claim, execution state, findings, and next steps in Beads. Triage labels do not replace execution state.
5. After task-field changes, run `bd github push <bead-id>` and verify the result. Publish milestone comments separately as described below.
6. Before ending the session, synchronize the approved scope again and record a Beads handoff with remaining work and pending publication.

The CLI defaults to preferring the newer version on conflicts; this is not a substitute for reviewing concurrent edits. If both sides have changed, inspect the differences before syncing. Ask the user to resolve ambiguous requirements or acceptance criteria rather than blindly applying `--prefer-local` or `--prefer-github`.

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

Issues created through the CLI must contain the same information as the matching template and have an explicit triage label; web templates do not enforce CLI submissions. After direct GitHub field changes, pull the affected task into Beads before resuming local edits.

Close tasks only when acceptance criteria are met, recording the result in both trackers. Opening a PR is not completion. Use `Closes #<number>` only when merging the PR will satisfy the issue's acceptance criteria; otherwise use `Refs #<number>`. After merge-driven closure, reconcile the Beads state on the next sync.

## Parent tasks and dependencies

Link children from the parent and link each child back to its parent. Beads holds the execution dependency graph; show collaboration-relevant blockers and links on GitHub. Do not assume native sync preserves every dependency or discussion detail.

For wayfinder, use one map issue labeled `wayfinder:map` and child tickets labeled `wayfinder:<type>` (`research`, `prototype`, `grilling`, or `task`). Use GitHub sub-issues where available; otherwise use a task list in the map and `Part of #<map>` in each child. Show blockers using native GitHub dependencies where available, or a `Blocked by: #<number>` line otherwise. Maintain these links explicitly if sync does not map them.

To find the frontier, inspect the map's open children in map order and check their associated Beads records for open blockers or existing claims. Claim an eligible ticket before execution and reflect the owner on GitHub. On resolution, publish the answer, close the accepted task, and add a summary plus source link to the map's decisions.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Automation boundary

These are agent workflow rules, not a deployed scheduler or comment bridge. No background synchronization is installed by this configuration. Report sync and publication results explicitly rather than promising unattended updates.
