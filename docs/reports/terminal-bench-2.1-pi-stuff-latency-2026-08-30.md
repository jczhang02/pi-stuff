# Terminal-Bench 2.1 Pi Stuff latency comparison — 2026-08-30

Date: 2026-08-30
Bead: `ps-ljy`
Protocol status: complete; 48/48 preregistered model trials retained
Scope: runtime efficiency only

## Result

Pi Stuff took a mean 602.6 seconds per trial with Code Mode disabled and 535.4 seconds with Code Mode enabled. The
enabled-arm point estimate was 11.1% faster, not slower. The task-block bootstrap interval was wide, from 42.8% faster
to 25.4% slower, so the preregistered decision is **inconclusive**.

The public Codex result averaged 457.3 seconds across its full 445-trial submission. Pi Stuff's point estimates were
78.1 seconds slower with Code Mode enabled and 145.3 seconds slower with it disabled. These gaps are descriptive, not
a controlled harness effect: the public submission used the full task set on a different system, while the Pi Stuff
study used a deterministic 12-task subset on the local machine.

| Harness | Code Mode | Trials | Mean | Median | p90 | Timeouts | Interpretation |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Public Codex 0.144.1 | n/a | 445 | 457.3 s | not published | not published | not published | External full-suite reference |
| Pi Stuff | Off | 24 | 602.6 s | 422.8 s | 941.2 s | 3 | Local controlled arm |
| Pi Stuff | On | 24 | 535.4 s | 435.1 s | 976.1 s | 5 | Local controlled arm |

The public row and the two Pi Stuff rows use the same Terminal-Bench 2.1 benchmark family, model family, and maximum
reasoning setting. They are not task-matched or environment-matched. Only the Pi Stuff off/on rows form a concurrent,
paired comparison.

## Research question and boundary

This study asks how long Pi Stuff takes to complete a Terminal-Bench 2.1 trial with Code Mode disabled and enabled. It
does not evaluate task quality or feature correctness. Reward is retained only as context for completed, failed, and
timed-out trajectories.

The official reference records Codex 0.144.1 with `openai/gpt-5.6-luna`, `max` reasoning effort, 445 trials, and
`avg_trial_duration_sec = 457.3`. Hardware, load, Agent implementation, task population, and execution date differ.
Consequently, the reference cannot identify a causal Pi Stuff penalty; the within-machine Code Mode experiment can.

## Frozen protocol

The machine-readable [frozen protocol](terminal-bench-2.1-pi-stuff-latency-protocol-2026-08-30.json) records the study
design. The byte-exact [source manifest snapshot](terminal-bench-2.1-pi-stuff-source-manifest-snapshot-2026-08-30.json)
is retained only to verify its recorded hash; its historical adapter and execution fields are provenance, not current
runnable configuration. Protocol validation fixed the following choices before any counted model trial.

- Evaluator: Harbor 0.17.1 and Terminal-Bench 2.1 dataset digest
  `sha256:7d7bdc1cbedad549fc1140404bd4dc45e5fd0ea7c4186773687d177ad3a0699a`.
- Historical study Host and model: Pi 0.84.3, certified for this repository when the run was recorded;
  `openai-codex/gpt-5.6-luna`; `max` reasoning effort.
- Arms: `PI_STUFF_CODE_MODE_FROZEN=off` and `on`; other Agent arguments and mounted resources were identical.
- Sample: 12 tasks selected by SHA-256 sorting the frozen 89-task manifest with seed
  `ps-ljy-terminal-bench-latency-tasks-v1`; two repetitions per task and arm, 48 model trials in total.
- Execution: globally seeded interleaving, serial concurrency of one, a fresh task container, one attempt per job,
  `--no-session`, no retry, and no upload.
- Measurement: Harbor `finished_at - started_at`; completed, failed, and timed-out observations all remain in the mean.
- Probe: the same timestamp-only extension in both arms recorded Suite construction, Provider turns, and top-level Tool
  durations without prompts, Tool arguments, or Tool results.
- Code Mode runtime: both arms mounted the same preinstalled Host binary, SHA-256
  `60bf16414be5333f09ff082540082304c7352931ef64bdeb170d4c35a82e6ef8`. This removed first-use network download but
  retained lazy process startup when Code Mode was invoked.
