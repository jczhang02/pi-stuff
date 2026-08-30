# Skill Discovery startup-bounded real-model confirmation preregistration

Date: 2026-08-30

Status: preregistered; no V5 Provider request or outcome exists.

This is a new independent study for Bead `ps-1gd`. It does not retry, replace, exclude, or reuse a sample from the
retained [first benchmark](skill-discovery-benchmark-20260830.md),
[confirmation](skill-discovery-confirmation-20260830.md),
[direct-read study](skill-discovery-direct-read-20260830.md), or
[isolated confirmation](skill-discovery-isolated-confirmation-20260830.md). It measures automatic direct Skill use
after separating Pi/Suite cold startup from ordinary RPC-command timing.

## Why a fifth study is necessary

The product candidate already made discovered Skills available through Code Mode's existing virtual Read surface and
directed the model to read the selected catalog location without a `tool_search` detour. In the two latest retained
studies, every completed Code Mode Session passed that strict endpoint: 29/29 in each study. Neither study passed its
hard gate because Suite Sessions timed out before any Provider request.

The isolated confirmation retained Raw 30/30, Pi Stuff off 27/30, and Pi Stuff on 29/30. Its four Suite failures all
ended at 61–65 seconds with zero Provider requests, Tool calls, and tokens. Native Context isolation did not remove
them, so that study correctly remained failed.

Post-outcome diagnosis used the certified Pi executable in offline, no-prompt Sessions. The first `get_state`
response took 1,088 ms for Raw Pi and 24,967–25,464 ms for the two Suite arms; the later configuration commands took
2–24 ms. Under concurrent repository checks, Suite cold startup took 34,307 ms while the later commands took 26 ms
total. The old 60-second general command timeout therefore included complete process and Extension cold startup and
could expire under external CPU contention before prompt preflight.

The shared runner now exposes that protocol boundary explicitly. `getInitialState` has a five-minute startup budget;
ordinary commands retain 60 seconds and Agent settlement retains 15 minutes. Structured timeout observations retain
only a bounded phase. A real-Host regression passed a 34,307 ms Suite startup while ordinary commands remained
limited to one second. This runner fix cannot alter the failed historical studies, so a new locked sample is required.

## Arms and Tool authority

One exact Provider/model configuration runs three matched arms:

1. **Raw Pi**: certified Host, study Skills, and measurement-only observer; Pi Stuff is absent.
2. **Pi Stuff off**: identical inputs and candidate Package with Code Mode frozen off.
3. **Pi Stuff on**: identical inputs and candidate Package with Code Mode frozen on and virtual Read active.

Every arm receives the strict allowlist `bash,find,grep,ls,read,codemode,tool_search`. Required Provider surfaces are
exactly `bash`, `find`, `grep`, `ls`, `read` for Raw/off and exactly `codemode`, `tool_search` for on. Missing or extra
Tools, a missing catalog, or an invalid Provider boundary is an instrumentation failure.

Every arm uses Pi Stuff's existing `MAGIC_CONTEXT_PI_SUBAGENT=1` guard to keep these synthetic one-turn Sessions on
native Context. The runner removes all inherited `MAGIC_CONTEXT_*`, `PI_STUFF_*`, `PONYTAIL_*`, and
`PI_SUBAGENT_PARENT_*` variables before setting the locked environment. This is an evaluation control, not a product
change or a claim about Magic Context.

## Locked identities

The signed Run Lock will freeze:

- Provider `openai-codex`, model `gpt-5.6-sol`, reasoning `xhigh`, and Context mode `native`;
- product candidate commit `518af59db690bd7751ae6e08db9a6750fa411894` and Package tree
  `8d9d7220f39f49fb25d7b7ccb9282b75aedf1c15`;
- certified Pi 0.84.4 Linux x64 release executable SHA-256
  `ce91e1f8bff6176c6a23a690bd0bc4c6e1f5bee1b1183cd2a3b1e92d88c9038a`, size 104,511,616 bytes;
- startup, ordinary-command, and settlement budgets of 300,000 ms, 60,000 ms, and 900,000 ms;
- every executable runner source, the measurement-only observer, immutable manifest, exact schedule, and new report
  destination.

Exact preregistered inputs are:

- `scripts/benchmark-skill-discovery.ts`: `8f3e5cb79a3a9d1a6bda7970a599bf80049411f0ba979dd483e62dd9fc7a19f5`;
- `scripts/pi-rpc-client.ts`: `689e4f87c8beae6a2978f8acf722fbf3b32af1bd2894c2c023f7c7f3f960c1b4`;
- `scripts/skill-discovery-benchmark-core.ts`: `a36c324ba95711acbe49893c3d23dbd3063989c94c3309d01f0c6e8d6b38cbf4`;
- `scripts/skill-discovery-benchmark-evidence.ts`:
  `b92fc647053c2a5ef047f3e35649ff96f12978f68254497fb093f99b2a25df0a`;
- `scripts/skill-discovery-benchmark-report.ts`:
  `72b2c606b2dd8ac7741da24eb22f313604f67d8c316e9522a24791600b0e31c9`;
- `scripts/skill-discovery-benchmark-session.ts`:
  `52c1703f8d66a95cf017debf147637d73686edd570674af99574e01f6f9d2f22`;
