# FrontierHarness Eval fit for Pi Stuff

Date: 2026-09-05. Read-only primary-source investigation for the
[testing design interview](../adr/0031-organize-test-evidence-and-release-gates.md). No evaluation, installation,
account connection, or paid Provider request was performed.

## Finding

FrontierHarness Eval is a plausible external task evaluation for Pi Stuff. It supplies an existing task selection,
verifiers through external task environments, runner orchestration, and result accounting. It does not certify Pi
Stuff's UI, persistence, or Capability contracts. Adopting it remains a proposal, not a completed integration.

The upstream snapshot inspected is
[`8f11b130c30bbf76ca1f3edeea70abc773bd8d2c`](https://github.com/frontier-harness-eval/eval/tree/8f11b130c30bbf76ca1f3edeea70abc773bd8d2c).
The [frozen benchmark definition](https://github.com/frontier-harness-eval/eval/blob/8f11b130c30bbf76ca1f3edeea70abc773bd8d2c/benchmark.json)
specifies 30 tasks: 21 Terminal-Bench tasks and 9 DeepSWE v1.1 tasks. Published evaluation uses Kimi K3 through Fireworks,
with one canonical result per task and configuration. Its
[Pi baseline metadata](https://github.com/frontier-harness-eval/eval/blob/8f11b130c30bbf76ca1f3edeea70abc773bd8d2c/metadata/harness-versions.json)
records Pi 0.84.2; Pi Stuff currently targets Pi 0.85.0. A new Suite result is not a rerun of that historical Pi cell.

## Accepted comparison direction

The maintainer prioritizes cost for this personal-use project. Compare stored public benchmark results, including
FrontierHarness Eval, and multiple historical Pi Stuff runs. The earlier proposal for a fresh paired 60-trial sweep
is not the default: no additional plain-Pi control is required. New runs remain low-frequency, explicitly requested
work; missing historical data alone does not justify rerunning an experiment.

Record the task set, model, Provider, Host and Package versions, effective Suite configuration, and environment when
available. Differences remain visible in the comparison, and unavailable fields stay unavailable. Historical results
can inform practical decisions without proving that the Suite alone caused a difference. The narrower paired
[Suite Outcome Evaluation](../../CONTEXT.md) is a distinct experiment, not a prerequisite to historical comparison.

Retained [Terminal-Bench evidence](../reports/ps-ps3-capability-contract-and-terminal-bench-observation-2026-08-30.md)
includes 89 first attempts with 71 successes. A separate
[latency study](../reports/terminal-bench-2.1-pi-stuff-latency-2026-08-30.md) retains 48 trials comparing Code Mode off
and on within Pi Stuff; it is not a Suite-absent versus Suite-present comparison. These historical task sets differ
from FrontierHarness's 30-task selection, so their overall pass rates are not interchangeable leaderboard scores.

## Execution requirements

The [official workflow](https://github.com/frontier-harness-eval/eval/blob/8f11b130c30bbf76ca1f3edeea70abc773bd8d2c/skills/frontierharness-eval/SKILL.md)
provisions Runta runtimes and uses an authenticated Provider. It does not automatically turn
a Pi extension into a Harbor or Pier agent.

The [runner reference](https://github.com/frontier-harness-eval/eval/blob/8f11b130c30bbf76ca1f3edeea70abc773bd8d2c/skills/frontierharness-eval/reference.md)
routes Terminal-Bench through Harbor and DeepSWE through Pier. Custom harnesses require runner registration in an
installation script. For Pi Stuff, that adapter should install the supported Pi and explicit Package revision, then
launch Pi with the chosen isolated configuration; Pi remains the Host.

The same reference documents a local-Harbor/Runta-provider alternative, which changes the shared-checkpoint property.
It is not a documented fully local replacement for the official workflow. Task registry names also differ from the
dataset's advertised version, so exact task IDs and environment identities matter more than a similar-looking name.

The [provisioner](https://github.com/frontier-harness-eval/eval/blob/8f11b130c30bbf76ca1f3edeea70abc773bd8d2c/skills/frontierharness-eval/scripts/provision-golden-checkpoint.sh)
accepts a pinned repository and install script, prepares dependencies and task images, and freezes a checkpoint.
Its defaults are 4 vCPU, 8 GiB memory, and 100 GiB disk. The
[trial runner](https://github.com/frontier-harness-eval/eval/blob/8f11b130c30bbf76ca1f3edeea70abc773bd8d2c/skills/frontierharness-eval/scripts/run-trials.sh)
restores a runtime per task and defaults to a 5,400-second task timeout. These are configuration bounds, not measured
Pi Stuff runtimes or spending estimates. Validate the adapter with independent smoke tasks before formal evaluation.

## Scoring and completeness

The [normalizer](https://github.com/frontier-harness-eval/eval/blob/8f11b130c30bbf76ca1f3edeea70abc773bd8d2c/skills/frontierharness-eval/scripts/normalize-results.mjs)
uses successful trials divided by scoreable trials; `infra_invalid` is excluded. Effective cost per pass is total
recorded cost across scored trials divided by passes, and stays unavailable if cost coverage is incomplete. Some
duration/efficiency summaries use successful trials only; retain failures and timeouts in the detailed report.

Published first-turn-cache normalization cannot be reconstructed from the public data, and the normalizer leaves
those fields empty. It also skips unreadable trial records and derives its expected/completed counts from available
scoreable records. Therefore a generated summary alone does not prove all 30 planned task IDs ran. Check the planned
task inventory, invalid and missing trials, and evidence completeness separately before describing a run as complete.
Do not invent missing costs or interpret absent records as passing tasks.

## Decisions still needed

- Minimal historical comparison report and which compatible records support each metric.
- Model and Provider, official Runta execution versus another declared environment, and the Suite's effective
  configuration. Infrastructure choice is a design decision, not authorization to purchase resources.
- Formal sample size, repetitions, wall-time and spending bounds, invalid-run handling, and result-retention policy.
- Existing internal scripts: explain their measurements, execution costs, and retained results before deciding
  retention or removal. No deletion decision has been accepted for these scripts.