- Stops: 48 model attempts, USD 15 observed cost, or 12 elapsed hours, whichever came first.

The frozen task sample was `nginx-request-logging`, `winning-avg-corewars`, `qemu-alpine-ssh`,
`financial-document-processor`, `chess-best-move`, `cobol-modernization`, `headless-terminal`, `bn-fit-modify`,
`distribution-search`, `build-pov-ray`, `largest-eigenval`, and `pypi-server`. Selection did not use prior speed or
success.

## Statistical decision

The primary Code Mode effect was `(mean(on) - mean(off)) / mean(off)`. A deterministic 100,000-replicate task-block
bootstrap resampled the 12 tasks while preserving both arms and repetitions within each task. The preregistered rule
required the whole 95% interval to lie above +10% for materially slower or below -10% for materially faster.

| Comparison | Point estimate | Task-block bootstrap 95% interval | Decision |
| --- | ---: | ---: | --- |
| Code Mode On relative to Off | -11.1% | -42.8% to +25.4% | Inconclusive |
| Pi Stuff Off relative to public 457.3 s | +31.8% | -12.4% to +88.6% | Inconclusive, descriptive only |
| Pi Stuff On relative to public 457.3 s | +17.1% | -16.8% to +54.3% | Inconclusive, descriptive only |

Code Mode was faster in 13 of the 24 task-by-repetition pairs and slower in 11. The paired median difference was 11.1
seconds in favour of Code Mode. These near-balanced counts and the wide interval do not support a general speed claim
in either direction.

## Where the time went

| Mean per trial | Code Mode Off | Code Mode On |
| --- | ---: | ---: |
| Environment setup | 4.0 s | 4.2 s |
| Agent setup | 1.6 s | 1.8 s |
| Agent phase | 537.9 s | 465.4 s |
| Verifier | 42.8 s | 46.5 s |
| Unattributed interval between recorded phases | 16.3 s | 17.6 s |
| Provider turns | 34.9 | 26.4 |
| Input Tokens | 1,275,516 | 639,188 |
| Top-level Tool calls | 29.5 | 16.8 |
| Top-level Tool time | 116.5 s | 53.5 s |
| Mean observed cost | $0.0544 | $0.0367 |

The Agent phase accounted for 89.3% of the disabled-arm wall time and 86.9% of the enabled-arm wall time. The disabled
arm also used 32.2% more Provider turns, 99.6% more input Tokens, 76.1% more top-level Tool calls, and 48.3% more cost.
This is consistent with longer model-driven trajectories, not a slower Suite factory.

The enabled arm spent a mean 53.3 seconds inside `codemode` Tool calls. That quantity is work performed through Code
Mode, not a separable tax: the enabled arm simultaneously used fewer calls, turns, and Tokens and had the lower wall
time point estimate. Treating every `codemode` second as overhead would double-count work that otherwise occurs through
ordinary Tools.

### Fixed Pi Stuff startup cost

Thirty-nine raw probes contained a complete Suite trace. Cold module import from cache miss to module loaded averaged
40.5 seconds (median 33.2 seconds); Suite factory execution after import averaged 0.153 seconds (median 0.122 seconds).
A separate fresh-container, no-model calibration measured 26.625 seconds for cold import and 0.114 seconds for the
factory. A warm-host calibration measured 3.976 seconds for import.

Cold import is therefore a real, repeated Pi Stuff cost, roughly 6.7% of the disabled-arm mean and 7.6% of the
enabled-arm mean. It is worth optimizing, but it explains tens of seconds rather than the observed multi-minute trial
times. Factory construction itself is negligible. Nine model observations had no complete probe file: all eight
timeouts and one completed trial; their primary Harbor timing remains valid and included.

### Long-tail sensitivity

The disabled arm included one 2,578.6-second `winning-avg-corewars` trial. Removing only the largest observation from
each arm changes the means from 602.6 to 516.7 seconds Off and from 535.4 to 502.5 seconds On; the 67.1-second gap then
shrinks to 14.2 seconds. The enabled arm had five timeouts versus three when disabled, so its lower completed-only mean
(404.5 versus 550.7 seconds) is also selection-sensitive and is not used as the primary result.

