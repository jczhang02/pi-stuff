# Contributing

Write repository documents, issues, PRs, and public comments in English.

## Open an issue

Search existing issues before submitting. Choose the matching template:

- **Bug report:** provide reproduction steps, expected and actual behavior, versions, and relevant output.
- **Feature request:** explain the problem and proposed solution.
- **Engineering task:** define scope and verifiable acceptance criteria.

Blank issues remain available for requests that do not fit a template. CLI-created issues should include the same information as web submissions and an explicit triage label; see `docs/agents/triage-labels.md`.

## Work on a task

Read the issue body, comments, and linked execution records before starting. Check ownership and blockers before claiming work. For nontrivial changes, agree on the scope in the issue first. Keep each change focused.

Agents must follow `AGENTS.md`, including its Sepia requirement, and `docs/agents/issue-tracker.md` for Beads, synchronization, and public updates. Other contributors do not need to install Beads.

## Verify changes

Use the checks actually available in the repository for the affected area. Report the commands you ran and results you observed. If there is no automated check for the behavior, describe the manual verification or state that it was not tested and explain why. Do not invent test commands or results.

Remove credentials and personal information before publishing logs or screenshots.

## Open a pull request

Use `.github/pull_request_template.md`. Link the issue and include a Beads ID when applicable. Explain the change, actual verification, relevant tradeoffs, and known limitations.

Use `Closes #number` only when merging will meet the issue's acceptance criteria. Otherwise use `Refs #number`. Opening a PR does not complete a task.

## Template sources

The bug report, feature request, and PR templates are adapted from [GitHub CLI](https://github.com/cli/cli):

- [Bug report](https://github.com/cli/cli/blob/trunk/.github/ISSUE_TEMPLATE/bug_report.md)
- [Feature request](https://github.com/cli/cli/blob/trunk/.github/ISSUE_TEMPLATE/submit-a-request.md)
- [Pull request](https://github.com/cli/cli/blob/trunk/.github/PULL_REQUEST_TEMPLATE.md)

Project-specific instructions were replaced with this repository's workflow. The engineering task template is local to this repository. The upstream MIT notice is retained in `.github/TEMPLATE_LICENSE` for the adapted templates; it does not declare a license for the rest of this repository.
