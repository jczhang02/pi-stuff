# Contributing

[简体中文](docs/zh-CN/CONTRIBUTING.md)

English is normative. Maintain paired human documents in the same PR: `README.md` / `README.zh-CN.md`, this guide / `docs/zh-CN/CONTRIBUTING.md`, and `docs/adr/` / `docs/zh-CN/adr/`. Cross-link counterparts and preserve their meaning. Agent instructions and skills stay English-only; do not create Chinese copies of agent rules. Historical research does not need mass translation. Write issues, PRs, and public comments in English; use Chinese in conversation.

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

Pi Stuff uses TypeScript and Bun, including for repository checks; see the [toolchain decision](docs/adr/0001-typescript-bun.md) and [Effect/quality decision](docs/adr/0002-effect-quality.md). Install the exact Bun version in `package.json` (`packageManager` and `engines.bun`), unchanged at `1.4.0`; CI reads that file too. Direct tooling dependencies are pinned; `bun.lock` records the resolved dependency graph and integrity hashes.

Read the [engineering rules](docs/agents/engineering.md) before changing source, tests, dependencies, or checks. All owned source and tests require the 15 generic anti-slop rules plus the Effect rule and Oxlint correctness rules at error severity, without suppressions, weaker settings, inferred type laundering, or invented safety assertions. Use strict TypeScript and unused-code checking. Reproduce real rule conflicts and raise them rather than bypassing enforcement.

Effect `4.0.0-rc.112` is the chosen framework for boundary decoding, typed errors, and necessary I/O orchestration, including repository scripts; pure algorithms remain ordinary functions. RC status alone must never justify rejecting v4, downgrading to v3, or choosing another framework. Specific incompatibilities need an actual reproduction, evidence, and a maintainer decision. Use v4 documentation rather than assumed v3 APIs.

From the repository root, run:

```bash
bun install --frozen-lockfile --ignore-scripts
bun run check
git diff --check
```

`bun run check` runs `format:check`, `lint`, `typecheck`, `test`, and `check:repo`. Type checking is separate because Bun runs TypeScript without checking types. Installation disables dependency lifecycle scripts; no tooling dependency needs them.

| Command                                            | Purpose                                            |
| -------------------------------------------------- | -------------------------------------------------- |
| `bun run format`                                   | Write formatting locally with Oxfmt                |
| `bun run format:check`                             | Check formatting without writes; used by CI        |
| `bun run lint`                                     | Run Oxlint correctness and strict anti-slop checks |
| `bun run typecheck`                                | Run strict TypeScript and unused-code checks       |
| `bun run test`                                     | Run regression tests and enforcement probes        |
| `bun run check:repo`                               | Check repository conventions and safety baseline   |
| `bun run check:pr --body-file /path/to/pr-body.md` | Check PR evidence structure                        |

