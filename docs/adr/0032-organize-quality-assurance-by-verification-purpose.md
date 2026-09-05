---
status: accepted
---

# Organize quality assurance by verification purpose

## Context

The quality-assurance design interview started on 2026-09-05 to address unclear test organization, long pull-request
feedback, redundant verification, and repeated investigation of failures. The overall architecture was accepted on 2026-09-05.
This ADR defines the migration target; current checks and certification policy remain in force until migrated.

## Decision

### Agreed constraints

- Cover requirements and design through implementation, installation, upgrade, release acceptance, and regression
  verification of problems found in use. Operational problems supply evidence without requiring a monitoring platform.
- Organize activities into Static Checks, Tests, Benchmarks, and Reviews by their primary purpose. Keep documentation,
  directories, commands, and result reporting consistent with that organization; share supporting code and evidence
  instead of duplicating a scenario merely to populate categories.
- Schedule verification according to change risk and cost. Before merge, establish changed behavior and the absence of
  regressions in the relevant critical public contracts. Complete Agent task-outcome benchmarks may run on demand;
  expensive verification may run for relevant changes, periodically, or before release. Unverified behavior must remain
  explicit and must never be reported as passed.

### Agreed organization and coverage

- Tests use five levels: Component (Unit), Component Integration, System, System Integration, and Acceptance.
  Within a level, organize by Capability and scenario. Do not invent tests for empty categories; acceptance may reuse
  existing evidence, and each scenario has one primary home.
- For system testing, the system under test is the real Pi Host with the complete Suite loaded. Model services, MCP
  services, and external tools are external dependencies. System integration targets actual interoperability with those
  dependencies. Host interface compatibility may be checked separately; merely launching Pi does not classify a test.
- Tests verify explicit behavior and performance requirements; Benchmarks independently measure and compare results.
  Software performance measurement may belong to a Capability Benchmark and is not automatically moved into Tests.
  Whether the existing 200 ms spinner limit is a justified requirement remains to be established; measurement alone
  does not create a blocking requirement.
- Static Checks cover formatting, lint, types, dependencies, architecture, generated output, package structure, and
  code-vulnerability, dependency-vulnerability, and credential-leak scanning. Reuse existing tools first; adding a scanner
  requires an explicit target and evidence of usefulness.
- Each Capability identifies applicable normal, error, cancellation, recovery, persistence, and resource-cleanup
  behavior. Assign primary coverage at the appropriate level; higher levels add actual connection and complete-flow
  evidence without mechanically repeating every lower-level scenario.
- Benchmarks have two branches by evaluation scope: Capability Benchmark and Suite Outcome Evaluation, defined below.
  Both run independently and neither has authority to block PRs.
- Reviews cover requirements, architecture, code, security, test effectiveness, and evaluation methodology. Reviewers
  examine redundant assertions and implementation coupling. Ordinary changes receive scoped review; cross-Capability
  and architecture changes receive independent review. Existing Thermo-Nuclear review requirements remain applicable,
  with test quality explicitly in scope.

### Benchmark scope

- **Capability Benchmark** evaluates one Capability or a limited group of Capabilities for performance, resource use,
  or behavioral effectiveness. Examples include Ponytail, Skill Discovery, and Code Mode evaluations. A specialized
  question remains in this branch even if its execution uses the complete Host or borrows public tasks.
