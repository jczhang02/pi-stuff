# Issue tracker: Beads with GitHub intake and mirror

Beads is the canonical issue tracker for this repository. GitHub Issues is a public push-only mirror for accepted work and an intake surface for external reports.

All accepted-work creation, updates, dependencies, claiming, and closure begin in Beads. Do not edit a mirrored GitHub issue as the authoritative copy.

## Local operations

- Create: `bd create`
- Read: `bd show <id>`
- List: `bd list`
- Find ready work: `bd ready`
- Claim: `bd update <id> --claim`
- Update: `bd update <id> ...`
- Close: `bd close <id> --reason "..."`
- Add a blocker: `bd dep add <blocked-id> <blocker-id>`
- Inspect dependencies: `bd dep tree <id>` or `bd graph`

Issue IDs use the `ps` prefix.

## Local storage

The local Dolt database is authoritative for Beads commands. The entire `.beads/` workspace is local-only and excluded from Git.

The publish command may refresh a scrubbed local `.beads/issues.jsonl` after syncing accepted work to GitHub Issues. That export is not version-controlled or a full Dolt backup. Beads must not stage, commit, push, or otherwise operate Git, and repository Git hooks are not installed by Beads.

## GitHub mirror

Publish Beads issues explicitly with:

```bash
bun run beads:publish -- <epic-or-bead-id>
```

The command previews and then performs a push-only GitHub sync. It obtains authentication at runtime and never persists a token.

Do not run general bidirectional sync or pull GitHub changes into Beads. Parent and blocker edges remain canonical in Beads and are not guaranteed to appear in GitHub's issue UI.

## External intake

Bug and feature forms create GitHub intake issues. Triage them on GitHub. When an issue is accepted, a maintainer may perform one targeted adoption:

```bash
bd github pull gh-<number>
```

After adoption, update it in Beads and use push-only sync. This one-time intake operation is the only routine exception to the no-pull rule.

## Skill operations

When a skill says "publish to the issue tracker":

1. Create or update the Beads issue.
2. Add its parent and blocker relationships in Beads.
3. Explicitly publish the relevant issue or epic subtree.
4. Return both the Beads ID and GitHub URL when available.

When a skill says "fetch the relevant ticket", use `bd show <id>`. Treat its GitHub issue as a public mirror.

## Work maps

- A map is a Beads epic.
- Child tickets use the epic as their parent.
- Blocking relationships use Beads dependency edges.
- `bd ready --parent <epic-id>` identifies the executable frontier.
- Claim a ticket before implementation.
- Close it only after its acceptance criteria have been verified.
- Publish the epic subtree to refresh GitHub state.

## Pull requests as a triage surface

PRs are for delivering and reviewing code, not for requesting work or defining its authoritative scope. External
contributors may submit a PR, but a maintainer must adopt accepted scope into Beads before implementation is treated
as repository work. Review comments may refine the patch; Beads retains work-item status, dependencies, and closure.

## Public-data policy

The repository, JSONL export, and GitHub Issues are public. Never put credentials, private paths, private data, unpublished personal information, or sensitive operational details in Beads fields or GitHub issues.
