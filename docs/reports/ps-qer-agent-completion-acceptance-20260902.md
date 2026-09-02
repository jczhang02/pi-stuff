# ps-qer Agent completion acceptance

[Simplified Chinese](../i18n/zh-CN/docs/reports/ps-qer-agent-completion-acceptance-20260902.md)

Date: 2026-09-02  
Bead: `ps-qer`  
Immediate pre-fix baseline: `124dcbf92de847e4c5d845509b9b839a283aeb31`  
Runtime candidate: `c4ab125c750f5d005277c384d15dd506c1609746`  
Synchronized upstream: pi-subagents v0.63.0 at `4f7eb2b56dc5306416920db8c6e222c7aaad3c81`

## Verdict

The candidate satisfies the Agent completion-control acceptance contract. Ordinary delegated work has no implicit
Assistant-turn or all-Tool budget. The real six-reviewer comparison crossed the retired boundaries without steering or
transcript inspection; all six eventually reached the preregistered 30-minute timeout and were truthfully returned as
actionable, bounded `timeout` / `incomplete` results with cumulative usage and resumable Targets. None was reported as
success or as a finished deliverable.

The deterministic child-process regression separately completed after 71 Assistant turns and 130 Tool calls, proving
that a child can cross both retired boundaries and still return its final answer.

## Frozen comparison

The manifest was frozen before candidate execution. The baseline and candidate used the same six task texts, one
user-scoped read-only reviewer definition, and the following selection contract:

| Field | Frozen value |
| --- | --- |
| Agent-definition SHA-256 | `4eb0402b4a5a96297c5d12d5c9cd17d011aa3dedd40753de2e096da11bcab0c3` |
| Provider / model | `openai-codex` / `gpt-5.6-sol` |
| Thinking | `xhigh` |
| Fallback | none |
| Context | `fresh` |
| Reviewer Tools | five read-only Tools; no explicit Tool budget |
| Parent | deterministic zero-cost fixture invoking the six tasks through Code Mode |
| Candidate terminal bound | one preregistered 30-minute foreground-run timeout |
| Intervention | no steering, resume, or transcript inspection |

The parent fixture could neither rewrite reviewer tasks nor add child Provider cost. Task text remains private; exact
identity is established only by SHA-256:

| Reviewer | Task SHA-256 |
| --- | --- |
| R1 | `94e398d3fa04298232a2c72106fe395050b824bfa4deb414176299d92b3fbc64` |
| R2 | `bca4094b3c88e7e5d42df175075f8e99cbe32201b32b2f09c41d59e10c5ac925` |
| R3 | `02c5b1ad5fa664a8b70397adac20405b96e0a73e5505b9260c11dbf6b6400759` |
| R4 | `1d7ee687026fd440631349eb6358cb060414f574eb47c4f7057d5cbdac3b4495` |
| R5 | `bf05a0096c788779da0bc590e252ff638e59ce6cb9ec98944c65a5b4917a8313` |
| R6 | `aa483ffc3185edbd53588b76a379887c0b7dec91cd707b38d4a33fbf458f1cbf` |

## Public metrics

The immediate pre-fix baseline stopped every reviewer at 66 turns through the retired implicit turn budget:

| Reviewer | First terminal class | Turns | Tools | Input | Output | Reported USD | Attempts | Resumes | Final deliverable |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| R1 | `explicit_budget` | 66 | 72 | 698,286 | 11,266 | 3.946914 | 1 | 0 | no |
| R2 | `explicit_budget` | 66 | 70 | 538,685 | 9,442 | 3.177901 | 1 | 0 | no |
| R3 | `explicit_budget` | 66 | 66 | 616,125 | 10,163 | 3.530667 | 1 | 0 | no |
| R4 | `explicit_budget` | 66 | 66 | 610,164 | 11,148 | 3.549612 | 1 | 0 | no |
| R5 | `explicit_budget` | 66 | 67 | 597,245 | 8,711 | 3.415235 | 1 | 0 | no |
| R6 | `explicit_budget` | 66 | 94 | 744,502 | 12,180 | 4.163430 | 1 | 0 | no |

The candidate let the same work continue until the independent timeout. Non-empty terminal output was inspected by a
read-only verifier and classified as bounded partial evidence, not as the requested final deliverable:

