---
status: accepted
---

# Organize quality assurance by verification purpose

## Context

The quality-assurance design interview started on 2026-09-05 to address unclear test organization, long pull-request
feedback, redundant verification, and repeated investigation of failures. The overall architecture was accepted on 2026-09-05.
This ADR defines the migration target; current checks and certification policy remain in force until migrated.

## Agreed constraints

- Cover requirements and design through implementation, installation, upgrade, release acceptance, and regression
  verification of problems found in use. Operational problems supply evidence without requiring a monitoring platform.
- Organize activities into Static Checks, Tests, Benchmarks, and Reviews by their primary purpose. Keep documentation,
  directories, commands, and result reporting consistent with that organization; share supporting code and evidence
  instead of duplicating a scenario merely to populate categories.
- Schedule verification according to change risk and cost. Before merge, establish changed behavior and the absence of
  regressions in the relevant critical public contracts. Complete Agent task-outcome benchmarks may run on demand;
  expensive verification may run for relevant changes, periodically, or before release. Unverified behavior must remain
  explicit and must never be reported as passed.

## Agreed organization and coverage

- Tests use five levels: Component (Unit), Component Integration, System, System Integration, and Acceptance.
  Within a level, organize by Capability and scenario. Do not invent tests for empty categories; acceptance may reuse
  existing evidence, and each scenario has one primary home.
- For system testing, the system under test is the real Pi Host with the complete Suite loaded. Model services, MCP
  services, and external tools are external dependencies. System integration targets actual interoperability with those
  dependencies. Host interface compatibility may be checked separately; merely launching Pi does not classify a test.
- Tests own software behavior and performance verification, including startup, reload, responsiveness, and resource
  growth. Benchmarks are a separate top-level category reserved for complete Agent task-outcome evaluation, not a
  container for software performance checks. Whether the existing 200 ms spinner limit is a justified requirement
  remains to be established; a diagnostic measurement alone does not create a blocking requirement.
- Static Checks cover formatting, lint, types, dependencies, architecture, generated output, package structure, and
  code-vulnerability, dependency-vulnerability, and credential-leak scanning. Reuse existing tools first; adding a scanner
  requires an explicit target and evidence of usefulness.
- Each Capability identifies applicable normal, error, cancellation, recovery, persistence, and resource-cleanup
  behavior. Assign primary coverage at the appropriate level; higher levels add actual connection and complete-flow
  evidence without mechanically repeating every lower-level scenario.
- Benchmarks follow the kind of task-set evaluation illustrated by
  [FrontierHarness Eval](https://runta.com/blog/introducing-frontierharness-eval/): run complete Agents on a defined task
  set and report task completion, result quality, token usage, cost, and elapsed time. For Pi Stuff, use the existing
  Suite Outcome Evaluation contract: hold the Host, model, tasks, environment, and resource budget fixed while comparing
  native Pi with the complete Suite. Use individual Capability ablations when attribution is needed. Task verifiers
  score benchmark outcomes; those outcomes do not certify individual Capability contracts or block PRs.
- Reviews cover requirements, architecture, code, security, test effectiveness, and evaluation methodology. Reviewers
  examine redundant assertions and implementation coupling. Ordinary changes receive scoped review; cross-Capability
  and architecture changes receive independent review. Existing Thermo-Nuclear review requirements remain applicable,
  with test quality explicitly in scope.

## Source installation and performance requirements

- Pi Stuff is installed from a repository checkout through `pi install ./packages/pi-stuff`; a Pi Package is a resource
  organization unit, not a requirement to produce a distribution archive. Acceptance targets the selected repository
  revision and its documented installation, loading, reload, and observable behavior in an isolated environment.
- Archive creation and extraction in the existing verifier are implementation choices to review for removal or
  replacement. Preserve valuable real-Host verification when changing that path. Acceptance is scheduled on demand
  without requiring packaging or a separate release pipeline.
- Audit existing performance thresholds for their requirement source, measurement stability, and applicable environment
  before deciding whether each justifies a blocking performance test or only diagnostic measurement within Tests.
  Do not silently delete uncertain thresholds or change product code merely to satisfy an unexplained limit.
- Repeated failures require distinguishing unstable outcomes from root causes. A defective test, product defect, or
  environment problem can each cause repeated failures; flakiness alone does not identify which is responsible. The
  agreed repair and deletion policy is recorded below.

## Agreed execution and failure policy

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

## Agreed test retention criteria

- Preserve valid critical behavior when deleting its only test: use a simpler reliable test or reuse suitable integration
  or acceptance evidence. Correct an invalid requirement rather than recreating a defective test. Deletion is never
  evidence that the behavior passed.
- Retain tests for independent defect-detection value, not test counts, coverage percentages, or layer ratios. Prioritize
  duplicate assertions, obsolete scenarios, and checks that merely freeze private implementation shape for removal or
  revision. Similar flows at different levels remain justified when they detect different defects.

## Trade-off and implementation status

A single full verification run for every change is easy to specify but gives slow feedback and conflates evidence with
unrelated execution costs. Purpose-based organization and risk-based scheduling require explicit boundaries and
selection rules. Specific test performance thresholds, execution details, and the migration plan require later
implementation planning. Existing repository checks remain authoritative until the owning current documents and
implementation are updated together to implement this decision.
