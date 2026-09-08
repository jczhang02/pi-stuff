# PR evidence

A PR should let the maintainer judge impact, decisions and evidence before reading the full diff. This applies to code, documentation and configuration. Keep small changes brief; do not invent scenarios or documents to fill a template. Use Sepia and follow [language and presentation](../../CONTRIBUTING.md#language-and-presentation).

## Prepare the review

Compare the complete base-to-head diff against the task's acceptance criteria. Explain what changes and what stays unchanged, relevant tradeoffs, actual verification, risks and unresolved concerns. Link durable decisions rather than duplicating them. Remove sensitive information from evidence and refresh affected claims after material changes.

## Required sections

Use the five sections in `.github/pull_request_template.md` as a human review outline, not a machine-parsed contract:

| Section                       | Content                                                                  |
| ----------------------------- | ------------------------------------------------------------------------ |
| Behavior and impact           | Before/after behavior or workflow, affected users and unchanged scope    |
| Approach and decisions        | Solution, relevant tradeoffs and useful decision links                   |
| Verification and reproduction | Actual commands, prerequisites, observed results and verification limits |
| Risk and review               | Risk, independent-review status, findings and disposition                |
| Related work                  | Issue and Beads links, or a justified trivial/bootstrap exception        |

Write English first, then Chinese inside each section. Use ordinary Markdown that makes the evidence readable; there is no supported-markup subset or placeholder parser. An empty template is not evidence. Explain missing verification plainly rather than converting it into a success claim.

Declare low/high risk and whether independent review is completed, not required, pending or explicitly waived. Give the reviewer/tool identity, base/head scope, findings and resolution, or the applicable exemption. A waiver needs a link to explicit maintainer authorization. Never copy another PR's completed-review claim.

High-risk PRs need completed independent review or explicit waiver before becoming ready. Keep a PR draft while review is pending; report a missing reviewer as a blocker.

## Evidence by change type

- For bugs, report reproduction, versions/input, observed failure and relevant verification. Add useful regression coverage when feasible; disclose limits.
- For visible UI or terminal changes, provide actual screenshots or recordings. Mockups are design evidence, not proof of execution.
- For consequential architecture/state/dependency/concurrency changes, link decisions and use a diagram when it helps explain the change.
- For hard-to-navigate cross-module changes, provide a short review map or visual artifact with links to actual code.
- Security, permissions, persistence/recovery, concurrency/cancellation, public API, dependencies, CI/merge policy and broad refactors are high risk and need independent review.
- Trivial documentation/formatting changes normally need only a brief impact statement and actual checks.

If evidence is unavailable, state what remains unverified. Escalate consequential uncertainty. Link stable CI/artifacts or collapse long logs; local `/tmp/` paths are not public evidence.

## TDD claims

Claim TDD only when the relevant test was observed failing before implementation and passing afterward. Report the same command and base/fix context. Harness/import failures alone are not a behavior reproduction. Tests written after implementation are not TDD. Do not add placeholder tests or fabricate red logs to satisfy prose.

## Independent review

Use a separate read-only context with the pinned comparison range and originating issue/spec. Review both repository standards and requirement coverage across the full diff. One suitable context is sufficient; every available model is not required. The execution owner implements fixes.

For substantive code changes, the reviewer must load `.agents/skills/thermo-nuclear-code-quality-review/SKILL.md` and apply its full mandatory upstream standard. Documentation/mechanical changes do not automatically trigger that specific deep review; high-risk review still applies. If the required skill or reviewer is unavailable, report the blocker and keep review pending.

Concrete structural findings block until fixed or rebutted with evidence and independently rechecked. Record the disposition; passing tests alone is not a rebuttal. Escalate unresolved disagreements to the maintainer. Obtain a focused follow-up when fixes materially change reviewed behavior, not merely to repeat unchanged verification.

Publish reviewer/tool identity, base/head references, findings, fixes and outstanding concerns. An agent review is neither GitHub approval nor merge authorization.

## Publication and enforcement

GitHub holds requirements and selected evidence; Beads holds execution context and links; ADRs hold lasting decisions. Follow the [tracker workflow](issue-tracker.md), publishing meaningful milestones rather than mirroring every internal note.

PR-body structure, risk classification, review authenticity and authorization are author/reviewer obligations, not programmatically validated. Independent title CI uses commitlint; metadata edits do not rerun the code-check workflow. A workflow's presence does not make it a required merge check; remote ruleset changes require explicit authorization. After a base change, synchronize and rerun code CI before merging.

Every change entering main goes through a PR. Task branches remain pushable. Never weaken the main ruleset to land a change. Merge and release each require explicit user authorization. Local Beads and remote settings are outside Git commits, but their changes still follow the authorization boundary.
