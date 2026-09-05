---
status: proposed
---

# Organize test evidence and release gates

Pi Stuff needs understandable unit, component, integration, and system tests, meaningful E2E and benchmark evidence,
and shorter development and pull-request feedback. This document records the agreed scope and the open design
interview. It does not change the current checks or authorize an unreviewed reduction in acceptance coverage.

## Agreed scope

- Organize tests by four execution boundaries: unit, component, integration, and system.
- Remove redundant or ineffective tests and replace weak assertions while preserving meaningful behavior evidence.
- Define E2E and benchmark responsibilities explicitly, including their relationship to packaging and PR merging.
- Reduce waiting using measured costs; neither file counts nor a deletion percentage is the acceptance target.
- Do not require duplicate local and CI full runs. The exact evidence authority and invalidation rules remain to be
  specified.
- Adopt feedback targets of at most 30 seconds for focused tests, 2 minutes for routine pre-submission checks, and
  10 minutes for required PR checks, with shorter times preferred. These are optimization objectives, not measured
  results; PR timing includes environment preparation and excludes runner queue time.
- Retain both deterministic E2E with a controlled Provider and live-provider/service E2E, with separate execution and
  honest evidence reports.
- E2E and benchmark execution are low-frequency activities, separate from routine development checks. Ordinary PRs
  run all unit, component, and integration tests. Relevant high-risk PRs add targeted E2E; formal release
  candidates require complete deterministic E2E. Explicit validation or key external dependency changes trigger
  relevant live-service E2E. Development archive creation performs package structure checks without implicitly
  launching the complete E2E suite. Performance work and important version evaluations can request benchmarks.
- Benchmarks use existing external task sets and evaluation frameworks. FrontierHarness Eval is the user's initial
  candidate; its final adoption, experimental protocol, and execution budget are not yet decided. Existing internal
  performance checks need a separate retention decision, after explaining their purpose and retained results.
- Cost is a primary constraint for this personal-use project. Compare stored public benchmark data, including
  FrontierHarness Eval, and multiple historical Pi Stuff runs. Do not require a fresh plain-Pi control. Record
  differing task sets, models, versions, and environments alongside comparisons; missing data does not require reruns.

The working definitions from the discussion are:

| Level | Boundary |
| --- | --- |
| Unit | One isolated rule, transformation, or algorithm |
| Component | One Module through its interface, with its own implementation present and external collaborators controlled |
| Integration | An actual connection between Modules, infrastructure, executables, or the Pi Host |
| System | The assembled product exercised through its external entry points |

These are general testing terms and do not need new glossary entries in `CONTEXT.md`. Provider authenticity, resource
isolation, cost, and execution frequency are separate properties; they must not be inferred from a test's filename.

## Investigation evidence, 2026-09-05

