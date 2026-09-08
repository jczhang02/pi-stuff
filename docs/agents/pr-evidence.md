# PR evidence

A PR should let the maintainer judge impact, decisions, and evidence before reading the full diff. This policy applies to code, documentation, and configuration changes. Keep typo and formatting PRs short; they do not need invented user scenarios or design documents.

## Prepare the review

1. Read the task's acceptance criteria and compare the complete PR diff against its base, not only the last commit.
2. Describe the affected user path before and after the change. For internal or documentation changes, describe the interface or workflow effect instead. State what remains unchanged.
3. Explain the approach and important tradeoffs. Link durable architectural decisions rather than duplicating them. Record material rejected alternatives and their consequences, not every implementation detail.
4. Put each reproduction or failure next to its verification command, observed result, and evidence. Provide prerequisites and expected results so the maintainer can repeat the check.
5. Assess risk, obtain independent review when required below, and publish the evidence using the PR template. Recheck the final diff and refresh affected evidence after material edits.

Use Sepia for the prose, including Beads notes. Preserve commands, error output, and measured results exactly. Remove credentials and personal information from logs and images.

## Required sections

Every non-draft PR description must use these exact level-three headings. CI checks structure, not the truth of the claims.

| Heading                         | Required content                                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `Behavior and impact`           | Before/after behavior or workflow, affected users/interfaces, and unchanged scope                                 |
| `Approach and decisions`        | Solution, relevant tradeoffs, and links to decisions when needed                                                  |
| `Verification and reproduction` | Actual commands or steps, prerequisites, observed and expected results, and evidence; explain anything not tested |
| `Risk and review`               | Risk level, known limitations, applicable supporting material, and review status/results                          |
| `Related work`                  | GitHub issue and Beads ID, or a reason the trivial/bootstrap change has no task                                   |

Template comments and bare `N/A`, `TODO`, or `TBD` do not count as content. A justified limitation does: for example, `Not tested: this host cannot run the target terminal; the manual check remains pending.` Missing verification is visible, not silently converted into success.

In `Risk and review`, include these fields:

- `Risk level: low` or `Risk level: high`.
- `Independent review: completed`, `not-required`, `pending`, or `waived`.
- `Review evidence:` followed by scope, reviewer/tool identity, findings and resolution, or the reason no independent review is required. A waiver must reference explicit maintainer authorization.

### Formatting and language

The five section headings, three English declaration keys, and enum spellings are the machine contract. The values and prose are not fixed boilerplate: choose the actual risk and review status, and report the current reviewers, commit range, findings, links and limits. Never copy another PR's `completed` claim. Include unresolved licensing or out-of-scope work only when relevant to this PR.

Declarations must start in column one, either as plain lines or top-level unordered list items (`-`, `*`, or `+`). Their labels can be bold, with the colon inside or outside the bold span: `- **Risk level:** high` and `- **Risk level**: high` both work. Keep status values plain (`high`, not `**high**` or `high / 高`). Tables, quoted declarations, nested declaration items and translated machine keys are not supported. Mixed styles still count toward the same exactly-one-field requirement; fenced examples and HTML comments do not count. Basic emphasis or backticks do not make a bare placeholder substantive.

