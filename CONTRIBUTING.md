# Contributing

[简体中文](docs/i18n/zh-CN/CONTRIBUTING.md)

## Language and presentation

English is normative. Maintain human documents in English/Chinese pairs in the same PR, with links both ways and the same meaning. Current pairs are:

- `README.md` / `docs/i18n/zh-CN/README.md`.
- `CONTRIBUTING.md` / `docs/i18n/zh-CN/CONTRIBUTING.md`.
- `docs/adr/` / `docs/i18n/zh-CN/adr/`.

Keep Chinese documentation under `docs/i18n/zh-CN/`. Agent instructions and skills stay English-only; do not create Chinese copies of agent rules. Use Chinese in conversation.

Write new or substantively updated human-facing GitHub prose in **English first, Chinese second**. This covers issue and PR descriptions, human-readable titles, comments, review summaries, and future release notes. For long posts, prefer English followed by Chinese within each section. Identifiers, commands, canonical machine field names and status enums, URLs, and hashes need not be translated or duplicated.

Do not bulk-retrofit historical discussions or machine-generated bot metadata. Add translations when substantively editing human content. Historical research does not need mass translation.

Use Markdown to make evidence easy to find:

- Lists for enumerable facts, steps, and acceptance criteria.
- Selective **bold** for labels and verdicts. With Chinese labels, keep punctuation outside the bold span (`**标签**：内容`) or put a space after it (`**标签：** 内容`), so GitHub renders the emphasis.
- Links to evidence and related work.
- Collapsible `<details>` blocks for long logs, with a short result in the body.

Keep short explanations in ordinary prose. Not every sentence needs rich formatting.

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

## Commit conventions

Every new Git commit and PR title must follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/). The PR title becomes the squash commit title. Existing history is not rewritten.

```text
feat(context): add context selection / 添加上下文选择
fix: preserve empty input / 保留空输入
refactor(api)!: remove the obsolete entry point / 移除旧入口
```

Use a type made of lowercase letters, optional nonempty scope in parentheses, optional `!`, then `: ` and a nonblank description. Separate the body and footers from the header with a blank line. Types are not limited to the examples above; merge, revert and fixup messages receive no automatic exemption. The checker validates the header, blank separator and control characters. Body text is free-form: it does not infer footers from lines that could also be prose or examples. Footer syntax, type meaning and breaking-change claims remain author/reviewer obligations.

After the frozen, lifecycle-disabled install below, set up [Husky](https://typicode.github.io/husky/) explicitly:

```bash
git config --show-origin --get core.hooksPath
bun run hooks:install
```

Exit status `1` from the first command means the setting is absent. If it names anything other than this repository's `.husky/_`, stop before installation and resolve the existing-hook setup with the maintainer. Also inspect the directory reported by `git rev-parse --git-path hooks`; active custom hooks need the same discussion even when `core.hooksPath` is unset. Installation changes the clone's Git hook path. Linked worktrees share that setting, but generated hook files are local to each worktree; run setup in each current worktree where commits will be made. Generated `.husky/_` files are not committed. Setup refuses an existing helper directory; inspect it before removing generated helpers for a reinstall. Older worktrees without this setup must not be assumed protected.

The `commit-msg` hook checks the supplied file before Git cleanup. Put the conventional header on its first line; do not rely on Git removing leading comments or blank lines. This conservative local input rule avoids guessing per-command cleanup modes. Check a file directly with `bun run check:commit --message-file <path>`. Hooks are local and bypassable; CI also checks introduced commits and the PR title, including draft PRs. PR checks inspect every commit reachable from head but not base, so a behind-base branch is supported and an invalid middle commit is not hidden. Main pushes inspect the introduced set; an initial push with an all-zero `before` inspects all reachable history. Manual dispatch checks only its selected `GITHUB_SHA`. Missing or shallow history fails rather than skipping validation. Keep the required CI check and use the validated title when squashing. No automatic dependency lifecycle hook is needed for setup.

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

Keep the five exact English H3 headings from [PR evidence](docs/agents/pr-evidence.md#required-sections). For section-by-section translations, put English prose first; a `#### 中文` block can hold the translation inside each section. Do not translate or duplicate the machine headings. Keep declaration keys in English, once each in `Risk and review`; explain them in Chinese without repeating those keys.

Declarations may be plain lines or use optional unordered bullets and bold field labels, such as `- **Risk level:** high`. Status values remain plain canonical enums: `low` or `high`; `completed`, `not-required`, `pending`, or `waived`. This is a limited syntax contract, not arbitrary Markdown parsing: bolded statuses and table declarations are unsupported. Duplicate fields, placeholders, fenced declarations, and incomplete review evidence remain invalid.

For example, the section layout can be:

```markdown
### Verification and reproduction

Not tested: this host cannot run the target terminal; the manual check remains pending.

#### 中文

未测试：此环境无法运行目标终端，手工检查仍待完成。
```

Headings, declaration keys, and enums are a machine contract. Evidence and review conclusions must describe the current change; examples are not reusable claims.

Declare risk and independent-review status. High-risk changes require a separate review context or an explicit maintainer waiver; report scope, findings, fixes, and unresolved concerns. Substantive code changes, including the quality-baseline PR, also require a separate full-diff review using `.agents/skills/thermo-nuclear-code-quality-review/SKILL.md`. That upstream standard is mandatory. The review is read-only; implementation stays with the task owner. Concrete structural findings block by default until fixed or refuted with evidence and independently rechecked; unresolved disagreement goes to the maintainer. Documentation/mechanical changes do not automatically require this specific deep review, but high-risk requirements still apply.

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

Actions use read-only tokens, GitHub-hosted runners, and SHA-pinned external actions. Dependabot checks GitHub Actions and Bun dependencies weekly. Dependency update PRs require checks and the same merge authorization as other changes. Project-owned work is licensed under [MIT](LICENSE); retain all third-party notices. Supported Pi host versions and release policy remain undecided.

## Template sources

The bug report, feature request, and PR templates are adapted from [GitHub CLI](https://github.com/cli/cli):

- [Bug report](https://github.com/cli/cli/blob/trunk/.github/ISSUE_TEMPLATE/bug_report.md)
- [Feature request](https://github.com/cli/cli/blob/trunk/.github/ISSUE_TEMPLATE/submit-a-request.md)
- [Pull request](https://github.com/cli/cli/blob/trunk/.github/PULL_REQUEST_TEMPLATE.md)

Project-specific instructions were replaced with this repository's workflow. The engineering task template is local to this repository. The upstream MIT notice is retained in `.github/TEMPLATE_LICENSE` for the adapted templates; project-owned work is separately covered by the root [MIT license](LICENSE).