- observer `test/fixtures/skill-discovery-benchmark-observer.ts`:
  `c7ad035b166ff99950c3138c033e991f6d5ea97b6a3f84d158b3ae34fc7fa705`;
- manifest `test/fixtures/skill-discovery-startup-bounded-confirmation-manifest.jsonl`:
  `c864808d44bb2e66fda91d5041d4b10c2484f1f38b585409d51f7231595b4441`.

The Run Lock path is
`test/fixtures/skill-discovery-startup-bounded-confirmation-run-lock.json`; the report destination is
`docs/reports/skill-discovery-startup-bounded-confirmation-20260830.json`. The candidate commit binds the product
Package identity. The later signed lock commit may add only locked study inputs while its `packages/pi-stuff` tree
must remain byte-identical. Runner and observer identities are bound independently by their hashes.

Preflight must reject a different Host, dirty tree, mismatched Package tree, runner, observer, manifest, timeout
policy, Context mode, Provider/model configuration, authentication state, or existing report before the first
Provider request.

## New tasks, order, and isolation

V5 contains 30 new matched triads and 90 primary Sessions: ten metadata, ten deterministic-instruction, and ten
relative-resource tasks. IDs begin with `bounded-`, target Skills with `sd-bounded-`, and expected tokens use the
`*_BOUNDED_*` namespace. An executable test compares every V5 ID, prompt, expected token, and target Skill name with
all four retained manifests and requires zero reuse.

The deterministic generator uses seed `20260903`. Its immutable JSON Lines manifest records every prompt, target and
decoy Skill, relative resource, expected token, fixture hash, and arm order. All six arm permutations occur exactly
five times after seeded task shuffling. Sessions execute sequentially.

Each Session receives fresh project, Agent, Session, cache, config, data, runtime, state, and temporary directories.
Arms share exact prompt and fixture bytes, ordinary Tool authority, model configuration, observer, native Context
mode, timeout policy, and one runner-owned Provider authentication rotation chain. Each Session receives a fresh
case-local credential copy; after its safety check, Provider-owned OAuth rotation is copied forward. No Session,
cache, fixture path, model history, or case-local credential file is shared.

There are no retries, replacements, post-outcome exclusions, or early stopping. Every timeout, process, Provider,
parsing, instrumentation, or model failure remains a failed observation in its original arm. Timeout observations
retain exactly one phase from `setup`, `prompt-preflight`, `settlement`, `evidence`, or `unknown`; successful Sessions
retain `none`.

## Per-Session endpoint

Automatic direct Skill-use success requires all of the following:

1. The first Provider prompt contains exactly one target catalog entry with the expected name, description, and
   location.
2. The natural-language prompt never names the target, but the model selects it automatically.
3. The first relevant operation reads that exact target `SKILL.md`; on must use an outer `codemode` call whose first
   relevant nested operation is `tools.read`.
4. Before that read there is no Bash, Find, Grep, List, `tool_search`, Skill-directory scan, documentation/settings or
   historical-Session lookup, unsupported-availability claim, or decoy read.
5. The observed target content hash matches the fixture; relative-resource tasks then read the exact declared
   resource and hash.
6. The final answer exactly matches the task token.
7. Provider-Tool, process, Provider, instrumentation, prompt-boundary, protected-file, safety, and privacy checks pass.

Correct output never substitutes for an observed exact Skill read. Complete before/after snapshots protect the fresh
project and generated Agent `skills/` tree. Provider-owned authentication may rotate and is excluded from byte
comparison; model access to authentication, settings, Session, environment, or unrelated user data is a separate
safety violation.

## Statistics and verdict

Each arm reports its success fraction and Wilson 95% interval. Pi Stuff off minus Raw Pi and Pi Stuff on minus off use
20,000 whole-triad bootstrap resamples with seed `20260903` and percentile 95% intervals. Exact two-sided McNemar
results report all four paired cells.

The study passes only if:

- observed rates satisfy `Raw Pi <= Pi Stuff off <= Pi Stuff on`;
- both paired interval lower bounds are greater than `-0.10`;
- all 90 observations remain in their original arms;
- prompt-boundary, protected-file, instrumentation, safety, and report-privacy violations are zero; and
- every Host, Package tree, source, manifest, schedule, arm, Context-mode, timeout-policy, Provider/model, and
  Provider-Tool hard invariant passes.

Improvement additionally requires more favorable than unfavorable discordant pairs and exact two-sided McNemar
`p <= 0.05`. Otherwise the strongest passing claim is non-inferiority under this exact frozen study.

## Execution protocol

No V5 Session or Provider request may start until the manifest, runner, observer, timeout policy, and report path are
committed, independently reviewed, encoded in a signed Run Lock, and audited against a clean worktree. After that
lock, the runner executes the 90 Sessions exactly once. A failed observation is retained; it is never retried or
replaced. The sanitized report is committed regardless of pass or failure.

## Public-data policy

The observer inspects Provider payloads and Tool lifecycles only in memory. The sanitized report may retain synthetic
IDs, hashes, path classes, counts, booleans, bounded failure/timeout enums, Tool names, timings, token totals, locked
identities, statistics, and verdict. It must not contain credentials, prompts, Assistant text, Skill bodies, Provider
payloads, Session JSON or IDs, private absolute paths, or temporary directories. The runner validates privacy before
and after writing the report, then deletes every temporary project, Session, fixture, auth copy, and observer log.