The largest task-level shifts were heterogeneous: Code Mode was 1,385.1 seconds faster on `winning-avg-corewars` and
238.4 seconds faster on `cobol-modernization`, but 447.7 seconds slower on `financial-document-processor` and 249.2
seconds slower on `qemu-alpine-ssh`. The evidence supports task-specific trajectory divergence and a heavy tail, not a
uniform harness slowdown.

## Root-cause finding

The claim that Code Mode makes Pi Stuff generally slower is **not reproduced**. The measured point estimate goes in
the opposite direction, and uncertainty is too large for a material speed conclusion.

The dominant cause of slow individual Pi Stuff trials is the model/Provider trajectory: repeated reasoning turns,
Tokens, Tool calls, and 900-second Agent timeouts. A single 42-minute disabled-arm trajectory materially changed the
aggregate mean. Pi Stuff also pays an independently measured cold-import cost of about 40 seconds per fresh container,
but this fixed startup cost is secondary. Code Mode execution is not the root cause of the observed gap; in this sample
it replaced enough ordinary Tool interaction to reduce turns and Tokens.

The apparent 78–145 second gap from the public Codex average cannot be fully attributed. Fixed Pi Stuff import accounts
for part of it, while task mix, hardware, load, Agent implementation, and long-tail trajectories remain confounded.
Claiming that Pi Stuff is intrinsically 17–32% slower than Codex from these rows would exceed the evidence.

## Runtime amendments and validity

Before the first Provider request, calibration showed that task containers required the repository Bun store mounted
at `/node_modules` and the certified Bun runtime on `PATH`. The failed calibration had zero Provider Tokens and was
retained outside the 48 observations. The dependency layout, Bun hash, and Harbor-qualified task-name parser were fixed
before the frozen order began; task selection, arms, order, outcomes, and decision rules did not change.

Rootless Podman 6.1.0 used Docker Compose v5.5.0. Network calibration required Netavark's no-firewall driver on this
host; container DNS and TLS were verified before model trials. After observation 35, Podman's Docker-compatible
`docker info` took longer than Harbor's ten-second preflight limit even though the API ping and container operations
remained responsive. A local arm-neutral wrapper answered only that preflight from the same API and delegated all
other commands to Podman. Two failed starts produced no trial directory or Provider request and were not counted. The
preflight occurs before Harbor's `started_at`, so this amendment did not enter the measured interval or alter an
existing observation.

These amendments address execution infrastructure, not the outcome. They are disclosed because the study is intended
as retained research evidence.

## Evidence and retention

The run started at `2026-08-30T06:05:43.075Z` and ended at `2026-08-30T13:59:50.222Z`; runner elapsed time was
28,447.147 seconds (7 h 54 min 7 s). It retained 48 observations: 40 complete and eight Agent timeouts. Observed model
cost was $2.18698596, below the $15 stop. No result was uploaded.

The sanitized result is [`terminal-bench-2.1-pi-stuff-latency-results-2026-08-30.json`](terminal-bench-2.1-pi-stuff-latency-results-2026-08-30.json). It contains
the 48 observations, aggregate statistics, protocol and binary hashes, and hashes of corresponding raw files. An
independent integrity audit matched all 48 result hashes to Harbor `result.json` files, all 48 Agent-log hashes to
`pi.txt`, and all 39 available probe hashes to `pi-stuff-latency.json`; it found no mismatches, duplicate mappings,
private absolute paths, or credential-like strings in the tracked JSON.

Raw Harbor jobs, Agent logs, probes, and infrastructure failures remain in the ignored local artifact directory. They
were not committed because they contain prompts, trajectories, Session-adjacent data, and private machine paths.
Existing valid jobs were retained on resume and never silently rerun.

Primary public sources are the [official Codex submission](https://github.com/harbor-framework/terminal-bench-2-1/blob/main/leaderboard/submissions/2026-07-11-openai-gpt-5-6-luna-max-codex.json),
the [Terminal-Bench 2.1 dataset record](https://hub.harborframework.com/datasets/terminal-bench/terminal-bench-2-1/6),
and [Harbor's timing/result documentation](https://github.com/harbor-framework/harbor/blob/v0.17.1/docs/content/docs/run-jobs/run-evals.mdx).
