# Test framework overview and inventory

Date: 2026-09-05. Source snapshot: `2610bd4299ecb76b29094587a28dd5af5f020c27`.
This is a design inventory for [the testing interview](../adr/0031-organize-test-evidence-and-release-gates.md),
not an implemented runner policy. It covers every tracked test entry, the independent acceptance and benchmark
entries, and the supporting files at this snapshot. No tests, paid model evaluations, or timing measurements were run.

## Classification status update

The subsequent discussion accepted Capability Module as the primary component boundary and verification objective,
rather than resource use, as the scope criterion. The [ADR definitions](../adr/0031-organize-test-evidence-and-release-gates.md)
govern reassessment. File and entry discovery below remains evidence for this snapshot, but all scope labels are
initial judgments awaiting reassessment, not only the original 44 question-marked entries. Do not route PR checks or
move tests directly from these labels. Reclassification records objective, scope, actual dependencies, and execution
policy per case group; a file is not an indivisible classification unit.

## Framework overview

```text
Repository verification
├── Correctness tests
│   ├── Unit (U): isolated rules, transformations, and algorithms
│   ├── Component (C): one Module through its interface; external collaborators controlled
│   ├── Integration (I): real Module, storage, process, transport, or Host SDK connections
│   └── System (S): assembled Suite through actual Pi RPC or terminal entry points
│       ├── Deterministic E2E: controlled Provider / local service fixtures
│       └── Live E2E: actual model or external service where the journey requires it
├── Benchmarks
│   ├── Internal performance: latency, CPU, memory, rendering, and context work
│   └── External tasks: outcomes and cost against other harnesses and historical Suite runs
├── Static and artifact gates: formatting, lint, types, dependencies, composition, archive contents
└── Support and evidence: fixtures, runners, observers, manifests, and historical reports
```

The first four are project scope categories. E2E describes a system journey, not a fifth level. Benchmark purpose, resource
use, execution frequency, and the tested target (product, test infrastructure, or repository tooling) are separate
properties. Tests of benchmark statistics remain correctness tests; running them does not execute a paid benchmark.
A source-text assertion is recorded here but does not prove product integration simply because it reads a file.

Classify the exercised boundary, not the filename or incidental imports. A real TUI class under `TestTui` is a
component; a fake child executable is process integration, not a real-Pi system test. A real Pi SDK Session can prove
integration without certifying the standalone Host. Cross-Module integration can still control the external Host.
Temporary files used only to arrange input do not automatically make every assertion an integration assertion.

`static` in a file row identifies a source/artifact assertion outside the four behavioral levels; it is not a fifth
level. A file can combine unit behavior with such an assertion.

## Completeness and limits

- 292 Bun test files and 21 Goal Node test files: **313 unique file entries**, reconciled with tracked paths.
- One additional executed entry, `test/goal-upstream/goal-runtime-smoke.mjs`, runs after the Node files.
- 25 `scripts/verify-*.ts` files are mapped separately, plus `smoke-pi.ts` and the runner/quality/benchmark commands.
- The remaining 91 tracked files under `test/` are support or input/evidence files, listed below. Runtime budget
  scenarios are included through the smoke entry, rather than counted as another independent suite.
- Classification is at file level. `U/I` or `C/S` marks mixed boundaries. A trailing `?` means the file is located and
  its purpose established, but case-level boundary assignment remains open; it is not a claim of mixed coverage.
- There are **44 such pending files**. They remain visible and must be resolved before moving files or routing checks
  by this inventory. No file is proposed for deletion solely because it is large, mixed, or pending.
- This is entry coverage, not statement/branch coverage, an assertion-value audit, or evidence that tests pass today.
  No test-case totals or current duration estimates are inferred from text searches.

## Current execution versus agreed direction

| Entry | Current behavior | Agreed direction, not yet implemented |
| --- | --- | --- |
| `check:fast` | Format, lint, types, Knip, generated source, repository and contract-catalog gates | Routine development quality checks |
| `test:isolated` | Serial fresh Bun process per discovered file, including system tests | Organize U/C/I/S before changing routing or parallelism |
| `test:goal` | Compile, run 21 Node files, then Goal SDK runtime smoke | Classify these alongside the Bun tests |
| `test`, `test:ci` | Both of the above | Ordinary PRs run all U/C/I; targeted E2E for high-risk changes |
| `check` | Fast gates, all tests, Tool Activity benchmark, package verification | Avoid mandatory duplicate local and CI full runs |
| `pack:verify` | Archive/dependency checks plus many extracted-Package acceptance journeys | Development archive structure checks separate from full release E2E |
| System E2E | Many journeys currently run inside ordinary tests and again through pack verification | Both deterministic and live types retained; low frequency |
| `benchmark:*` | Tool Activity automatic; other entries manual | Internal and external benchmarks low frequency, on demand |

Formal release candidates require complete deterministic E2E. Live journeys remain relevant to explicit validation
or important external dependency changes. Benchmarks prioritize stored public results and historical Pi Stuff runs;
a new plain-Pi control is not required. Exact artifact identity, evidence reuse, and final routing remain design work.