- **Suite Outcome Evaluation** evaluates the complete Suite on a public task set, following the overall task-evaluation
  approach illustrated by [FrontierHarness Eval](https://runta.com/blog/introducing-frontierharness-eval/). Report task
  completion, result quality, token usage, cost, and elapsed time. Terminal-Bench is an example task set; whole-system
  evaluation does not imply that the chosen tasks cover every Capability.

Comparison targets do not determine the branch. Either may compare native Pi with Pi Stuff, repository versions, or
Capability configurations. Hold non-varied conditions fixed in a controlled comparison and state any differences that
limit attribution. Prefer native Pi versus the complete Suite for a Suite-delta question; use Capability ablations when
attribution is needed. Benchmark task verifiers score outcomes, not individual Capability Contract Acceptance.

Existing software performance and specialized behavior benchmarks must be classified by their actual evaluation scope,
not moved wholesale into Tests. This decision does not restore historical public-task runners or claim current runnable
coverage from retained reports alone.

### Source installation and performance requirements

- Pi Stuff is installed from a repository checkout through `pi install ./packages/pi-stuff`; a Pi Package is a resource
  organization unit, not a requirement to produce a distribution archive. Acceptance targets the selected repository
  revision and its documented installation, loading, reload, and observable behavior in an isolated environment.
- Archive creation and extraction in the existing verifier are implementation choices to review for removal or
  replacement. Preserve valuable real-Host verification when changing that path. Acceptance is scheduled on demand
  without requiring packaging or a separate release pipeline.
- Audit existing performance thresholds for their requirement source, measurement stability, and applicable environment
  before deciding whether each justifies a blocking performance test or belongs to a non-blocking Capability Benchmark.
  Do not silently delete uncertain thresholds or change product code merely to satisfy an unexplained limit.
- Repeated failures require distinguishing unstable outcomes from root causes. A defective test, product defect, or
  environment problem can each cause repeated failures; flakiness alone does not identify which is responsible. The
  agreed repair and deletion policy is recorded below.

### Agreed execution and failure policy

- Use development, pre-merge PR, and periodic/on-demand execution plans. Full installation and runtime acceptance of
  a selected source revision is on demand; no separate release-stage pipeline is currently required.
- Diagnose repeated failures before acting: repair defective tests, repair product defects with valid regression
  protection, or repair/report blocked environments. Preserve evidence for intermittent failures of unknown cause;
  a passing retry alone does not resolve them. Reuse applicable recorded diagnoses instead of restarting investigation.
- Delete tests that cannot be repaired instead of introducing a temporary-quarantine workflow. Deletion does not imply
  that the tested behavior passed; preserve valid critical behavior according to the retention criteria below.
- Ordinary PRs may select affected dynamic tests conservatively. Capability-local changes cover the owning Module and
  related interactions; shared infrastructure, Suite composition, Host versions, and test-infrastructure changes expand
  to the complete applicable suite. Unknown impact falls back to the full suite rather than directory-only guesses.
- Benchmarks run independently and have no authority to block PRs. Performance tests within Tests may block when they
  verify explicit performance requirements. Benchmark results remain evaluation evidence rather than PR gates.

### Agreed test retention criteria

- Preserve valid critical behavior when deleting its only test: use a simpler reliable test or reuse suitable integration
  or acceptance evidence. Correct an invalid requirement rather than recreating a defective test. Deletion is never
  evidence that the behavior passed.
- Retain tests for independent defect-detection value, not test counts, coverage percentages, or layer ratios. Prioritize
  duplicate assertions, obsolete scenarios, and checks that merely freeze private implementation shape for removal or
  revision. Similar flows at different levels remain justified when they detect different defects.

### Command responsibilities

- `bun run check` owns all Static Checks; `bun run test` owns dynamic Tests; `bun run benchmark:...` owns independent
  Benchmarks. `bun run verify` combines Static Checks with conservatively selected dynamic Tests for daily verification
  and never invokes Benchmarks. Reviews remain a review process rather than an empty symmetry-driven command.
- Tests expose five stable level entries: `test:unit`, `test:component-integration`, `test:system`,
  `test:system-integration`, and `test:acceptance`. Capability, file, and test-name selection refine these entries;
  do not create a command for every combination of Capability and level.
- Ordinary `check`, `test`, and `verify` execution is offline, credential-free, and makes no live model calls. It may
  require real local Pi, RTK, or PTY tools. Live model and external-Service verification require explicit selection
  and environment preflight, rather than an ambiguous `real` label determining whether calls occur.
- This migration organizes existing checks and Capability Benchmarks. Record the Suite Outcome Evaluation interface
  boundary, but implement its public-task runner as separate work; do not expose an empty command or treat historical
  reports as a runnable evaluation.

### Default scope and command discovery

- With no arguments, `bun run test` runs all applicable offline dynamic Tests across the five levels, excluding Static
  Checks, Benchmarks, and live services. Use level or Capability selection for focused development.
- `verify` uses the PR target comparison base in CI and the merge base with `origin/main` locally, including staged,
  unstaged, and untracked changes. Allow `--base <ref>` to override the base. Display the base and selected scope before
  execution. Missing bases, uncertain impact, or a clean main branch without selectable changes fall back to the complete
  applicable test suite.
- Repository test, verification, and benchmark entry points provide `--help` without executing work and `--list` to
  preview selected checks or scenarios and their environment requirements. Unknown arguments and explicit selections
  matching nothing fail visibly. Before execution, summarize scope, network/model use, and report location.
- Extend existing scripts only as needed for this interface; do not introduce a generic CLI framework.

### Naming, mutation, and result conventions

- Name specialized benchmark commands `benchmark:capability:<name>`. Reserve `benchmark:suite` for the later public-task
  runner without registering a placeholder. Require an explicit evaluation target; no default command starts every live
  model benchmark.
- `check` and `verify` do not rewrite source, configuration, snapshots, or expected results. An explicit `fix` command
  performs formatting and safe lint fixes; generated composition and snapshot updates remain separate explicit actions.
  Logs, caches, and reports may be written during verification.
- Use concise terminal summaries with detailed local evidence where needed, reusing native reporters rather than
  introducing a reporting framework. Report the actual scope, pass/failure/not-run status, elapsed time, and evidence
  paths. Default generated reports to ignored `.artifacts/`, with explicit output overrides; do not automatically replace
  retained research reports under `docs/reports/`.
- Checks and Tests return nonzero for unmet requirements or missing required environments, with distinguishable
  diagnostics. Benchmarks return success for a completed valid experiment even when measured outcomes are poor;
  experiment setup errors, runner crashes, and incomplete required data return nonzero. A task failure or timeout scored
  by the declared protocol is a valid outcome, not automatically an incomplete experiment. Neither benchmark exit status
  nor measured outcomes acquire PR-blocking authority.
- Use explicit `bun run <script>` for repository workflows; `bun test` remains the native focused-testing tool and does
  not imply execution of repository orchestration. Use Bun's script listing and native filtering/reporters where they
  satisfy the agreed interface. Remove redundant script aliases when migrating all callers and documentation together.

### Public practice references

The exact names above are repository conventions, not a universal software-testing standard. Reviewed on 2026-09-05:

- [VS Code scripts](https://github.com/microsoft/vscode/blob/main/package.json) expose distinct test environments and
  performance entries, illustrating explicit responsibilities rather than a single indiscriminate runner.
- [Vite scripts](https://github.com/vitejs/vite/blob/main/package.json) provide named project workflows; adopt consistent
  namespaces here without copying unrelated build or publication commands.
- [Biome CLI](https://biomejs.dev/reference/cli/) makes writes explicit with `--write`; preserve that distinction between
  verification and repair.
- [Bun runtime](https://bun.com/docs/runtime) distinguishes native commands from package scripts and forwards script
  arguments; [Bun reporters](https://bun.com/docs/test/reporters) supply native console and JUnit reporting.

## Consequences

A single full verification run for every change is easy to specify but gives slow feedback and conflates evidence with
unrelated execution costs. Purpose-based organization and risk-based scheduling require explicit boundaries and
selection rules. Specific test performance thresholds, execution details, and the migration plan require later
implementation planning. Existing repository checks remain authoritative until the owning current documents and
implementation are updated together to implement this decision.
