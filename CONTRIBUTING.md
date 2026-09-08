# Contributing

Write repository documents, issues, PRs, and public comments in English.

## Open an issue

This is a single-maintainer project with multiple coding agents. Behavior changes and multi-step work need an issue with acceptance criteria. Typo and formatting fixes may go directly to a PR without a separate issue.

Search existing issues before submitting. Choose the matching template:

- **Bug report:** provide reproduction steps, expected and actual behavior, versions, and relevant output.
- **Feature request:** explain the problem and proposed solution.
- **Engineering task:** define scope and verifiable acceptance criteria.

Blank issues remain available for requests that do not fit a template. CLI-created issues should include the same information as web submissions and an explicit triage label; see `docs/agents/triage-labels.md`.

## Work on a task

Read the issue body, comments, and linked execution records before starting. Check ownership and blockers before claiming work. One task has one execution owner, one short-lived branch, and one worktree under `.worktrees/`. For nontrivial changes, agree on the scope and acceptance criteria first. Keep each change focused.

Commit verified units promptly and push the task branch. Open a PR rather than pushing to `main`. Do not modify another agent's work or remove a worktree containing uncommitted or unpushed changes.

Agents must follow `AGENTS.md`, including its Sepia requirement, and `docs/agents/issue-tracker.md` for Beads, synchronization, and public updates. Other contributors do not need to install Beads.

## Verify changes

The repository checks use Python; this does not select the product's implementation language. The CI Python version is pinned in `.python-version`, and check dependencies are hash-locked in `scripts/requirements.txt`.

Create a virtual environment outside the repository, then run from the repository root:

```bash
python3 -m venv /tmp/pi-stuff-checks
/tmp/pi-stuff-checks/bin/python -m pip install --require-hashes -r scripts/requirements.txt
/tmp/pi-stuff-checks/bin/python -m unittest discover -s scripts -p 'test_*.py'
/tmp/pi-stuff-checks/bin/python scripts/check_repo.py
git diff --check
```

The checker validates tracked text formatting, Markdown file links, YAML/frontmatter, labels, and the CI security baseline. It is not a full Markdown renderer, external-link checker, or GitHub Actions schema validator. Add new files to the index before running it so they are included. Its tests use temporary fixtures outside the repository.

Use any additional checks available for the affected area. For bugs, reproduce the failure and add a regression test when feasible. Report the commands you ran and results you observed. If there is no automated check for the behavior, describe manual verification or state that it was not tested and explain why. Do not invent test commands or results.

Remove credentials and personal information before publishing logs or screenshots.

## Open a pull request

Use `.github/pull_request_template.md`. Link the issue and include a Beads ID when applicable. Explain the change, actual verification, relevant tradeoffs, and known limitations.

Use `Closes #number` only when merging will meet the issue's acceptance criteria. Otherwise use `Refs #number`. Opening a PR does not complete a task. For a trivial fix or an explicitly authorized bootstrap change without an issue, explain that in the PR.

## Merge and handoff

The main-branch ruleset requires a PR, resolved review conversations, and the `checks` CI job on a branch current with `main`. There is no required independent approval in this single-maintainer repository. Use squash merge; merged remote branches are deleted automatically.

Agents need explicit user authorization to merge or release, even if CI passes. Shared GitHub credentials cannot enforce a human-versus-agent distinction, so this is an agent rule rather than a separate GitHub permission boundary. Release automation is not configured.

Before handoff, report acceptance results, actual checks, relevant documentation changes, pushed commit, PR link, and any pending tracker updates. A task may be implemented while awaiting review or merge. Remove local worktrees only after checking for remaining work and preserving anything not published.

## Repository maintenance

The main ruleset is recorded in `.github/rulesets/main.json`; the label manifest is `.github/labels.json`. These files document desired settings and do not apply themselves. Change remote constraints only with the maintainer's authorization, then verify the live settings.

Actions use read-only tokens, GitHub-hosted runners, and SHA-pinned external actions. Dependency update PRs require checks and the same merge authorization as other changes. Product runtime, package manager, license, and release policy remain undecided; do not infer them from the repository-check tooling.

## Template sources

The bug report, feature request, and PR templates are adapted from [GitHub CLI](https://github.com/cli/cli):

- [Bug report](https://github.com/cli/cli/blob/trunk/.github/ISSUE_TEMPLATE/bug_report.md)
- [Feature request](https://github.com/cli/cli/blob/trunk/.github/ISSUE_TEMPLATE/submit-a-request.md)
- [Pull request](https://github.com/cli/cli/blob/trunk/.github/PULL_REQUEST_TEMPLATE.md)

Project-specific instructions were replaced with this repository's workflow. The engineering task template is local to this repository. The upstream MIT notice is retained in `.github/TEMPLATE_LICENSE` for the adapted templates; it does not declare a license for the rest of this repository.