For long bilingual PRs, put English first and a `#### 中文` block after it inside each required section. Keep the English H3 headings unchanged and do not repeat the English declaration keys in the Chinese block. The Chinese text must preserve the same facts, qualifications and limitations. Language order and translation fidelity remain author/reviewer obligations, not claims proved by this structural checker. Follow [Contributing](../../CONTRIBUTING.md#language-and-presentation) for proportionate Markdown presentation.

A draft can explain its pending review with a list; this is not ready-state evidence:

```markdown
- **Risk level:** high
- **Independent review:** pending
- **Review evidence:**
  - Independent review has not completed; keep the PR draft.
```

High-risk PRs require a completed independent review or an explicitly authorized waiver before becoming ready for merge. If no reviewer is available, keep the PR draft, use `pending`, and report the blocker. Do not invent a reviewer or report this session's self-check as independent review.

## Evidence by change type

| Change                                                                                                                                    | Evidence to include                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Bug fix                                                                                                                                   | Reproduction with versions/input, observed failure, regression-test command and result; disclose inability to reproduce                |
| Visible UI or terminal behavior                                                                                                           | Actual before/after screenshots or recording, reproduction steps, and environment; mockups are design evidence, not proof of execution |
| Architecture, state, dependency, or concurrency changes                                                                                   | A focused Mermaid diagram when it clarifies the change; link a design document or ADR for consequential decisions                      |
| Cross-module diff that is difficult to navigate                                                                                           | A short review map or `/show-me` artifact where available; always retain links to the real diff                                        |
| Security, permissions, persistence/recovery, concurrency/cancellation, public API, dependency, CI/merge-policy, or broad refactor changes | High risk: independent review with a pinned base/head scope and a findings disposition                                                 |
| Trivial documentation or formatting                                                                                                       | Brief impact and actual checks; diagrams, recordings, and independent review are normally unnecessary                                  |

When applicable evidence cannot be produced, explain why and what remains unverified in the relevant section. For consequential uncertainty, ask the maintainer before proceeding. Keep logs concise in the body; link stable CI runs/artifacts or use collapsed details for full output. Local `/tmp/` paths are not publicly accessible evidence.

## TDD claims

Claim TDD only if a relevant test was observed failing before the implementation and then passing after it. Include the same test command, base/fix references where available, and red/green results together. An import error or broken test harness alone is not evidence that the intended behavior failed.

If tests were written after implementation, say so. A green test suite demonstrates its observed result, not the order in which code was written. Never fabricate red logs to satisfy the template.

## Independent review

Use a separate review context with the pinned comparison range and the issue/spec. Review both repository standards and requirement coverage across the complete base-to-head diff, not only the latest commit. The `code-review` skill or a harness's review mode may provide the context; using every available model is not required.

For substantive code changes, including the quality-baseline PR, the reviewer must load `.agents/skills/thermo-nuclear-code-quality-review/SKILL.md` and apply its full upstream standard. It is mandatory, not optional guidance or a substitute for requirement coverage. The review is read-only: the reviewer reports findings and the task owner implements fixes. Documentation-only and mechanical changes do not automatically trigger this specific deep review; high-risk review requirements still apply.

Concrete structural findings are presumptive blockers until fixed or refuted with evidence and independently rechecked. Record the evidence and recheck outcome for each such finding; passing tests alone is not a refutation. Escalate unresolved disagreement to the maintainer rather than silently downgrading a finding. If the required skill or reviewer is unavailable, report the blocker and keep review pending.

Record reviewer/tool identity, base/head references, findings, changes made in response, and outstanding concerns. Resolve blocking findings before handoff, or mark them pending and request a decision. If fixes materially change the reviewed behavior, obtain a follow-up review of those fixes. An independent agent review is not a GitHub approving review or permission to merge.

## Publication and enforcement

Beads retains execution detail and the handoff; the PR contains the selected evidence; ADRs retain long-lived decisions. Post meaningful progress and completion summaries using the tracker workflow.

CI reads the PR event JSON as data and validates the five sections plus risk/review declarations. Body edits and readiness changes rerun CI. Drafts may contain incomplete evidence; they cannot merge. CI validates the triggering event's snapshot; it is not an atomic guarantee about the body at merge time. The workflow and checker are also editable in a PR, so they are not an independent security boundary. CI cannot prove a screenshot is authentic, a test was run first, a waiver was authorized, or the risk classification is correct. These remain agent obligations and maintainer judgments.

All changes entering `main`, including documentation and CI configuration, go through a PR. Task branches can be pushed normally. Local Beads state and GitHub settings are outside the Git merge workflow; changing remote settings still requires explicit authorization. Never weaken the main ruleset to land a change.