Oxfmt uses Google GTS preferences with [explicit settings and a pinned upstream source](docs/agents/engineering.md#formatting-and-verification), not a GTS/ESLint/Prettier installation. CI checks formatting only; run the writing command locally. Do not add Knip, a hard coverage target, a full mutation framework, or competing lint/format tools to this baseline. Keep existing regression scenarios and observable script behavior; do not freeze the test count.

To check a PR description before publishing it, run `bun run check:pr --body-file /path/to/pr-body.md`. The file is read as text, not executed. CI runs this check separately against the pull-request event.

The repository checker validates tracked text formatting, Markdown file links, YAML/frontmatter, labels, and the CI security baseline. It is not a full Markdown renderer, external-link checker, or GitHub Actions schema validator. Add new files to the index before running it so they are included. Its tests use temporary fixtures outside the repository.

Use any additional checks available for the affected area. For bugs, reproduce the failure and add a regression test when feasible. Report the commands you ran and results you observed. If there is no automated check for the behavior, describe manual verification or state that it was not tested and explain why. Do not invent test commands or results.

Remove credentials and personal information before publishing logs or screenshots.

## Open a pull request

Read [PR evidence](docs/agents/pr-evidence.md) and use `.github/pull_request_template.md`. Start with before/after behavior or workflow, then explain the approach and important decisions. Put reproduction steps, actual commands, observed results, and evidence together so the maintainer can repeat the verification.

Declare risk and independent-review status. High-risk changes require a separate review context or an explicit maintainer waiver; report scope, findings, fixes, and unresolved concerns. Substantive code changes, including the quality-baseline PR, also require a separate full-diff review using `.pi/skills/thermo-nuclear-code-quality-review/SKILL.md`. That upstream standard is mandatory. The review is read-only; implementation stays with the task owner. Concrete structural findings block by default until fixed or refuted with evidence and independently rechecked; unresolved disagreement goes to the maintainer. Documentation/mechanical changes do not automatically require this specific deep review, but high-risk requirements still apply.

Include actual screenshots/recordings for visible UI changes and diagrams/design decisions when relevant. Disclose unavailable evidence. Keep trivial changes brief.

CI checks the description structure and risk/review declarations when the PR is opened, edited, updated, reopened, marked ready, or converted to draft. Drafts can retain incomplete evidence. The check never executes PR text, but it also cannot prove the truth of a test, screenshot, risk assessment, or waiver. Update the description and affected evidence after material changes.

Use `Closes #number` only when merging will meet the issue's acceptance criteria. Otherwise use `Refs #number`. Opening a PR does not complete a task. For a trivial fix or an explicitly authorized bootstrap change without an issue, explain that in the PR.

## Merge and handoff

Every change entering `main`, including documentation, templates, and CI configuration, must go through a PR. Task branches remain pushable. Local Beads data and remote GitHub settings are not Git commits; remote-setting changes still require authorization.

The active main ruleset has no bypass actors. Do not disable it to push or merge. The repository owner can administratively change the rule, so protection is a current enforced setting, not an irreversible restriction.

The main-branch ruleset requires a PR, resolved review conversations, and the `checks` CI job on a branch current with `main`. There is no required independent approval in this single-maintainer repository. Use squash merge; merged remote branches are deleted automatically.

Agents need explicit user authorization to merge or release, even if CI passes. Shared GitHub credentials cannot enforce a human-versus-agent distinction, so this is an agent rule rather than a separate GitHub permission boundary. Release automation is not configured.

Before handoff, report acceptance results, actual checks, relevant documentation changes, pushed commit, PR link, and any pending tracker updates. A task may be implemented while awaiting review or merge. Follow the [worktree cleanup rules](docs/agents/workflow.md#worktree-cleanup) after merge verification and handoff; report any retained task worktree and the reason.

## Repository maintenance

The main ruleset is recorded in `.github/rulesets/main.json`; the label manifest is `.github/labels.json`. These files document desired settings and do not apply themselves. Change remote constraints only with the maintainer's authorization, then verify the live settings.

Actions use read-only tokens, GitHub-hosted runners, and SHA-pinned external actions. Dependabot checks GitHub Actions and Bun dependencies weekly. Dependency update PRs require checks and the same merge authorization as other changes. The project license, supported Pi host versions, and release policy remain undecided.

## Template sources

The bug report, feature request, and PR templates are adapted from [GitHub CLI](https://github.com/cli/cli):

- [Bug report](https://github.com/cli/cli/blob/trunk/.github/ISSUE_TEMPLATE/bug_report.md)
- [Feature request](https://github.com/cli/cli/blob/trunk/.github/ISSUE_TEMPLATE/submit-a-request.md)
- [Pull request](https://github.com/cli/cli/blob/trunk/.github/PULL_REQUEST_TEMPLATE.md)

Project-specific instructions were replaced with this repository's workflow. The engineering task template is local to this repository. The upstream MIT notice is retained in `.github/TEMPLATE_LICENSE` for the adapted templates; it does not declare a license for the rest of this repository.