Source snapshot: `2610bd4299ecb76b29094587a28dd5af5f020c27`, with the current Pi 0.85.0 compatibility profile.
Tracked test Source contains 292 Bun test files, 21 Goal Node test files, and supporting Source. Counting tracked
`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, and `.cjs` files yields 380 files and 88,664 physical lines under `test/`.
Support files are not additional executable test cases. Inventory and boundary inspection are not a completed
assertion-by-assertion deletion review or a current-version test run.

The latest successful PR CI run inspected was
[33839062989](https://github.com/jczhang02/pi-stuff/actions/runs/33839062989), on 2026-09-04 at
`c9524bc7c66620fd8a585f24cd2a9f9d12edc7b3`. It used Pi 0.84.4 and 286 Bun test files. Its timings locate structural
costs but do not certify, or predict exact performance for, the current source and Host.

| Stage | Observed elapsed time |
| --- | --- |
| Fast job | 1 minute 28 seconds |
| Acceptance job, including setup | 29 minutes 13 seconds |
| Isolated Bun test phase | Approximately 18 minutes 13 seconds |
| Goal compilation and tests | Approximately 1 minute 17 seconds |
| Tool Activity benchmark | Approximately 0.9 seconds |
| Package verification | Approximately 9 minutes 22 seconds |

The nine slowest Host/PTY files in that run account for approximately 11 minutes 40 seconds of the isolated phase:
Agents PTY, Agents execution matrix, Tools PTY, Context PTY, UI PTY, Tools grouping PTY, BTW PTY, Tools resume PTY, and
Theme PTY. These are measured file durations, not configured timeouts.

Verified structural findings:

1. [The isolated runner](../../scripts/run-isolated-tests.ts) launches each file serially with `Bun.spawnSync`.
   Per-file process isolation and global serialization are distinct choices. `bun test --timeout 30000` is a default
   per-test timeout, not a process or file wall-time limit; individual tests override it.
2. [The full check](../../package.json) runs all tests and then [package verification](../../scripts/verify-package.ts).
   The latter invokes 17 verification functions sequentially against the extracted Package. Many Host and PTY
   journeys therefore execute in both source and packed form, sometimes with different scenarios or geometries.
3. Packed verification links the source Package's `node_modules` into the extracted Package. It validates packed
   resources, but does not independently prove a clean dependency installation.
4. [CI](../../.github/workflows/ci.yml) waits for Fast before Acceptance, has no test shard matrix, and does not reuse a
   certified package artifact between jobs. [Repository instructions](../../AGENTS.md) also require a local full
   check before a PR is ready or merged; changing that duplication requires an explicit workflow decision.
5. CI installs a Code Mode host, but [real V8 tests](../../test/code-mode/v8-real.test.ts) require
   `PI_STUFF_CODE_MODE_REAL=1`, which the workflow does not set. The separate real Code Mode acceptance commands also
   remain outside the default check. Installing the executable is not equivalent to running those tests.
6. Packed verification does not explicitly invoke every dedicated source journey, including Tools grouping, Context
   input-frame, and the dedicated Theme and User Message checks. Consolidation must preserve those obligations.
7. [Retrieval tests](../../test/tools/contract-retrieval-core.test.ts) spend 2.17 seconds in four fixed sleeps, while
   [the runtime](../../packages/pi-stuff/src/tool-display/contract.ts) already accepts a clock. This is a candidate
   for deterministic synchronization, not deletion of the 700-millisecond behavior contract.
8. [Generated connector source assertions](../../test/code-mode/connector.test.ts) depend on internal variable names
   and exact source fragments. Behavioral replacement is needed before deleting unique coverage. Conversely, the
   [769-call test](../../test/code-mode/delegate-runtime.test.ts) crosses the real 768-trace retention bound and
   protects continued execution; its size alone does not justify removal.
9. [The contract catalog](../capability-contract-catalog.md) keeps current entries pending and includes live Provider
   and Service evidence profiles. Its structural checker does not execute or certify those contracts. Offline CI
   cannot satisfy all live profiles, regardless of its duration.
10. The acceptance scope classifier exempts root Markdown and selected `docs/` suffixes. Compatibility prose promises
    acceptance for executable documentation. The redesign must reconcile the executable policy and its description.

The [framework overview](../research/test-framework-inventory-20260905.md) accounts for all 313 test files,
the additional runtime smoke, acceptance and benchmark entries, static gates, and support files. Pending file-level
assignments are explicit; the inventory does not itself authorize deletion or migration.

## Benchmark inventory

| Existing entry | Evidence produced | Current default check |
| --- | --- | --- |
| `benchmark:tool-activity` | Synthetic planning, streaming, formatting, and integrity performance | Required |
| `benchmark:magic-context`, `benchmark:magic-context:compare` | Worker, projection, snapshot, import, and paired performance | Manual |
| `benchmark:lifecycle` | Real Host startup, reload, interruption, shutdown, and response latency with fixture Provider | Manual |
| `benchmark:effect-mainline` | Paired import/resource and optional lifecycle comparison | Manual |
| `benchmark:conversation-markdown` | Paired ordinary-path and visualization rendering performance | Manual |
| `benchmark:ponytail` | Live-model task outcomes and code/token/tool-use trade-offs | Manual |
| `benchmark:skill-discovery` | Live-model discovery correctness, task outcomes, and overhead | Manual |
| `benchmark:code-mode-image` | Live-model image-task outcomes plus transfer/persistence correctness | Manual |
| Retained Terminal-Bench study | Historical paired external-task outcomes and elapsed time | Dated evidence only |

Tests of benchmark fixture construction, statistics, and result classification are correctness tests of the harness;
passing them is not a new benchmark measurement. Current live-model studies do not replace the glossary's
Suite Outcome Evaluation on an external public task set or Capability Contract Acceptance.

Benchmarks use two categories: internal performance and external tasks. Existing self-authored model studies
still need their correctness and outcome measurements reviewed for placement. This creates no third category and
requires no fresh historical control.

## Design tree

The following decisions remain open. Recommendations in the interview are proposals, not accepted policy.

Interview decisions to date:

- Duplicate local and CI full runs are unnecessary.
- The proposed feedback targets are accepted, with a preference for shorter waits.
- Both E2E evidence types are retained. The low-frequency trigger arrangement in the agreed scope is accepted.
- Benchmark means using existing external benchmarks, with FrontierHarness Eval proposed as the first candidate.
  This replaces the earlier open question about inventing a combined internal-performance and model-task benchmark.

### Concrete E2E examples

Deterministic full-product evidence uses real product execution with a controlled Provider. Existing examples include
[Code Mode acceptance](../../scripts/verify-code-mode-real.ts): launch the real Pi and Suite, use a fixture Provider
to request actual Code Mode execution, read a temporary project's `package.json`, discover and read a Skill, verify
the returned values and Provider Tool surface, and restart with the saved Session. The Provider response is scripted;
the execution and persistence under test are not. The filename's `real` refers to executable boundaries and does not
claim live-model use.

[UI acceptance](../../test/ui-pty.test.ts) drives the actual terminal through settings changes, window resizing, and
restart persistence. This can validate a user journey without asking a live model to decide which keys to press.
The current package verifier runs many such journeys against extracted Package Source; making all chosen E2E consume
the intended package artifact and verifying clean installation remain design work.

Live-provider evidence extends the product journey into the external service. Existing
[Magic Context acceptance](../../scripts/verify-magic-context-real.ts) explicitly enables real Provider calls. Its
[scenario](../../scripts/magic-context-real-scenario.ts) records a random recall marker and a pending Todo, drives
long-context processing, asks the model to retrieve the marker and Todo after compaction and cold resume, and checks
that another project cannot retrieve the first project's marker. This tests live-service behavior and model
instruction-following as well as Suite execution, so cost and variability differ from deterministic evidence.
These are descriptions of existing scripts, not claims of a fresh successful run.

Current frontier:

1. The minimal report for comparing stored public and Pi Stuff results. The
   [FrontierHarness investigation](../research/frontierharness-eval-fit-20260905.md) records task scope, runner
   requirements, and comparability constraints. Historical comparison is accepted; a new control run is not required.
2. Retention and placement of existing internal performance tests and experimental benchmark scripts after adopting
   an external benchmark workflow.
Ordinary PRs run the complete first three levels. This selection decision is settled.

Later frontiers, after their prerequisites are settled:

- Concrete selection for each accepted trigger and the fallback for unknown change scope; define which exact
  candidate or merge result the evidence certifies and how a qualifying result is reused without mandatory local/CI
  duplication.
- E2E journey and failure/recovery coverage, clean installation, package artifact identity, and conditional dependency
  failures without silently passing skipped contracts.
- Physical organization, mixed-level files, process isolation, bounded parallelism, timing-sensitive resource
  isolation, cancellation, process wall-time guards, and useful failure artifacts.
- External benchmark version, comparison arms, model/Provider, effective Suite configuration, runtime, smoke/formal
  separation, samples, spending/time bounds, result completeness, and the consequences of a regression.
- Migration stages and retain/replace/delete evidence for every affected test; update current workflow documents,
  mirrors, and catalog links together, then obtain fresh timings and complete the required final review.

Implementation begins after the design interview reaches shared understanding. Current gates remain in force until
the corresponding workflow change is accepted and implemented.
