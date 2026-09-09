# Quality assurance

[简体中文](i18n/zh-CN/quality-assurance.md) · English is normative.

This reference defines evidence for changes to Pi Stuff. It is a risk-proportionate decision guide, not a quota: a change does not need work at every level or a new job merely to fill the taxonomy. State the behavior and acceptance promise briefly, reuse evidence already valid for the same revision, and add tests only for important uncovered behavior or regressions. Do not add placeholders, coverage targets, tests that mirror implementation, ceremonial tooling, or the retired governance suites.

## Four QA activities

Use the activity that answers the question a change raises:

| Activity      | Evidence it provides                                                                                                                                       | Default use                                                                                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Static Checks | Source and configuration are checked against the applicable syntax, type, lint and format rules without running the product behavior.                      | Run `bun run check` on every PR. Add a pinned `actionlint` step to the existing `checks` job when implementing the product test suite and its CI; it is deferred from this baseline. |
| Tests         | A behavior at a defined boundary produces the required result, including failure, cancellation, recovery, cleanup, and input/data handling where relevant. | Run the applicable offline suite on a PR; run the full applicable offline suite when shared infrastructure, a Pi upgrade, or unclear impact makes the wider surface relevant.        |
| Benchmarks    | A measured comparison of task outcomes, time or resource use under a named environment and workload.                                                       | Run independently on demand. It is not a routine merge gate. An explicit product performance requirement is a Test and may block acceptance.                                         |
| Reviews       | A peer checks requirements, risk, design, evidence, and maintainability.                                                                                   | Treat review as a peer activity across all test levels, never as another test level.                                                                                                 |

The repository currently owns no product tests and has no `test` script. Classifications and commands become concrete when executable behavior exists; this document does not add a test entry point now.

## Test levels

Classify a test by the boundary and purpose it verifies, not by process count, the mock or tool name. Organize tests around those levels and the capabilities they verify when real tests are introduced; no placeholder directory structure is required.

- **Unit**: one pure function or small module in isolation. Example: a parser maps valid and invalid configuration values to the documented result without Pi, file-system, or process access.
- **Component-integration**: a feature owner plus its direct collaborators through real module interfaces. Example: a feature assembles a command using a local deterministic adapter and preserves the adapter's typed failure.
- **System**: the package or capability suite as a whole through its public behavior or host surface. Example: Pi loads the extension, a command parses input and applies the feature, and the expected output appears with isolated settings.
- **System-integration**: the package's interaction with external systems, services, runtimes or tools. Example: an extension starts a real local tool or calls a controlled HTTP service, handles the response and releases resources on failure.
- **Acceptance**: a user or maintainer promise verified in the supported actual host and environment. Example: the extension loads in the maintainer's Bun-compiled Pi host and completes the agreed workflow, with the tested Pi and Bun versions recorded.

Offline and isolated temporary settings, directories, and sessions are the default. Use deterministic providers and local external fixtures when they answer the question. Select live accounts or models separately and name that choice. A missing required environment is unverified or a failure; it does not pass by omission. Offline real-Pi runs through RPC or PTY can provide end-to-end or acceptance evidence with a fixture provider; the tool does not decide the test level, and a live model is not a universal requirement.

## Execution policy

Keep PR evidence small and relevant. A small suite may run in full. Selective execution or sharding needs measured cost or scope evidence; do not introduce it speculatively. Provide a manual full entry backed by the real suite when a suite exists. Add scheduled or nightly execution only when real cost or selective PR runs justify it; no automatic scheduler is introduced by this baseline.

Preserve the existing recovery, cancellation, resource-cleanup, and input/data-boundary checks whenever the change touches them. Record the applicable activity, level, environment, command or manual procedure, result, and any unverified requirement in PR evidence. Failed or incomplete required verification blocks acceptance. Recheck the applicability of reused evidence after a revision, environment or behavior change; repeat checks when that change, a failure or an unresolved concern warrants it.