| Reviewer | First terminal class / state | Turns | Tools | Input | Output | Reported USD | Attempts | Resumes | Final deliverable |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| R1 | `timeout` / `incomplete` | 257 | 304 | 2,654,399 | 53,797 | 15.004177 | 1 | 0 | no |
| R2 | `timeout` / `incomplete` | 242 | 242 | 2,381,542 | 46,846 | 13.470658 | 1 | 0 | no |
| R3 | `timeout` / `incomplete` | 244 | 246 | 2,454,432 | 48,999 | 13.891826 | 1 | 0 | no |
| R4 | `timeout` / `incomplete` | 255 | 266 | 2,652,577 | 52,335 | 14.939687 | 1 | 0 | no |
| R5 | `timeout` / `incomplete` | 288 | 318 | 2,844,245 | 49,157 | 15.808063 | 1 | 0 | no |
| R6 | `timeout` / `incomplete` | 244 | 259 | 2,468,055 | 52,095 | 14.061973 | 1 | 0 | no |

| Aggregate | Turns | Tools | Input | Output | Reported USD | Attempts | Resumes | Final deliverables |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | 396 | 435 | 3,805,007 | 62,910 | 21.783759 | 6 | 0 | 0 |
| Candidate | 1,530 | 1,635 | 15,455,250 | 303,229 | 87.176384 | 6 | 0 | 0 |

Every candidate result retained bounded evidence, a concrete Target, `resumeSupported: true`, and
`acknowledgementRequired: true`. Because the run used one attempt and no resume, its per-result first-attempt usage and
cumulative work-unit usage are identical. Reported USD is included only because this Provider supplied authoritative
cost telemetry; Pi Stuff does not infer prices.

## Contract evidence

- New runs do not receive an implicit turn budget or all-Tool budget. Turn and Tool counts remain telemetry.
- The frozen default cumulative guard is 1,000,000 reported tokens or USD 5.00 when authoritative USD is available.
  It is evaluated before later automatic expansion and never terminates an in-flight child.
- A direct-user acknowledgement preserves cumulative totals and increments resume and model-attempt accounting.
- Explicit Tool budgets remain opt-in. Their hard limit blocks only configured Tool names and leaves final synthesis
  available.
- Timeout, stop, Provider, Context-capacity, storage, protocol, process, cost-guard, and explicit-budget endings remain
  incomplete or failed with a bounded reason, partial evidence, usage, Target, and resume eligibility.
- Versionless legacy records recover only from positive physical evidence. Dead or unverifiable records are quarantined
  without signalling or reclaiming an unknown owner, and no legacy path invents success.
- Foreground execution remains owned by Pi; background lifecycle, recovery, and accounting remain owned by Agents.
  Goal and Context Management boundaries are unchanged.

The applicable upstream changes and intentional product exclusions are recorded in the
[v0.63 synchronization ledger](../research/pi-subagents-v0.63-synchronization-20260902.md). The motivating evidence and
predeclared measurement contract are retained in the
[completion-controls research note](../research/subagent-completion-controls-20260902.md).

## Certification

The final branch is accepted only with all of these repository-owned gates passing on the complete diff:

- focused completion, cumulative-usage, terminal-outcome, Tool-budget, legacy-recovery, ownership, and real process
  control tests;
- `bun run check`, including `check:fast`, every test file in process isolation, Goal upstream/runtime verification,
  the Tool Activity benchmark, and extracted-Package verification;
- the certified Pi 0.84.4 real-Host Agent execution matrix, Agent PTY, Context PTY, fresh/fork,
  foreground/background, long-run, steering, and Context projection seams;
- two consecutive clean independent Thermo-Nuclear reviews of the complete final diff.

An additional non-gating `benchmark:lifecycle` diagnostic did not meet its historical reload and same-process prompt
budgets. A sequential run against the exact `124dcbf` baseline reproduced the same failure families and magnitudes, so
this is not claimed as ps-qer lifecycle-performance certification and is not repaired by widening budgets. The Bead
explicitly leaves unrelated surface rework out of scope.

## Privacy

This report contains only commit identities, configuration hashes, task hashes, public lifecycle fields, aggregate
metrics, and verdicts. Credentials, Agent names, task or prompt text, Assistant output, private paths, raw Sessions,
run and Session identifiers, model stores, and private artifact contents remain outside the repository.
