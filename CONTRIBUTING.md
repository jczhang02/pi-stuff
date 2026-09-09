# Contributing

[简体中文](docs/i18n/zh-CN/CONTRIBUTING.md)

## Language and presentation

English is normative. Maintain documents under `docs/` and the existing root document pairs in English/Chinese in the same PR, with links both ways and the same meaning. Current pairs are:

- `README.md` / `docs/i18n/zh-CN/README.md`.
- `CONTRIBUTING.md` / `docs/i18n/zh-CN/CONTRIBUTING.md`.
- `docs/adr/` / `docs/i18n/zh-CN/adr/`.
- `docs/research/` / [Chinese research references](docs/i18n/zh-CN/research/).
- Root `AGENTS.md` / [Chinese reading reference](docs/i18n/zh-CN/agent-instructions.md).
- `docs/agents/` / [Chinese reading references](docs/i18n/zh-CN/agents/).

Keep Chinese documentation under `docs/i18n/zh-CN/`. Agent-facing instructions and skills stay English-only. Root `AGENTS.md` and every document in `docs/agents/` have human-readable Chinese counterparts, updated in the same PR with reciprocal links; these are not separate agent instruction sources. Use Chinese in conversation.

Use English-only Issue and PR titles. Write new or substantively updated descriptions, comments, review summaries, and future release notes in English first, Chinese second. For long posts, put the translation inside each section. Identifiers, commands, URLs and hashes need not be translated. Do not bulk-rewrite historical discussions or machine-generated metadata. All documents under `docs/` need Chinese counterparts, including research records clearly marked as historical. This translation scope does not extend to `.github/`, `tools/` or `.agents/skills/`; retain their existing bilingual content or upstream originals.

Use lists for enumerable facts, selective bold for important labels, and links for evidence. Put Chinese punctuation outside bold labels (`**标签**：内容`) or add a separating space. Collapse long logs in `<details>` and keep short explanations as ordinary prose.

## Open an issue

This is a single-maintainer project with multiple coding agents. Behavior changes and multi-step work need an issue with acceptance criteria. Typo and formatting fixes may go directly to a PR.

Search existing issues and choose the matching template: bug reports need reproduction, expected/actual behavior and versions; feature requests need a problem and proposal; engineering tasks need scope and verifiable acceptance criteria. Blank issues remain available. CLI-created issues need equivalent information and an explicit [triage label](docs/agents/triage-labels.md).

## Work on a task

