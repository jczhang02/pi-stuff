# Beads setup

[Chinese reading reference](../i18n/zh-CN/agents/beads.md). English is authoritative; the translation is for human readers.

## Local workspace

This clone uses Beads v1.2.1 with embedded Dolt. The workspace is `.beads/` in the main checkout; `bd where` reports the actual database path. No external SQL server is required.

The [official v1.2.2 recovery release](https://github.com/gastownhall/beads/releases/tag/v1.2.2) supersedes the accidentally published v1.2.1. Host recovery is pending. Follow the [official recovery guide](https://github.com/gastownhall/beads/blob/v1.2.2/docs/RECOVERY-1.2.1.md) in a separately authorized host-recovery task; these notes describe the current installation. Choose a tested official release for new setup and verify its CLI options. The GitHub ownership limitation and approved workflow are in [issue tracking](issue-tracker.md#before-using-sync); upgrading alone does not remove that limitation.

Worktrees discover the same workspace through Git's common directory. Run `bd where` from each worktree to confirm this before writing tasks. Do not initialize a separate database in each worktree or copy live database files between them.

Use the actual session identity for `bd --actor` when claiming and updating work, following [session ownership](issue-tracker.md#session-ownership). The assignee records the current execution-owner session; the actor records who performed an operation. Handle claim failures rather than overwriting another session's assignment. In `bd 1.2.1`, `bd update --session` is a Claude Code closure field, not a general owner-session field.

Database files and local configuration stay out of Git. The current settings are:

| Setting             | Value                | Reason                                          |
| ------------------- | -------------------- | ----------------------------------------------- |
| Issue prefix        | `pi-stuff`           | Stable task identifiers                         |
| `github.repository` | `jczhang02/pi-stuff` | Public collaboration target                     |
| `dolt.local-only`   | `true`               | No full-database remote publication             |
| `backup.enabled`    | `false`              | The maintainer declined backup setup            |
| `export.auto`       | `false`              | No automatic JSONL export                       |
| `no-git-ops`        | `true`               | Beads does not own the source-code Git workflow |

There is no Dolt remote or configured backup. GitHub issue synchronization does not preserve internal comments, the dependency graph, or complete database history. The maintainer declined backup setup; it is not a prerequisite to repository work.

The `no-git-ops` setting affects generated Beads guidance. It does not cancel the commit/push requirements in `AGENTS.md`. Do not run broad `bd doctor --fix`, destructive reinitialization, or automatic editor setup to remove intentional differences from upstream defaults.

## Skill and session context

The official minimal skill is installed on the development host at `~/.agents/skills/beads/SKILL.md`, with its MIT license and source record. It is copied without changes from [Beads v1.2.1](https://github.com/gastownhall/beads/blob/634cbbc4bc580fa5124f63fdf65d137a46d5b4ff/internal/templates/skills/beads/SKILL.md).

This is a host installation, not a vendored repository dependency. Install the same reviewed skill on another host before using it there. Pi discovers `~/.agents/skills/`; use `/reload` or restart the session after installation. Other harnesses may use different discovery paths.

Load the skill and run `bd prime` at task start, resumption, or after compaction. No Beads Git hooks or editor session hooks were installed. In Pi, run `bd prime` explicitly rather than assuming automatic injection. Keep repository-specific publication and writing rules in `AGENTS.md` and `issue-tracker.md`, not in the upstream skill.

## Initialization on a new clone

First run `bd where` and check for an existing workspace. Only initialize when none exists and the user has authorized setup. If `.beads/` already contains data or configuration, inspect it rather than overwriting it.

For a new, empty workspace, create `.beads/config.yaml` with:

```yaml
dolt.local-only: true
backup.enabled: false
export.auto: false
no-git-ops: true
```

Then run from the main checkout:

```bash
bd init --prefix pi-stuff --role maintainer --non-interactive --stealth --skip-hooks --skip-agents
bd config set github.repository jczhang02/pi-stuff
bd where
bd info --json
```

`--stealth` keeps the database local through `.git/info/exclude` and avoids init's automatic source-code commit. The skip flags preserve the repository's agent instructions and existing hooks. This mode does not prevent explicit GitHub issue publication.

## GitHub authentication and preview

The integration uses `GITHUB_TOKEN`. On this host, an existing authenticated `gh` session can provide it to a single command without saving another token:

```bash
GITHUB_TOKEN="$(gh auth token)" bd github push <bead-id> --dry-run
```

Do not print or persist the token. If authentication fails, report it and request setup rather than storing credentials in repository files. Run the dry-run first and publish only approved records. Follow `issue-tracker.md` for initial imports, explicit reconciliation, selective pushes and separate comment publication.

## Verification

After setup, compare `bd where` and `bd info --json` from the main checkout and a worktree. Check `bd ready --json`, `bd doctor --check=conventions`, and `bd doctor --check=artifacts`. These checks work in embedded mode; the full doctor suite in v1.2.1 requires server mode.

Use a disposable workspace for synthetic test issues. Do not pollute the project database or GitHub with test tasks merely to check command availability.
