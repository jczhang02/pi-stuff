# Quality assurance

[简体中文](i18n/zh-CN/quality-assurance.md) · English is normative.

This reference defines evidence for changes to Pi Stuff. It is a risk-proportionate decision guide, not a quota: a change does not need work at every level or a new job merely to fill the taxonomy. State the behavior and acceptance promise briefly, reuse evidence already valid for the same revision, and add tests only for important uncovered behavior or regressions. Do not add placeholders, coverage targets, tests that mirror implementation, ceremonial tooling, or the retired governance suites.

## Four QA activities

Use the activity that answers the question a change raises:

| Activity      | Evidence it provides                                                                                                                                       | Default use                                                                                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static Checks | Source and configuration are checked against the applicable syntax, type, lint and format rules without running the product behavior.                      | Run `bun run check` on every PR. The existing `checks` job also validates workflows with checksum-pinned actionlint 1.7.12.                                                   |
| Tests         | A behavior at a defined boundary produces the required result, including failure, cancellation, recovery, cleanup, and input/data handling where relevant. | Run the applicable offline suite on a PR; run the full applicable offline suite when shared infrastructure, a Pi upgrade, or unclear impact makes the wider surface relevant. |
| Benchmarks    | A measured comparison of task outcomes, time or resource use under a named environment and workload.                                                       | Run independently on demand. It is not a routine merge gate. An explicit product performance requirement is a Test and may block acceptance.                                  |
| Reviews       | A peer checks requirements, risk, design, evidence, and maintainability.                                                                                   | Treat review as a peer activity across all test levels, never as another test level.                                                                                          |

`bun run test` runs the offline component and Pi terminal suites. Component tests retain real routing, decoding, extraction and storage; supplied adapters replace only network/authentication boundaries. Local HTTP tests exercise the runtime transport.

## Test levels

Classify a test by the boundary and purpose it verifies, not by process count, the mock or tool name. Organize tests around those levels and the capabilities they verify when real tests are introduced; no placeholder directory structure is required.

- **Unit**: one pure function or small module in isolation. Example: a parser maps valid and invalid configuration values to the documented result without Pi, file-system, or process access.
- **Component-integration**: a feature owner plus its direct collaborators through real module interfaces. Example: a feature assembles a command using a local deterministic adapter and preserves the adapter's typed failure.
- **System**: the package or capability suite as a whole through its public behavior or host surface. Example: Pi loads the extension, a command parses input and applies the feature, and the expected output appears with isolated settings.
- **System-integration**: the package's interaction with external systems, services, runtimes or tools. Example: an extension starts a real local tool or calls a controlled HTTP service, handles the response and releases resources on failure.
- **Acceptance**: a user or maintainer promise verified in the supported actual host and environment. Example: the extension loads in the maintainer's Bun-compiled Pi host and completes the agreed workflow, with the tested Pi and Bun versions recorded.

Offline and isolated temporary settings, directories, and sessions are the default. Use deterministic providers and local external fixtures when they answer the question. Select live accounts or models separately and name that choice. A missing required environment is unverified or a failure; it does not pass by omission. Offline real-Pi runs through RPC or PTY can provide end-to-end or acceptance evidence with a fixture provider; the tool does not decide the test level, and a live model is not a universal requirement.

## Terminal E2E

Use `tuistory` as the terminal driver and Bun test as the runner for terminal E2E. The development dependency is pinned in `package.json`. Use its `launchTerminal` API for programmatic tests; the CLI is available through `bun run tui` for interactive inspection. Read the [tuistory skill](../.agents/skills/tuistory/SKILL.md) before using either. Run `bun run tui --help` for the CLI reference, then use the installed package's documentation and type declarations for API details. Consult matching upstream documentation only when local sources do not answer the question, and reuse already-valid context rather than repeating lookups. Use the repository dependency rather than a globally installed or freshly fetched version.

Keep tests focused on owned user-visible behavior:

- Launch each test with isolated working, settings and session directories. For Pi, set `PI_CODING_AGENT_DIR` and disable unrelated extensions, skills and other auto-loaded resources. Control the test runner's environment too: child-process options can inherit or merge parent variables.
- Wait for a distinctive state with a bounded timeout. In tuistory 0.11.0, `text()` and `waitForText()` include scrollback, so a match can come from prior output. For visible-screen assertions, use a `text({waitFor, timeout})` predicate that reads `getTerminalData()`, takes the last `rows` entries of `lines`, and joins each row's span text. Check the full relevant text, including Chinese and emoji when present, and a distinct result for each action. Resize while the affected UI is open when layout is part of the requirement.
- Stop the process owned by the test, wait for exit with a timeout, and always close its terminal in teardown, including on assertion or exit-wait failure. Preserve useful screen output on failure and let unexpected failures reach the test runner. Do not close another session's shared CLI terminal.
- Add only the setup and lifecycle helpers needed by real cases. Reuse the framework's input, screen and waiting APIs instead of building another terminal-testing layer.

`bun test tests/system/pi-host.test.ts` launches the installed Pi 0.85.1 CLI under Bun with isolated settings and a deterministic local model. Set `PI_TEST_HOST=/absolute/path/to/pi` to run the same suite against the maintainer's compiled host; a missing executable fails rather than skipping acceptance. The fixture emits actual model tool calls and loads the unmodified entrypoint. It verifies fetch, paging/find, non-persistence of hidden retained text, reload/new-session cache invalidation, independent global/host tool selection, invalid-configuration recovery and Esc cancellation of active and queued fetches. CI runs the default offline profile, not live providers. Live account checks require separate authorization and evidence.

The [selection experiment](https://github.com/jczhang02/pi-stuff/issues/29) used a temporary dialog extension in real Pi 0.85.1 on Linux with Bun 1.4.0. Tuistory 0.11.0 passed full Chinese/emoji text checks, selection, Escape cancellation, resizing with the dialog open, and an expected missing-text timeout. The competing `@microsoft/tui-test@0.1.0-beta.3` locator timed out on text visible in its screen dump; the cause was not diagnosed. This supports the tool choice. That historical experiment is not product acceptance. Current web-access verification and remaining provider/runtime limits are recorded in [PR #46](https://github.com/jczhang02/pi-stuff/pull/46); no other operating-system support is claimed.

## Execution policy

Keep PR evidence small and relevant. A small suite may run in full. Selective execution or sharding needs measured cost or scope evidence; do not introduce it speculatively. Provide a manual full entry backed by the real suite when a suite exists. Add scheduled or nightly execution only when real cost or selective PR runs justify it; no automatic scheduler is introduced by this baseline.

Preserve the existing recovery, cancellation, resource-cleanup, and input/data-boundary checks whenever the change touches them. Record the applicable activity, level, environment, command or manual procedure, result, and any unverified requirement in PR evidence. Failed or incomplete required verification blocks acceptance. Recheck the applicability of reused evidence after a revision, environment or behavior change; repeat checks when that change, a failure or an unresolved concern warrants it.