Read the issue, discussion and execution context before claiming it. One task has one execution owner, one branch and one worktree under `.worktrees/`. For agent-owned work, identify the actual owner session and retain collaborators and handoffs under [session ownership](docs/agents/issue-tracker.md#session-ownership). Agree on scope and acceptance criteria before nontrivial changes. Preserve other agents' work and unrelated local changes.

Keep each PR focused on one complete outcome with its necessary tests and documentation. Follow [PR scope, dependencies and rollback](docs/agents/workflow.md#pr-scope-dependencies-and-rollback) for prerequisite PRs, merge order and proportionate recovery evidence.

Commit verified units promptly, push the task branch and open a PR rather than pushing to `main`. Agents follow `AGENTS.md`, including Sepia, and the [tracker workflow](docs/agents/issue-tracker.md). Other contributors need not install Beads.

## Commit conventions

Every new commit and PR title follows [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) with the standard [`@commitlint/config-conventional`](https://commitlint.js.org/reference/configuration.html) configuration. The validated PR title is used for squash merge. Do not rewrite existing history.

```text
feat(context): add context selection
fix: preserve empty input
refactor(api)!: remove the obsolete entry point
```

The standard types are `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style` and `test`. Scope is optional. The header limit is 100 characters; descriptions must not end in a period or use the prohibited capitalization styles. Body/footer line limits and blank-line warnings follow the upstream preset. Default ignore exemptions are disabled so version-only or generated messages cannot skip these rules; the preset's rules themselves are unchanged. English-only titles, semantic accuracy and truthful breaking-change claims remain author/reviewer responsibilities.

### Local hooks

After the frozen, lifecycle-disabled install below, inspect the shared and effective Git hook configuration and existing hook files before setup. Stop and ask the maintainer if custom hooks, overrides or unexpected values are present. The official Husky command does not provide our former custom installer's configuration-preservation guarantees.

```bash
git config --show-origin --show-scope --get-all core.hooksPath
git config --local --get-all core.hooksPath
git rev-parse --git-path hooks
bun run hooks:install
```

An absent setting returns status 1. Our expected path is `.husky/_`. Inspect existing helpers before regenerating them; coordinate setup rather than modifying shared configuration concurrently. Linked worktrees share the Git setting but need their own generated helpers. Setup explicitly invokes Husky 9; no `prepare` or dependency lifecycle scripts are used. Generated `.husky/_` stays ignored.

- `pre-commit` runs `bun run check`: formatting, lint and types, without modifying or staging files. Fix failures explicitly and inspect the diff before retrying.
- `commit-msg` runs the installed commitlint CLI on the message file. No custom message parser, history reader or installer remains.

Hooks are local and bypassable. CI checks the PR title separately, including drafts, rather than rechecking every branch commit. Agents still follow the convention for every new commit.

## Verify changes

Use the exact Bun version in `package.json`, currently `1.4.0`. Direct tooling dependencies are pinned and `bun.lock` records the dependency graph. Read the [engineering rules](docs/agents/engineering.md) before changing source, tests, dependencies or checks.

```bash
bun install --frozen-lockfile --ignore-scripts
bun run check
git diff --check
```

`check` runs `format:check`, `lint` and `typecheck`. `bun run format` writes formatting explicitly; hook and CI checks do not. Bun execution does not replace type checking.

The 15 generic anti-slop rules, Effect rule and Oxlint correctness rules remain errors on owned source and tests. Keep strict TypeScript and unused-code checks; no suppressions, weakened settings, type laundering or invented assertions. Oxfmt retains [Google GTS preferences](docs/agents/engineering.md#formatting-and-verification), without GTS, ESLint or Prettier. Do not add Knip, coverage targets, mutation frameworks or competing tooling as ceremony.

Effect `4.0.0-rc.112` remains the selected framework for boundary decoding, typed errors and necessary I/O; pure algorithms remain ordinary functions. RC status alone never justifies rejecting v4, downgrading to v3 or choosing another framework. Specific incompatibilities need reproduction, evidence and a maintainer decision; consult v4 APIs. See [ADR 0001](docs/adr/0001-typescript-bun.md) and [ADR 0002](docs/adr/0002-effect-quality.md).

There are currently no repository-owned automated tests or `test` script. The removed governance programs' six suites are not retained as placeholder tests. Add tests when owned behavior warrants them, including useful bug regressions; report actual commands and limitations. Standard hook wiring gets focused integration verification, not a new suite that retests Husky or commitlint.

Authors and reviewers check affected Markdown links, templates, labels, dependency changes and CI security settings directly. There is no custom repository-policy or PR-body validator. Remove secrets and personal information before publishing evidence.

Use the [quality assurance policy](docs/quality-assurance.md) to select test levels, isolated environments and necessary verification. Its classification and future CI steps are not claims that product tests already exist.

## Open a pull request

Use `.github/pull_request_template.md` and follow [PR evidence](docs/agents/pr-evidence.md). Explain behavior/impact, approach, actual verification, risk/review and related work, with English then Chinese. These are human review requirements, not a Markdown parsing contract. Keep trivial changes brief and report untested behavior rather than inventing results.

High-risk changes require independent review or an explicitly authorized waiver. Substantive code changes require the mandatory upstream `.agents/skills/thermo-nuclear-code-quality-review/SKILL.md` full-diff review in a separate read-only context. The owner implements fixes; concrete findings block until fixed or rebutted with evidence and independently rechecked. Unresolved disagreement goes to the maintainer. Documentation/mechanical changes do not automatically trigger this specific review, but high-risk requirements still apply.

Include actual UI evidence or useful design diagrams when relevant. Refresh affected evidence after material changes. Use `Closes #number` only when merging satisfies acceptance criteria, otherwise `Refs #number`; opening a PR is not task completion.

The separate `title` workflow checks PR titles with the same commitlint configuration as the local hook. Metadata edits rerun that lightweight check, not the code-check workflow. The code workflow runs on PR opens, synchronization, reopening and readiness, main pushes and manual dispatch. After changing a PR's base, synchronize the branch and rerun code CI before merge. PR evidence and review authenticity remain human/agent responsibilities.

## Merge and handoff

Every repository change enters `main` through a PR. The active ruleset has no bypass actors and requires resolved review conversations, linear history and both `checks` and `title` jobs on a branch current with `main`. Both required statuses are bound to GitHub Actions. Do not disable protection to land a change. The maintainer authorized adding the title gate in #21; a passing workflow alone is not a merge requirement without the corresponding ruleset setting. The repository owner can change settings, so these are enforced settings rather than irreversible guarantees.

Use squash merge with the validated PR title; merged remote branches are deleted automatically. Agents need explicit authorization to merge or release even if CI passes. Shared credentials do not distinguish human from agent authorization. Release automation is not configured.

Report acceptance results, actual verification, remaining tests, pushed commit, PR link and pending tracker or remote-setting work. Keep an unmerged task worktree. After authorized merge, verification and handoff, follow [safe cleanup](docs/agents/workflow.md#worktree-cleanup); report retained worktrees and reasons.

## Repository maintenance

`.github/rulesets/main.json` and `.github/labels.json` record settings but do not apply themselves. Remote changes need authorization and live verification. Actions keep read-only tokens, GitHub-hosted runners and SHA-pinned actions; no privileged triggers are introduced. Dependabot checks Actions and Bun dependencies weekly. Updates still need checks and merge authorization.

Project-owned work uses [MIT](LICENSE); retain all third-party notices. The initial extension target is the maintainer's Bun-compiled Pi, under the [runtime policy](docs/agents/engineering.md#pi-and-bun-runtime). Publish supported versions only with actual host acceptance evidence. Release policy remains undecided.

## Template sources

Bug, feature and PR templates are adapted from [GitHub CLI](https://github.com/cli/cli): [bug](https://github.com/cli/cli/blob/trunk/.github/ISSUE_TEMPLATE/bug_report.md), [feature](https://github.com/cli/cli/blob/trunk/.github/ISSUE_TEMPLATE/submit-a-request.md), [PR](https://github.com/cli/cli/blob/trunk/.github/PULL_REQUEST_TEMPLATE.md). Project-specific instructions use this repository's workflow; the task template is local. Retain the upstream MIT notice in `.github/TEMPLATE_LICENSE`, separately from the project's root license.