The inspected historical CI run [33839062989](https://github.com/jczhang02/pi-stuff/actions/runs/33839062989)
spent approximately 18m13s in isolated tests, 9m22s in package verification, and 0.9s in Tool Activity benchmark.
Those older-snapshot observations locate likely costs; they are not fresh timings or a speedup claim.

## File inventory by owning area

Every path below has one row. The area is a navigation aid; it is not an additional test level. All `.test.ts` rows
are discovered by `test:isolated`; all `.node.ts` rows by `test:goal`. Host, process, filesystem, and global-environment
isolation requirements must be preserved when designing parallel execution.

| Area | Files |
| --- | --- |
| `root` | 44 |
| `agents` | 77 |
| `goal-upstream` | 21 |
| `context` | 18 |
| `code-mode` | 21 |
| `mcp` | 18 |
| `web` | 15 |
| `conversation-ui` | 1 |
| `ui` | 21 |
| `tools` | 19 |
| `btw` | 4 |
| `codex` | 6 |
| `notification` | 6 |
| `ponytail` | 6 |
| `rtk` | 6 |
| `session-naming` | 8 |
| `shared` | 5 |
| `todo` | 9 |
| `work` | 8 |

### root

| File | Level | What it verifies |
| --- | --- | --- |
| [agents-execution-matrix.test.ts](../../test/agents-execution-matrix.test.ts) | S | Agent execution/context matrix |
| [agents-host.test.ts](../../test/agents-host.test.ts) | C/S | Definition paths and real Pi loading |
| [agents-pty.test.ts](../../test/agents-pty.test.ts) | S | Background report and cold recovery in TUI |
| [anti-slop.integration.test.ts](../../test/anti-slop.integration.test.ts) | I | Real Oxlint rule wiring |
| [btw-host.test.ts](../../test/btw-host.test.ts) | S | BTW Package loading |
| [btw-pty.test.ts](../../test/btw-pty.test.ts) | S | Concurrent BTW dialogs and focus |
| [bundled-package.test.ts](../../test/bundled-package.test.ts) | I | Archive contents and dependency boundaries |
| [check-capability-contract-catalog.test.ts](../../test/check-capability-contract-catalog.test.ts) | I | Contract catalog checker fixtures |
| [check-repository-safety.test.ts](../../test/check-repository-safety.test.ts) | I | Repository safety checker and size gates |
| [ci-acceptance-scope.test.ts](../../test/ci-acceptance-scope.test.ts) | U | Changed-path classification |
| [codex-host.test.ts](../../test/codex-host.test.ts) | S | Codex loading and settings startup boundary |
| [context-pty.test.ts](../../test/context-pty.test.ts) | S | Context compaction and retry in TUI |
| [detached-process.test.ts](../../test/detached-process.test.ts) | I | Process group timeout and cleanup |
| [effect-foundation.test.ts](../../test/effect-foundation.test.ts) | C/I? | Effect owner and shared UI lifecycle |
| [effect-mainline-benchmark.test.ts](../../test/effect-mainline-benchmark.test.ts) | U/I | Benchmark statistics and local CLI smoke |
| [generate-suite.test.ts](../../test/generate-suite.test.ts) | I | Generator output and drift detection |
| [goal-pty.test.ts](../../test/goal-pty.test.ts) | S | Goal dialog and native settings |
| [lifecycle-benchmark.test.ts](../../test/lifecycle-benchmark.test.ts) | U/I | Sampling, markers, and result gates |
| [lifecycle-deadline.test.ts](../../test/lifecycle-deadline.test.ts) | U | Deadline cancellation |
| [pi-host-provenance.test.ts](../../test/pi-host-provenance.test.ts) | I | Host artifact identity checks |
| [pi-host-seams.test.ts](../../test/pi-host-seams.test.ts) | I | JSONL evidence polling helper |
| [pi-rpc-client.test.ts](../../test/pi-rpc-client.test.ts) | I | Child RPC exit, timeout, and signals |
| [ponytail-pty.test.ts](../../test/ponytail-pty.test.ts) | S | Ponytail dialogs, state, and prompt boundary |
| [skill-discovery-benchmark.test.ts](../../test/skill-discovery-benchmark.test.ts) | U/I | Manifest, observer, statistics, and redaction |
| [smoke-pi.test.ts](../../test/smoke-pi.test.ts) | S | Standalone Pi RPC Package smoke |
| [suite-host.test.ts](../../test/suite-host.test.ts) | S | Single Package assembly through Pi |
| [suite-lifecycle.test.ts](../../test/suite-lifecycle.test.ts) | C | Readiness and shutdown generation barriers |
| [suite-loader.test.ts](../../test/suite-loader.test.ts) | I | Physical source cache and reload |
| [theme-pty.test.ts](../../test/theme-pty.test.ts) | S | Theme discovery, switching, and resume |
| [themes.test.ts](../../test/themes.test.ts) | I | Shipped theme asset validation |
| [todo-host.test.ts](../../test/todo-host.test.ts) | C/S | Task tool registration and Pi loading |
| [tools-grouping-pty.test.ts](../../test/tools-grouping-pty.test.ts) | S | Tool grouping and tmux inheritance |
| [tools-pty.test.ts](../../test/tools-pty.test.ts) | S | Tool details and UI responsiveness |
| [tools-resume-pty.test.ts](../../test/tools-resume-pty.test.ts) | S | Resume projection and active membership |
| [typecheck-configuration.test.ts](../../test/typecheck-configuration.test.ts) | I | TypeScript configuration and build wiring |
| [ui-host.test.ts](../../test/ui-host.test.ts) | S | Unified UI settings command |
| [ui-pty-evidence.test.ts](../../test/ui-pty-evidence.test.ts) | U | Evidence path redaction |
| [ui-pty-owner-watchdog.test.ts](../../test/ui-pty-owner-watchdog.test.ts) | I | Process identity and tmux ownership |
| [ui-pty.test.ts](../../test/ui-pty.test.ts) | S | Real terminal rendering and recovery |
| [user-message-pty.test.ts](../../test/user-message-pty.test.ts) | S | Message expansion, resize, and replay |
| [work-host.test.ts](../../test/work-host.test.ts) | S | Background Work loading and Bash policy |
| [work-monitor-matrix.test.ts](../../test/work-monitor-matrix.test.ts) | S | Monitor success and failure journeys |
| [work-pty.test.ts](../../test/work-pty.test.ts) | S | Detach, monitor, reload, and cleanup |
| [xdg-paths.test.ts](../../test/xdg-paths.test.ts) | C/I | Environment fallback and state paths |

### agents

| File | Level | What it verifies |
| --- | --- | --- |
| [agent-bundle-boundary.test.ts](../../test/agents/agent-bundle-boundary.test.ts) | I | Agent definition discovery boundaries |
| [agent-dialog.test.ts](../../test/agents/agent-dialog.test.ts) | C | Agent dialog state and layout |
| [agent-discovery.test.ts](../../test/agents/agent-discovery.test.ts) | I | Directory precedence, symlinks, and invalid definitions |
| [agent-effect-owner.test.ts](../../test/agents/agent-effect-owner.test.ts) | C | Effect scope replacement and shutdown |
| [agent-execution-coordinator-leases.test.ts](../../test/agents/agent-execution-coordinator-leases.test.ts) | C/I? | Coordinator lease binding and release |
| [agent-execution-coordinator-session.test.ts](../../test/agents/agent-execution-coordinator-session.test.ts) | C/I? | Session ledger and launch admission |
| [agent-execution-governor.test.ts](../../test/agents/agent-execution-governor.test.ts) | C/I? | Capacity, depth, and lease rebinding |
| [agent-roster.test.ts](../../test/agents/agent-roster.test.ts) | C | Roster ordering and visible state |
| [agent-transcript.test.ts](../../test/agents/agent-transcript.test.ts) | I | Transcript writing, pairing, and cleanup |
| [artifacts.test.ts](../../test/agents/artifacts.test.ts) | I | Atomic artifact publication and lifetime |
| [atomic-json.test.ts](../../test/agents/atomic-json.test.ts) | U | Writer failure preserves original error |
| [background-engine-artifacts.test.ts](../../test/agents/background-engine-artifacts.test.ts) | I | Artifact rollover and missing-result recovery |
| [background-engine-completion.test.ts](../../test/agents/background-engine-completion.test.ts) | I | Fixture child completion across Tool boundaries |
| [background-engine-configuration.test.ts](../../test/agents/background-engine-configuration.test.ts) | I | Startup markers and directory ownership |
| [background-engine-fallback.test.ts](../../test/agents/background-engine-fallback.test.ts) | I | Fallback and session copy recovery |
| [background-engine-groups.test.ts](../../test/agents/background-engine-groups.test.ts) | I | Group timeout, queued cancellation, and cleanup |
| [background-engine-lifecycle.test.ts](../../test/agents/background-engine-lifecycle.test.ts) | I | Writer protocol and terminal persistence |
| [background-engine-recovery.test.ts](../../test/agents/background-engine-recovery.test.ts) | I | Persisted process and nested-result recovery |
| [background-engine-startup.test.ts](../../test/agents/background-engine-startup.test.ts) | I | Fixture process startup and output draining |
| [background-engine-steering.test.ts](../../test/agents/background-engine-steering.test.ts) | I | Steering routing and acknowledgement replay |
| [background-engine-terminal.test.ts](../../test/agents/background-engine-terminal.test.ts) | I | Signals and descendant termination |
| [child-protocol.test.ts](../../test/agents/child-protocol.test.ts) | U | Child protocol parsing |
| [child-result-reducer.test.ts](../../test/agents/child-result-reducer.test.ts) | U | Result reduction and final-report precedence |
| [config.test.ts](../../test/agents/config.test.ts) | U | Concurrency and depth constants |
| [control-channel.test.ts](../../test/agents/control-channel.test.ts) | I | Atomic targeted control writes |
| [current-agents-controls.test.ts](../../test/agents/current-agents-controls.test.ts) | I | Control log scanning and deduplication |
| [current-agents-lifecycle.test.ts](../../test/agents/current-agents-lifecycle.test.ts) | C/I? | Lifecycle persistence and notifications |
| [current-agents-projection.test.ts](../../test/agents/current-agents-projection.test.ts) | C | Direct-child projection for current Session |
| [current-agents-recovery.test.ts](../../test/agents/current-agents-recovery.test.ts) | I | Persisted runtime recovery |
| [diagnostics.test.ts](../../test/agents/diagnostics.test.ts) | U | Diagnostic formatting and normalization |
| [display-description.test.ts](../../test/agents/display-description.test.ts) | U | Description truncation and fallback |
| [durable-claim.test.ts](../../test/agents/durable-claim.test.ts) | I | Cross-process claim and crash recovery |
| [executor-contract.test.ts](../../test/agents/executor-contract.test.ts) | U | Public target parsing and validation |
| [extension-root-composition.test.ts](../../test/agents/extension-root-composition.test.ts) | C/I | Agents registration with controlled Host and files |
| [extension-root-lifecycle.test.ts](../../test/agents/extension-root-lifecycle.test.ts) | C/I | Agents lifecycle with controlled Host and files |
| [extension-root-recovery.test.ts](../../test/agents/extension-root-recovery.test.ts) | C/I? | Agents recovery with controlled Host |
| [fanout-child.test.ts](../../test/agents/fanout-child.test.ts) | C/I? | Fanout coordination and lifecycle |
| [final-report-scanner.test.ts](../../test/agents/final-report-scanner.test.ts) | U | Final-report text scanning |
| [foreground-engine-admission.test.ts](../../test/agents/foreground-engine-admission.test.ts) | C/I? | Prompt accounting and launch admission |
| [foreground-engine-context.test.ts](../../test/agents/foreground-engine-context.test.ts) | C/I? | Foreground result/context isolation |
| [foreground-engine-launch.test.ts](../../test/agents/foreground-engine-launch.test.ts) | C/I? | Foreground child setup and attribution |
| [foreground-engine-recovery.test.ts](../../test/agents/foreground-engine-recovery.test.ts) | I | Persisted foreground runtime recovery |
| [foreground-engine-resume.test.ts](../../test/agents/foreground-engine-resume.test.ts) | C/I? | Resume identity and execution context |
| [fork-context.test.ts](../../test/agents/fork-context.test.ts) | U | Fork message sanitization |
| [host-builtins.test.ts](../../test/agents/host-builtins.test.ts) | C | Built-in tool registry and MCP policy |
| [legacy-async-recovery.test.ts](../../test/agents/legacy-async-recovery.test.ts) | I | Legacy process evidence recovery |
| [legacy-surface-cleanup.test.ts](../../test/agents/legacy-surface-cleanup.test.ts) | I | Legacy descriptor and metadata cleanup |
| [model-fallback.test.ts](../../test/agents/model-fallback.test.ts) | C/I? | Fallback limits and session restoration |
| [native-supervisor-channel-delivery.test.ts](../../test/agents/native-supervisor-channel-delivery.test.ts) | I | Channel delivery, claims, and scanning |
| [native-supervisor-channel-ownership.test.ts](../../test/agents/native-supervisor-channel-ownership.test.ts) | I | Owner crash recovery and takeover |
| [nested-events.test.ts](../../test/agents/nested-events.test.ts) | I | Nested route publication and recovery |
| [pi-spawn.test.ts](../../test/agents/pi-spawn.test.ts) | C/I? | Child executable resolution and inheritance |
| [ponytail-propagation.test.ts](../../test/agents/ponytail-propagation.test.ts) | C | Ponytail mode launch snapshot |
| [process-controls-recovery.test.ts](../../test/agents/process-controls-recovery.test.ts) | I | Process identity and control recovery |
| [product-executor.test.ts](../../test/agents/product-executor.test.ts) | C | Executor parameter and result mapping |
| [result-watcher-atomic.test.ts](../../test/agents/result-watcher-atomic.test.ts) | I | Atomic result replacement and claims |
| [result-watcher-compatibility.test.ts](../../test/agents/result-watcher-compatibility.test.ts) | I | Legacy result and attribution projection |
| [result-watcher-delivery.test.ts](../../test/agents/result-watcher-delivery.test.ts) | I | Cold delivery, retries, and watcher fallback |
| [run-status.test.ts](../../test/agents/run-status.test.ts) | U | Status selection and redaction |
| [runtime-maintenance.test.ts](../../test/agents/runtime-maintenance.test.ts) | I | Maintenance fairness and orphan cleanup |
| [session-governor-compatibility.test.ts](../../test/agents/session-governor-compatibility.test.ts) | I | Legacy governor state compatibility |
| [session-governor-runtime-address.test.ts](../../test/agents/session-governor-runtime-address.test.ts) | I | Durable runtime address identity |
| [session-governor-work-usage.test.ts](../../test/agents/session-governor-work-usage.test.ts) | C/I? | Usage ledger and launch limits |
| [session-governor.test.ts](../../test/agents/session-governor.test.ts) | I | Governor ledger and state directories |
| [session-identity.test.ts](../../test/agents/session-identity.test.ts) | I | Session file identity and namespace isolation |
| [session-lease.test.ts](../../test/agents/session-lease.test.ts) | I | Lease survival and process evidence |
| [skills.test.ts](../../test/agents/skills.test.ts) | U | No-request Skill resolution shortcut |
| [steering-wait.test.ts](../../test/agents/steering-wait.test.ts) | C | Acknowledgement polling and transient errors |
| [terminal-outcome.test.ts](../../test/agents/terminal-outcome.test.ts) | U | Terminal classification and usage round-trip |
| [tool-budget-runtime.test.ts](../../test/agents/tool-budget-runtime.test.ts) | U | Tool budget state and protocol evidence |
| [tool-presentation-channels.test.ts](../../test/agents/tool-presentation-channels.test.ts) | I | Control channels and steering acknowledgements |
| [tool-presentation-child-runtime.test.ts](../../test/agents/tool-presentation-child-runtime.test.ts) | C/I? | Child tool identifiers and context projection |
| [tool-presentation-host-tools.test.ts](../../test/agents/tool-presentation-host-tools.test.ts) | C/I? | Tool allowlists, environment, and registration |
| [tool-presentation-rendering.test.ts](../../test/agents/tool-presentation-rendering.test.ts) | C | Tool rows and terminal width bounds |
| [tool-timeout.test.ts](../../test/agents/tool-timeout.test.ts) | U | Tool timeout selection |
| [worktree-lifecycle.test.ts](../../test/agents/worktree-lifecycle.test.ts) | I | Git worktree cleanup and data protection |
| [writer-process-registry.test.ts](../../test/agents/writer-process-registry.test.ts) | I | Writer identity, signals, and stale state |

### goal-upstream

| File | Level | What it verifies |
| --- | --- | --- |
| [command.node.ts](../../test/goal-upstream/command.node.ts) | U/C? | Command parsing and completion |
| [goal-accounting.node.ts](../../test/goal-upstream/goal-accounting.node.ts) | U/C? | Budget parsing and management commands |
| [goal-budget.node.ts](../../test/goal-upstream/goal-budget.node.ts) | C/I? | Pause, clear, and stale-tool state |
| [goal-continuation.node.ts](../../test/goal-upstream/goal-continuation.node.ts) | C/I? | Continuation ownership and consumption |
| [goal-ownership.node.ts](../../test/goal-upstream/goal-ownership.node.ts) | C/I? | Parent/child ownership and tool isolation |
| [goal-queue-priority.node.ts](../../test/goal-upstream/goal-queue-priority.node.ts) | C/I? | Queue prioritization and run identity |
| [goal-queue-recovery.node.ts](../../test/goal-upstream/goal-queue-recovery.node.ts) | C/I? | Queue reload and head recovery |
| [goal-queue.node.ts](../../test/goal-upstream/goal-queue.node.ts) | C/I? | Queue registration and mutations |
| [goal-recovery.node.ts](../../test/goal-upstream/goal-recovery.node.ts) | U/C? | Recovery classification and event mapping |
| [goal-resume.node.ts](../../test/goal-upstream/goal-resume.node.ts) | C/I? | Stopped-state restoration and identity rotation |
| [goal-run-protocol.node.ts](../../test/goal-upstream/goal-run-protocol.node.ts) | C/I? | Managed-run protocol lifecycle |
| [goal-run-session.node.ts](../../test/goal-upstream/goal-run-session.node.ts) | C/I? | Run listener isolation and cancellation |
| [goal-safety.node.ts](../../test/goal-upstream/goal-safety.node.ts) | U/C? | No-progress and blocker audit classification |
| [goal-terminal-tools.node.ts](../../test/goal-upstream/goal-terminal-tools.node.ts) | C/I? | Terminal tool guards and prompt routing |
| [goal-tool-policy.node.ts](../../test/goal-upstream/goal-tool-policy.node.ts) | C/I? | Tool policy and stale-turn abort |
| [goal.node.ts](../../test/goal-upstream/goal.node.ts) | C/I | Goal registration and settings with mock Pi |
| [menu.node.ts](../../test/goal-upstream/menu.node.ts) | U/C? | Menu priority and text bounds |
| [persistence.node.ts](../../test/goal-upstream/persistence.node.ts) | I | State persistence and malformed files |
| [queue.node.ts](../../test/goal-upstream/queue.node.ts) | U/C? | Queue structural operations |
| [settings-ui.node.ts](../../test/goal-upstream/settings-ui.node.ts) | C | Settings input and limits dialog |
| [settings.node.ts](../../test/goal-upstream/settings.node.ts) | I | Settings normalization and persistence |

### context

| File | Level | What it verifies |
| --- | --- | --- |
| [activity.test.ts](../../test/context/activity.test.ts) | U | Activity projection and sanitization |
| [config.test.ts](../../test/context/config.test.ts) | I | Configuration first use, migration, and permissions |
| [core-activation.test.ts](../../test/context/core-activation.test.ts) | C | Activation, native compaction, and retry |
| [core-compaction.test.ts](../../test/context/core-compaction.test.ts) | C | Compaction failure, cancellation, and recovery |
| [core-input-activation.test.ts](../../test/context/core-input-activation.test.ts) | C | Interactive input activation authority |
| [core-maintenance.test.ts](../../test/context/core-maintenance.test.ts) | C | Maintenance and Session isolation |
| [core-ordering.test.ts](../../test/context/core-ordering.test.ts) | C | Contributor and event ordering |
| [core-projections.test.ts](../../test/context/core-projections.test.ts) | C | Projection cache, concurrency, and isolation |
| [core-provider-boundary.test.ts](../../test/context/core-provider-boundary.test.ts) | C | Provider payload and recovery boundary |
| [core-runtime.test.ts](../../test/context/core-runtime.test.ts) | C | Runtime startup, reuse, and cleanup |
| [dialog.test.ts](../../test/context/dialog.test.ts) | C | Context dialog state and layout |
| [duplicate-runtime.test.ts](../../test/context/duplicate-runtime.test.ts) | I | Physical module copies sharing one Host resource |
| [magic-context-schema.test.ts](../../test/context/magic-context-schema.test.ts) | I | SQLite storage migration and version rejection |
| [magic-worker-context.test.ts](../../test/context/magic-worker-context.test.ts) | U/C? | Worker Session mirror isolation |
| [magic-worker-transport.test.ts](../../test/context/magic-worker-transport.test.ts) | C/I? | Worker protocol, cancellation, and cleanup |
| [magic-worker.test.ts](../../test/context/magic-worker.test.ts) | C/I? | Worker effects and Host interpreter boundary |
| [native-custom-turn-compaction-host-seam.test.ts](../../test/context/native-custom-turn-compaction-host-seam.test.ts) | I | Real Pi SDK compaction and custom turn |
| [prompt-contributions.test.ts](../../test/context/prompt-contributions.test.ts) | C | Prompt contribution composition and cleanup |

### code-mode

| File | Level | What it verifies |
| --- | --- | --- |
| [cloudflare-codec.test.ts](../../test/code-mode/cloudflare-codec.test.ts) | U | JSON codec and stable serialization |
| [cloudflare-normalize.test.ts](../../test/code-mode/cloudflare-normalize.test.ts) | U | Program normalization |
| [cloudflare-search.test.ts](../../test/code-mode/cloudflare-search.test.ts) | U | Exact tool search |
| [connector.test.ts](../../test/code-mode/connector.test.ts) | C | Tool catalog and result/media adaptation |
| [delegate-lifecycle.test.ts](../../test/code-mode/delegate-lifecycle.test.ts) | C | Delegated scope cancellation and isolation |
| [delegate-runtime.test.ts](../../test/code-mode/delegate-runtime.test.ts) | C | Delegation, approval, and trace settlement |
| [dialog.test.ts](../../test/code-mode/dialog.test.ts) | C | Settings dialog inheritance and rollback |
| [extension.test.ts](../../test/code-mode/extension.test.ts) | C | Extension registration, UI, and projection |
| [host-client.test.ts](../../test/code-mode/host-client.test.ts) | I | Subprocess handshake, frames, and shutdown |
| [image-benchmark.test.ts](../../test/code-mode/image-benchmark.test.ts) | U | PNG fixtures and benchmark result accounting |
| [image-content.test.ts](../../test/code-mode/image-content.test.ts) | U | Image data validation and bounds |
| [install-host.test.ts](../../test/code-mode/install-host.test.ts) | I | Installer locking and staging recovery |
| [ledger.test.ts](../../test/code-mode/ledger.test.ts) | C/I? | Ledger replay, approval, and persistence failure |
| [presentation.test.ts](../../test/code-mode/presentation.test.ts) | U | Media and tool result projection |
| [process-start-identity.test.ts](../../test/code-mode/process-start-identity.test.ts) | U | Process identity parsing with injected readers |
| [runtime.test.ts](../../test/code-mode/runtime.test.ts) | C | Execution replay, cancellation, and media |
| [search-response.test.ts](../../test/code-mode/search-response.test.ts) | C | Discovery response and character budgets |
| [settings.test.ts](../../test/code-mode/settings.test.ts) | I | Settings layers and namespace persistence |
| [skill-discovery.test.ts](../../test/code-mode/skill-discovery.test.ts) | C | Skill catalog prompt projection |
| [trace-store.test.ts](../../test/code-mode/trace-store.test.ts) | U | Trace deduplication and retention |
| [v8-real.test.ts](../../test/code-mode/v8-real.test.ts) | I | Real V8 executor and connector; opt-in |

### mcp

| File | Level | What it verifies |
| --- | --- | --- |
| [adapter.test.ts](../../test/mcp/adapter.test.ts) | C/I | Gateway registration, discovery, and Code Mode link |
| [auth-flow.test.ts](../../test/mcp/auth-flow.test.ts) | C/I | OAuth callbacks and credential binding |
| [command-secret.test.ts](../../test/mcp/command-secret.test.ts) | U/I | Real secret command and error redaction |
| [config-persistence.test.ts](../../test/mcp/config-persistence.test.ts) | I | Config locking, symlinks, and atomic merge |
| [dialog.test.ts](../../test/mcp/dialog.test.ts) | C | MCP dialog state and reconnect actions |
| [host-seam.test.ts](../../test/mcp/host-seam.test.ts) | C/I? | Manager isolation and resource previews |
| [http-transport.test.ts](../../test/mcp/http-transport.test.ts) | I | Native HTTP OAuth retry against loopback server |
| [mcp-trace.test.ts](../../test/mcp/mcp-trace.test.ts) | U | Transport trace identity and delegation |
| [npx-resolver.test.ts](../../test/mcp/npx-resolver.test.ts) | I | NPX cache discovery and invalid entries |
| [output-guard.test.ts](../../test/mcp/output-guard.test.ts) | U | Nested output byte budgets |
| [presentation.test.ts](../../test/mcp/presentation.test.ts) | U | MCP activity classification |
| [probe.test.ts](../../test/mcp/probe.test.ts) | C | Probe response bounds and cancellation |
| [proxy-call.test.ts](../../test/mcp/proxy-call.test.ts) | C | Resolved tool dispatch and auth requirements |
| [request-timeout.test.ts](../../test/mcp/request-timeout.test.ts) | C | SDK timeout configuration |
| [runtime-owner.test.ts](../../test/mcp/runtime-owner.test.ts) | C | Runtime cancellation and transport cleanup |
| [setup-panel.test.ts](../../test/mcp/setup-panel.test.ts) | C | Setup navigation, writes, and errors |
| [status-store.test.ts](../../test/mcp/status-store.test.ts) | U | Status snapshot validation and projection |
| [xdg-paths.test.ts](../../test/mcp/xdg-paths.test.ts) | I | Config/cache/state paths and onboarding |

### web

| File | Level | What it verifies |
| --- | --- | --- |
| [activity.test.ts](../../test/web/activity.test.ts) | U | Provider error redaction and activity state |
| [adapter.test.ts](../../test/web/adapter.test.ts) | C | Tool schemas, URL checks, and projection |
| [config.test.ts](../../test/web/config.test.ts) | C/I | Settings migration, updates, and URL policy |
| [credential-source.test.ts](../../test/web/credential-source.test.ts) | C | Credential reference resolution with controlled command |
| [extract.test.ts](../../test/web/extract.test.ts) | C | Extraction cancellation, concurrency, and ordering |
| [fake-ip.test.ts](../../test/web/fake-ip.test.ts) | C | Controlled DNS detection and single flight |
| [gemini-api.test.ts](../../test/web/gemini-api.test.ts) | C/I | Redirect policy and credential forwarding |
| [pdf-extract.test.ts](../../test/web/pdf-extract.test.ts) | I | Local PDF extraction and file artifacts |
| [presentation.test.ts](../../test/web/presentation.test.ts) | U | Search/fetch failure and continuation projection |
| [provider-api-redirects.test.ts](../../test/web/provider-api-redirects.test.ts) | — (static) | Repository source assertion for redirect policy |
| [provider-domain-filter.test.ts](../../test/web/provider-domain-filter.test.ts) | U + static | Domain matching and repository source assertions |
| [provider-effects.test.ts](../../test/web/provider-effects.test.ts) | C | Controlled provider aggregation and cancellation |
| [rsc-extract.test.ts](../../test/web/rsc-extract.test.ts) | U | RSC extraction and table escaping |
| [ssrf-protection.test.ts](../../test/web/ssrf-protection.test.ts) | C | Controlled DNS, redirects, and request cancellation |
| [url-policy.test.ts](../../test/web/url-policy.test.ts) | U | Public URL input validation |

### conversation-ui

| File | Level | What it verifies |
| --- | --- | --- |
| [ponytail-dialog.test.ts](../../test/conversation-ui/ponytail-dialog.test.ts) | C | Ponytail dialog navigation and closing |

### ui

| File | Level | What it verifies |
| --- | --- | --- |
| [agent-run-origin.test.ts](../../test/ui/agent-run-origin.test.ts) | U | User run attribution and queue transitions |
| [command-dialog-attribution.test.ts](../../test/ui/command-dialog-attribution.test.ts) | C | User/automatic run attribution |
| [command-dialog-ownership.test.ts](../../test/ui/command-dialog-ownership.test.ts) | C | Shared dialog and footer ownership |
| [command-dialog-presentation.test.ts](../../test/ui/command-dialog-presentation.test.ts) | C | Dialog lifecycle and projection |
| [command-dialog-queue.test.ts](../../test/ui/command-dialog-queue.test.ts) | C | Dialog queues and mounting blockers |
| [conversation-markdown.test.ts](../../test/ui/conversation-markdown.test.ts) | U/C | Markdown transforms and lifecycle adapter |
| [diagnostics.test.ts](../../test/ui/diagnostics.test.ts) | C | Diagnostic channels and dialog layout |
| [dialog-layout.test.ts](../../test/ui/dialog-layout.test.ts) | U | Dialog width and row budgets |
| [fenced-visualization.test.ts](../../test/ui/fenced-visualization.test.ts) | U | Chart/tree fence recognition and projection |
| [host-resource.test.ts](../../test/ui/host-resource.test.ts) | C | Host shared-resource discovery failure |
| [input-enhancement.test.ts](../../test/ui/input-enhancement.test.ts) | C | Input highlighting and key behavior |
| [settings.test.ts](../../test/ui/settings.test.ts) | I | Settings persistence and cross-worker lock races |
| [statusline-git.test.ts](../../test/ui/statusline-git.test.ts) | C | Git refresh with controlled exec |
| [statusline-history.test.ts](../../test/ui/statusline-history.test.ts) | C | History rows, order, and truncation |
| [statusline-rendering.test.ts](../../test/ui/statusline-rendering.test.ts) | C | Status channel rendering on controlled Host |
| [suite-agent-message.test.ts](../../test/ui/suite-agent-message.test.ts) | C | Cross-facade messages and thenables |
| [thinking-line.test.ts](../../test/ui/thinking-line.test.ts) | C | Native Markdown Thinking projection |
| [ui-settings-dialog.test.ts](../../test/ui/ui-settings-dialog.test.ts) | C | Settings search, layout, and failures |
| [user-message-card.test.ts](../../test/ui/user-message-card.test.ts) | C | Message rendering and expansion |
| [user-message-display.test.ts](../../test/ui/user-message-display.test.ts) | C | Message insertion ownership and release |
| [welcome-header.test.ts](../../test/ui/welcome-header.test.ts) | C | Welcome header width and visibility |

### tools

| File | Level | What it verifies |
| --- | --- | --- |
| [activity-store.test.ts](../../test/tools/activity-store.test.ts) | U | Immutable snapshots and transition deduplication |
| [activity.test.ts](../../test/tools/activity.test.ts) | U | Retrieval grouping and narrative boundaries |
| [builtin-tools.test.ts](../../test/tools/builtin-tools.test.ts) | I | Built-in registration and real Skill reads |
| [contract-codemode-lifecycle.test.ts](../../test/tools/contract-codemode-lifecycle.test.ts) | C/I? | Nested lifecycle, cancellation, and compensation |
| [contract-codemode-media.test.ts](../../test/tools/contract-codemode-media.test.ts) | I | Code Mode and Tool Display media parity |
| [contract-codemode-projection.test.ts](../../test/tools/contract-codemode-projection.test.ts) | I | Connector and Tool Display result projection |
| [contract-registration.test.ts](../../test/tools/contract-registration.test.ts) | C | Tool registration and duplicates |
| [contract-rendering.test.ts](../../test/tools/contract-rendering.test.ts) | C/I? | Tool decoration, expansion, and fallback |
| [contract-retrieval-core.test.ts](../../test/tools/contract-retrieval-core.test.ts) | C | Retrieval state, timers, and boundaries |
| [contract-retrieval-outcomes.test.ts](../../test/tools/contract-retrieval-outcomes.test.ts) | C | Retrieval outcomes, pagination, and fallback |
| [contract-timers.test.ts](../../test/tools/contract-timers.test.ts) | C | Shared ticker and reload handoff |
| [dialog.test.ts](../../test/tools/dialog.test.ts) | C | Tool lists, details, and narrow layouts |
| [duplicate-runtime.test.ts](../../test/tools/duplicate-runtime.test.ts) | I | Physical module copies share one runtime |
| [formatted-detail.test.ts](../../test/tools/formatted-detail.test.ts) | C | Formatted evidence versus raw protocol |
| [operation-blocks.test.ts](../../test/tools/operation-blocks.test.ts) | C/I | Cross-Capability operation registration and rendering |
| [render.test.ts](../../test/tools/render.test.ts) | C | Tool rows, colors, and width bounds |
| [resume-handoff.test.ts](../../test/tools/resume-handoff.test.ts) | I | Lifecycle handoff and Session files |
| [settings.test.ts](../../test/tools/settings.test.ts) | I | Settings migration, locking, and atomic writes |
| [terminal.test.ts](../../test/tools/terminal.test.ts) | U | Terminal text cleanup and truncation |

### btw

| File | Level | What it verifies |
| --- | --- | --- |
| [core.test.ts](../../test/btw/core.test.ts) | C | Context projection, streaming errors, and cancellation |
| [history.test.ts](../../test/btw/history.test.ts) | C | History isolation, eviction, and recovery |
| [transport.test.ts](../../test/btw/transport.test.ts) | C | Controlled Provider headers and cancellation |
| [ui.test.ts](../../test/btw/ui.test.ts) | C | Dialog rendering, navigation, and cleanup |

### codex

| File | Level | What it verifies |
| --- | --- | --- |
| [dialog.test.ts](../../test/codex/dialog.test.ts) | C | Codex dialog layout and errors |
| [image-generation.test.ts](../../test/codex/image-generation.test.ts) | C/I | Image MIME, paths, bounds, and tool results |
| [native-tools.test.ts](../../test/codex/native-tools.test.ts) | C/I | Native tool registration and platform policy |
| [settings.test.ts](../../test/codex/settings.test.ts) | I | Settings startup, atomic writes, and locking |
| [tools.test.ts](../../test/codex/tools.test.ts) | C | Tool registration and model activation |
| [usage.test.ts](../../test/codex/usage.test.ts) | C | Usage normalization, timeout, and cancellation |

### notification

| File | Level | What it verifies |
| --- | --- | --- |
| [dialog.test.ts](../../test/notification/dialog.test.ts) | C | Notification settings dialog |
| [extension.test.ts](../../test/notification/extension.test.ts) | C | Commands, listeners, and cleanup |
| [format.test.ts](../../test/notification/format.test.ts) | U | Notification title and body formatting |
| [runtime.test.ts](../../test/notification/runtime.test.ts) | C | Notification state, grace period, and cancellation |
| [settings.test.ts](../../test/notification/settings.test.ts) | I | Settings migration and concurrent persistence |
| [transport.test.ts](../../test/notification/transport.test.ts) | I | Terminal notification and real tmux transport |

### ponytail

| File | Level | What it verifies |
| --- | --- | --- |
| [behavior-benchmark.test.ts](../../test/ponytail/behavior-benchmark.test.ts) | C/I | Benchmark inputs, snapshots, and statistics |
| [core.test.ts](../../test/ponytail/core.test.ts) | U/I | Mode rules, settings, and resource filtering |
| [prompt-budget.test.ts](../../test/ponytail/prompt-budget.test.ts) | C/I | Real Skill loading and prompt token accounting |
| [prompt.test.ts](../../test/ponytail/prompt.test.ts) | U | Mode-specific prompt contributions |
| [runtime.test.ts](../../test/ponytail/runtime.test.ts) | C/I | Session mode lifecycle and settings |
| [upstream-review.test.ts](../../test/ponytail/upstream-review.test.ts) | I | Resource hashes and upstream integrity |

### rtk

| File | Level | What it verifies |
| --- | --- | --- |
| [dialog.test.ts](../../test/rtk/dialog.test.ts) | C | RTK dialog paths and layout |
| [extension.test.ts](../../test/rtk/extension.test.ts) | C/I | Extension registration and settings directories |
| [projection.test.ts](../../test/rtk/projection.test.ts) | U | Message projection for RTK |
| [real-rtk.test.ts](../../test/rtk/real-rtk.test.ts) | I | Installed RTK execution; conditional availability |
| [runtime.test.ts](../../test/rtk/runtime.test.ts) | C/I | Executable identity, retries, and rewrites |
| [settings.test.ts](../../test/rtk/settings.test.ts) | I | Settings schema, concurrency, and failed writes |

### session-naming

| File | Level | What it verifies |
| --- | --- | --- |
| [controller.test.ts](../../test/session-naming/controller.test.ts) | C | Naming cooldown, overrides, and retries |
| [extension.test.ts](../../test/session-naming/extension.test.ts) | C | Naming extension lifecycle with controlled model |
| [host.test.ts](../../test/session-naming/host.test.ts) | S | Real Pi resume and Session naming |
| [model.test.ts](../../test/session-naming/model.test.ts) | C | Model selection, fallback, and name validation |
| [prompt.test.ts](../../test/session-naming/prompt.test.ts) | U | Naming prompt and ASCII validation |
| [settings-dialog.test.ts](../../test/session-naming/settings-dialog.test.ts) | C/I? | Settings dialog with test settings store |
| [settings.test.ts](../../test/session-naming/settings.test.ts) | I | Settings defaults and persistence |
| [state.test.ts](../../test/session-naming/state.test.ts) | U | Naming state and message-window projection |

### shared

| File | Level | What it verifies |
| --- | --- | --- |
| [host-proxy.test.ts](../../test/shared/host-proxy.test.ts) | U | Proxy property access and forwarding |
| [json-value.test.ts](../../test/shared/json-value.test.ts) | U | JSON input guards and cycles |
| [runtime-type.test.ts](../../test/shared/runtime-type.test.ts) | U | Runtime type guards |
| [settings-io.test.ts](../../test/shared/settings-io.test.ts) | I | Atomic settings merge, locks, and migration |
| [settings-secret-redaction.test.ts](../../test/shared/settings-secret-redaction.test.ts) | I | Malformed file errors redact secrets |

### todo

| File | Level | What it verifies |
| --- | --- | --- |
| [activity-presentation.test.ts](../../test/todo/activity-presentation.test.ts) | C/I? | Task tool activity and nested presentation |
| [format.test.ts](../../test/todo/format.test.ts) | U | Task rows and layout formatting |
| [replay.test.ts](../../test/todo/replay.test.ts) | U | Snapshot replay, migration, and corruption |
| [response-envelope.test.ts](../../test/todo/response-envelope.test.ts) | U | Task response envelopes |
| [state-reducer.test.ts](../../test/todo/state-reducer.test.ts) | U | Task mutations and state invariants |
| [store.test.ts](../../test/todo/store.test.ts) | U | In-memory Task store and eviction |
| [task-graph.test.ts](../../test/todo/task-graph.test.ts) | U | Task dependencies and cycles |
| [todo-overlay.render.test.ts](../../test/todo/todo-overlay.render.test.ts) | C | Overlay rendering and widget lifecycle |
| [todo.integration.test.ts](../../test/todo/todo.integration.test.ts) | C | Todo extension with controlled Host |

### work

| File | Level | What it verifies |
| --- | --- | --- |
| [activity-presentation.test.ts](../../test/work/activity-presentation.test.ts) | C/I? | Work activity and tool presentation link |
| [host.test.ts](../../test/work/host.test.ts) | C | Controlled Host rendering and replacement |
| [monitor.test.ts](../../test/work/monitor.test.ts) | C/I? | Monitor validation and condition results |
| [runtime-launch.test.ts](../../test/work/runtime-launch.test.ts) | C/I | Process launch, durable output, and shutdown |
| [runtime-notifications.test.ts](../../test/work/runtime-notifications.test.ts) | C/I | Process outcomes and notification delivery |
| [runtime-reconciliation.test.ts](../../test/work/runtime-reconciliation.test.ts) | I | Process identity and group recovery |
| [runtime-settlement.test.ts](../../test/work/runtime-settlement.test.ts) | C/I | Output settlement, timeouts, and cleanup |
| [tasks-dialog.test.ts](../../test/work/tasks-dialog.test.ts) | C | Tasks dialog and keyboard interaction |

## Additional execution and acceptance entries

B = Bun file caller; P = package-verifier caller; M = manual entry. B + P means reuse of an acceptance function,
not proof that scenarios, geometries, and inputs are identical. The name `real` does not imply a live model.

| Entry | Level | Current caller | Boundary |
| --- | --- | --- | --- |
| [verify-agents-execution-matrix](../../scripts/verify-agents-execution-matrix.ts) | S | B + P | Agent matrix; real Pi and fixture Provider |
| [verify-agents-pty](../../scripts/verify-agents-pty.ts) | S | B + P | Agent PTY and cold recovery |
| [verify-btw-pty](../../scripts/verify-btw-pty.ts) | S | B + P | BTW terminal journeys |
| [verify-code-mode-real](../../scripts/verify-code-mode-real.ts) | S | M: acceptance:code-mode:real | Real Pi/V8, fixture Provider, file/Skill reads and resume |
| [verify-code-mode-tui](../../scripts/verify-code-mode-tui.ts) | S | M: acceptance:code-mode:tui | Real Pi/V8 terminal media with fixture Provider |
| [verify-context-input-frame-pty](../../scripts/verify-context-input-frame-pty.ts) | S | B: context-pty | Real Pi and loopback Provider protocol |
| [verify-context-pty](../../scripts/verify-context-pty.ts) | S | B + P | Context terminal compaction/retry fixtures |
| [verify-goal-lifecycle](../../scripts/verify-goal-lifecycle.ts) | S | P | Standalone Pi RPC Goal lifecycle, fixture Provider |
| [verify-goal-pty](../../scripts/verify-goal-pty.ts) | S | B + P | Goal terminal dialog and settings |
| [verify-magic-context-real](../../scripts/verify-magic-context-real.ts) | S | M: acceptance:magic-context:real | Live model recall, compaction, resume, and isolation |
| [verify-mcp-pty](../../scripts/verify-mcp-pty.ts) | S | P | Real Pi terminal and local MCP fixtures |
| [verify-notification-pty](../../scripts/verify-notification-pty.ts) | S | P | Real Pi terminal notification journeys |
| [verify-package](../../scripts/verify-package.ts) | I/S | check; CI; M: pack:verify | Archive checks plus packed acceptance; helper assertions in B |
| [verify-pi-host-provenance](../../scripts/verify-pi-host-provenance.ts) | I | B; CI; callers | Artifact identity helper; not a product journey |
| [verify-pi-host-seams](../../scripts/verify-pi-host-seams.ts) | S | P; helper-only B | Real Pi protocol seams; B tests only JSONL polling helper |
| [verify-ponytail-pty](../../scripts/verify-ponytail-pty.ts) | S | B | Ponytail terminal and Provider prompt boundary |
| [verify-rtk-pty](../../scripts/verify-rtk-pty.ts) | S | P | Real Pi and installed RTK terminal integration |
| [verify-session-naming](../../scripts/verify-session-naming.ts) | S | B: session-naming/host | Real Pi naming and resume with fixture Provider |
| [verify-tools-grouping-pty](../../scripts/verify-tools-grouping-pty.ts) | S | B | Terminal retrieval grouping |
| [verify-tools-pty](../../scripts/verify-tools-pty.ts) | S | B + P | Tool terminal rendering and responsiveness |
| [verify-tools-resume-pty](../../scripts/verify-tools-resume-pty.ts) | S | B + P | Tool terminal resume |
| [verify-ui-pty](../../scripts/verify-ui-pty.ts) | S | B + P | UI journeys; Theme also uses shared session helpers |
| [verify-web-integration](../../scripts/verify-web-integration.ts) | C/I | P; M: direct script | Controlled Host; packed failure paths; direct execution enables public search/fetch |
| [verify-work-monitor-matrix](../../scripts/verify-work-monitor-matrix.ts) | S | B + P | Monitor success and failure with fixture Provider |
| [verify-work-pty](../../scripts/verify-work-pty.ts) | S | B + P | Background Work terminal journeys |
| [smoke-pi](../../scripts/smoke-pi.ts) | S | B + P | Real Pi RPC and controlled Package/Provider fixtures |
| [goal-runtime-smoke](../../test/goal-upstream/goal-runtime-smoke.mjs) | I | test:goal | Real Pi SDK Session with faux Provider; not standalone Pi binary acceptance |

`goal-runtime-budget.mjs` supplies budget scenarios called by this smoke; `goal-runtime-support.mjs` supplies its SDK harness.

## Two benchmark categories and existing entries

Use internal performance and external task benchmarks. Three existing self-authored model studies mix correctness
and task outcomes; explain them before deciding placement. Pending placement is not a third category. Repository
location does not determine their purpose.

| Command | Placement | Current execution | Measurement and cost |
| --- | --- | --- | --- |
| [benchmark:tool-activity](../../scripts/benchmark-tool-activity.ts) | Internal | check; CI | Synthetic grouping, streaming, formatting; no model |
| [benchmark:magic-context](../../scripts/benchmark-magic-context.ts) | Internal | M | Worker and projection costs; no model |
| [benchmark:magic-context:compare](../../scripts/compare-magic-context.ts) | Internal | M | Two-revision Magic Context comparison; no model |
| [benchmark:lifecycle](../../scripts/benchmark-lifecycle.ts) | Internal | M | Real Pi/PTY latency, fixture Provider |
| [benchmark:effect-mainline](../../scripts/benchmark-effect-mainline.ts) | Internal | M | Import CPU/RSS and optional lifecycle; no paid model |
| [benchmark:conversation-markdown](../../scripts/benchmark-conversation-markdown.ts) | Internal | M | TUI rendering on synthetic input; no model |
| [benchmark:ponytail](../../scripts/benchmark-ponytail.ts) | Pending placement | M | 18 live-model Sessions; self-authored tasks |
| [benchmark:skill-discovery](../../scripts/benchmark-skill-discovery.ts) | Pending placement | M | 90 live-model Sessions; discovery and outcomes |
| [benchmark:code-mode-image](../../scripts/benchmark-code-mode-image.ts) | Pending placement | M | 40 live-model cases plus possible resume calls; transport and recognition |

External task entries: FrontierHarness Eval is not integrated yet; the Terminal-Bench execution adapter is archived
in Git history. Public and repository historical results can be reused without rerunning them to build this overview.
See the [FrontierHarness study](frontierharness-eval-fit-20260905.md) and
[Terminal-Bench evidence](../reports/ps-ps3-capability-contract-and-terminal-bench-observation-2026-08-30.md).

## Static gates and execution infrastructure

- [scripts/run-isolated-tests.ts](../../scripts/run-isolated-tests.ts): Bun test discovery and serial isolation.
- [scripts/test-goal-upstream.ts](../../scripts/test-goal-upstream.ts): Goal compilation, Node execution, and SDK smoke.
- [scripts/ci-acceptance-scope.ts](../../scripts/ci-acceptance-scope.ts): Changed-path routing, not behavior acceptance.
- [scripts/check-repository-safety.ts](../../scripts/check-repository-safety.ts): Repository safety, source boundaries, and size checks.
- [scripts/check-capability-contract-catalog.ts](../../scripts/check-capability-contract-catalog.ts): Catalog structure; does not execute contracts.
- [scripts/generate-suite.ts](../../scripts/generate-suite.ts): Composition generation; --check detects drift.
- [scripts/check-readme-screenshots.ts](../../scripts/check-readme-screenshots.ts): Documentation screenshot check, outside default package scripts.
- [scripts/review-ponytail-upstream.ts](../../scripts/review-ponytail-upstream.ts): Upstream resource review command.
- [scripts/pi-host-contract.ts](../../scripts/pi-host-contract.ts): Shared Host declaration and upstream-watch input.
- [.github/workflows/ci.yml](../../.github/workflows/ci.yml): Fast plus conditional Acceptance; commands are not extra test suites.
- [.github/workflows/pi-upstream-watch.yml](../../.github/workflows/pi-upstream-watch.yml): Scheduled upstream version observation; not compatibility acceptance.

`format:check`, `lint`, `typecheck`, and `knip` are static quality gates. Their fixture tests are already listed
in the file inventory. `pack:verify` combines artifact checks and dynamic acceptance and is not wholly static.
Beads publication is not a test entry.

## Conditional execution and classification evidence

- [test/code-mode/v8-real.test.ts](../../test/code-mode/v8-real.test.ts): Requires PI_STUFF_CODE_MODE_REAL=1. Real V8 plus fixture tools is I, not live-model E2E. CI does not set this switch.
- [test/rtk/real-rtk.test.ts](../../test/rtk/real-rtk.test.ts): Skips when the expected RTK executable is unavailable. Inventory inclusion is not evidence of execution.
- [test/code-mode/process-start-identity.test.ts](../../test/code-mode/process-start-identity.test.ts): Readers and command runners are injected; OS-looking paths do not prove real process integration.
- [test/context/native-custom-turn-compaction-host-seam.test.ts](../../test/context/native-custom-turn-compaction-host-seam.test.ts): Uses createAgentSession from the real SDK with a faux Provider: I.
- [test/agents/background-engine-fixtures.ts](../../test/agents/background-engine-fixtures.ts): Background tests substitute fixture writers for PI_SUBAGENT_PI_BINARY: real process I.
- [test/agents/extension-root-fixtures.ts](../../test/agents/extension-root-fixtures.ts): Registers Agents with createExtensionApi and controlled dependencies; not assembled-Suite S.
- [test/goal-upstream/goal.node.ts](../../test/goal-upstream/goal.node.ts): Uses createMockPi and createMockContext; registration is not real-Host S.
- [test/mcp/http-transport.test.ts](../../test/mcp/http-transport.test.ts): Bun.serve supplies a real loopback HTTP server; the transport is I.
- [scripts/verify-web-integration.ts](../../scripts/verify-web-integration.ts): Packed invocation does not enable publicNetwork; direct execution does. Both use a controlled Host.

## Complete support-file inventory

These are not additional independent test entries. Shell runners and MJS scenarios are invoked by the entries above;
JSON/JSONL files contain inputs or historical run metadata. Listing them prevents overlooking indirect dependencies.

- [test/agents/agent-effect-owner-fixture.ts](../../test/agents/agent-effect-owner-fixture.ts)
- [test/agents/agent-execution-coordinator-fixtures.ts](../../test/agents/agent-execution-coordinator-fixtures.ts)
- [test/agents/background-engine-fixtures.ts](../../test/agents/background-engine-fixtures.ts)
- [test/agents/current-agents-fixtures.ts](../../test/agents/current-agents-fixtures.ts)
- [test/agents/extension-root-fixtures.ts](../../test/agents/extension-root-fixtures.ts)
- [test/agents/fixtures/context-usage-provider.ts](../../test/agents/fixtures/context-usage-provider.ts)
- [test/agents/fixtures/process-controls-provider.ts](../../test/agents/fixtures/process-controls-provider.ts)
- [test/agents/foreground-engine-fixtures.ts](../../test/agents/foreground-engine-fixtures.ts)
- [test/agents/native-supervisor-channel-fixtures.ts](../../test/agents/native-supervisor-channel-fixtures.ts)
- [test/agents/result-watcher-fixtures.ts](../../test/agents/result-watcher-fixtures.ts)
- [test/agents/tool-presentation-fixtures.ts](../../test/agents/tool-presentation-fixtures.ts)
- [test/code-mode/fixtures.ts](../../test/code-mode/fixtures.ts)
- [test/context/core-fixtures.ts](../../test/context/core-fixtures.ts)
- [test/fixtures/agents-execution-matrix-provider.ts](../../test/fixtures/agents-execution-matrix-provider.ts)
- [test/fixtures/agents-pty-provider.ts](../../test/fixtures/agents-pty-provider.ts)
- [test/fixtures/agents-pty-runner.sh](../../test/fixtures/agents-pty-runner.sh)
- [test/fixtures/assert-codex-tools.ts](../../test/fixtures/assert-codex-tools.ts)
- [test/fixtures/assert-goal-tools.ts](../../test/fixtures/assert-goal-tools.ts)
- [test/fixtures/assert-mcp-tools.ts](../../test/fixtures/assert-mcp-tools.ts)
- [test/fixtures/assert-todo-tools.ts](../../test/fixtures/assert-todo-tools.ts)
- [test/fixtures/assert-web-tools.ts](../../test/fixtures/assert-web-tools.ts)
- [test/fixtures/assert-work-tools.ts](../../test/fixtures/assert-work-tools.ts)
- [test/fixtures/btw-pty-provider.ts](../../test/fixtures/btw-pty-provider.ts)
- [test/fixtures/btw-pty-runner.sh](../../test/fixtures/btw-pty-runner.sh)
- [test/fixtures/code-mode-image-benchmark-observer.ts](../../test/fixtures/code-mode-image-benchmark-observer.ts)
- [test/fixtures/code-mode-provider.ts](../../test/fixtures/code-mode-provider.ts)
- [test/fixtures/context-pty-provider.ts](../../test/fixtures/context-pty-provider.ts)
- [test/fixtures/context-pty-runner.sh](../../test/fixtures/context-pty-runner.sh)
- [test/fixtures/detached-process-parent.mjs](../../test/fixtures/detached-process-parent.mjs)
- [test/fixtures/extension-api.ts](../../test/fixtures/extension-api.ts)
- [test/fixtures/extension-context.ts](../../test/fixtures/extension-context.ts)
- [test/fixtures/faux-provider.ts](../../test/fixtures/faux-provider.ts)
- [test/fixtures/goal-lifecycle-provider.ts](../../test/fixtures/goal-lifecycle-provider.ts)
- [test/fixtures/goal-pty-runner.sh](../../test/fixtures/goal-pty-runner.sh)
- [test/fixtures/magic-context-real-audit.ts](../../test/fixtures/magic-context-real-audit.ts)
- [test/fixtures/mcp-pty-provider.ts](../../test/fixtures/mcp-pty-provider.ts)
- [test/fixtures/mcp-pty-runner.sh](../../test/fixtures/mcp-pty-runner.sh)
- [test/fixtures/mcp/http-server.mjs](../../test/fixtures/mcp/http-server.mjs)
- [test/fixtures/mcp/stdio-server.mjs](../../test/fixtures/mcp/stdio-server.mjs)
- [test/fixtures/notification-pty-provider.ts](../../test/fixtures/notification-pty-provider.ts)
- [test/fixtures/notification-pty-runner.sh](../../test/fixtures/notification-pty-runner.sh)
- [test/fixtures/pi-host-seams-provider.ts](../../test/fixtures/pi-host-seams-provider.ts)
- [test/fixtures/ponytail-benchmark-observer.ts](../../test/fixtures/ponytail-benchmark-observer.ts)
- [test/fixtures/ponytail-pty-provider.ts](../../test/fixtures/ponytail-pty-provider.ts)
- [test/fixtures/ponytail-pty-runner.sh](../../test/fixtures/ponytail-pty-runner.sh)
- [test/fixtures/rtk-pty-provider.ts](../../test/fixtures/rtk-pty-provider.ts)
- [test/fixtures/rtk-pty-runner.sh](../../test/fixtures/rtk-pty-runner.sh)
- [test/fixtures/session-naming-provider.ts](../../test/fixtures/session-naming-provider.ts)
- [test/fixtures/skill-discovery-benchmark-manifest.jsonl](../../test/fixtures/skill-discovery-benchmark-manifest.jsonl)
- [test/fixtures/skill-discovery-benchmark-observer.ts](../../test/fixtures/skill-discovery-benchmark-observer.ts)
- [test/fixtures/skill-discovery-benchmark-run-lock.json](../../test/fixtures/skill-discovery-benchmark-run-lock.json)
- [test/fixtures/skill-discovery-confirmation-manifest.jsonl](../../test/fixtures/skill-discovery-confirmation-manifest.jsonl)
- [test/fixtures/skill-discovery-confirmation-run-lock.json](../../test/fixtures/skill-discovery-confirmation-run-lock.json)
- [test/fixtures/skill-discovery-direct-read-manifest.jsonl](../../test/fixtures/skill-discovery-direct-read-manifest.jsonl)
- [test/fixtures/skill-discovery-direct-read-run-lock.json](../../test/fixtures/skill-discovery-direct-read-run-lock.json)
- [test/fixtures/skill-discovery-isolated-confirmation-manifest.jsonl](../../test/fixtures/skill-discovery-isolated-confirmation-manifest.jsonl)
- [test/fixtures/skill-discovery-isolated-confirmation-run-lock.json](../../test/fixtures/skill-discovery-isolated-confirmation-run-lock.json)
- [test/fixtures/skill-discovery-startup-bounded-confirmation-manifest.jsonl](../../test/fixtures/skill-discovery-startup-bounded-confirmation-manifest.jsonl)
- [test/fixtures/skill-discovery-startup-bounded-confirmation-run-lock.json](../../test/fixtures/skill-discovery-startup-bounded-confirmation-run-lock.json)
- [test/fixtures/smoke-extension.ts](../../test/fixtures/smoke-extension.ts)
- [test/fixtures/smoke-package/index.ts](../../test/fixtures/smoke-package/index.ts)
- [test/fixtures/smoke-package/package.json](../../test/fixtures/smoke-package/package.json)
- [test/fixtures/terminal.ts](../../test/fixtures/terminal.ts)
- [test/fixtures/test-tui.ts](../../test/fixtures/test-tui.ts)
- [test/fixtures/tool-registration-host.ts](../../test/fixtures/tool-registration-host.ts)
- [test/fixtures/tools-active-parity-runner.sh](../../test/fixtures/tools-active-parity-runner.sh)
- [test/fixtures/tools-grouping-pty-provider.ts](../../test/fixtures/tools-grouping-pty-provider.ts)
- [test/fixtures/tools-grouping-pty-runner.sh](../../test/fixtures/tools-grouping-pty-runner.sh)
- [test/fixtures/tools-pty-provider.ts](../../test/fixtures/tools-pty-provider.ts)
- [test/fixtures/tools-pty-runner.sh](../../test/fixtures/tools-pty-runner.sh)
- [test/fixtures/tools-resume-pty-provider.ts](../../test/fixtures/tools-resume-pty-provider.ts)
- [test/fixtures/tools-resume-pty-runner.sh](../../test/fixtures/tools-resume-pty-runner.sh)
- [test/fixtures/ui-pty-provider.ts](../../test/fixtures/ui-pty-provider.ts)
- [test/fixtures/ui-pty-runner.sh](../../test/fixtures/ui-pty-runner.sh)
- [test/fixtures/ui-pty-watchdog-owner.ts](../../test/fixtures/ui-pty-watchdog-owner.ts)
- [test/fixtures/work-monitor-matrix-provider.ts](../../test/fixtures/work-monitor-matrix-provider.ts)
- [test/fixtures/work-pty-provider.ts](../../test/fixtures/work-pty-provider.ts)
- [test/fixtures/work-pty-runner.sh](../../test/fixtures/work-pty-runner.sh)
- [test/fixtures/work-supervisor-parent.mjs](../../test/fixtures/work-supervisor-parent.mjs)
- [test/goal-upstream/goal-queue-support.ts](../../test/goal-upstream/goal-queue-support.ts)
- [test/goal-upstream/goal-run-support.ts](../../test/goal-upstream/goal-run-support.ts)
- [test/goal-upstream/goal-runtime-budget.mjs](../../test/goal-upstream/goal-runtime-budget.mjs)
- [test/goal-upstream/goal-runtime-support.mjs](../../test/goal-upstream/goal-runtime-support.mjs)
- [test/goal-upstream/goal-test-support.ts](../../test/goal-upstream/goal-test-support.ts)
- [test/goal-upstream/support.ts](../../test/goal-upstream/support.ts)
- [test/goal-upstream/ui-node-shim.ts](../../test/goal-upstream/ui-node-shim.ts)
- [test/tools/contract-fixtures.ts](../../test/tools/contract-fixtures.ts)
- [test/ui/command-dialog-coordinator-fixtures.ts](../../test/ui/command-dialog-coordinator-fixtures.ts)
- [test/ui/settings-lock-race-worker.ts](../../test/ui/settings-lock-race-worker.ts)
- [test/ui/statusline-fixtures.ts](../../test/ui/statusline-fixtures.ts)
- [test/work/runtime-fixtures.ts](../../test/work/runtime-fixtures.ts)

## Next review boundary

Resolve the files marked `?` and identify cases inside mixed files before routing them. Then establish retain, combine,
replace, or delete evidence for overlapping behavior. Inspect source-string assertions, fixed sleeps, repeated source
and packed journeys, and conditionally skipped dependencies. This inventory adds no test framework, automatic
classifier, or second contract catalog, and changes no current checks.
