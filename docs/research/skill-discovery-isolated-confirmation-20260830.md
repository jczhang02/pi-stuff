# Skill Discovery isolated real-model confirmation preregistration

Date: 2026-08-30

Status: completed exactly once; retained as a failed study because four Suite Sessions timed out before any Provider
request.

This is a new, independent study for Bead `ps-1gd`. It does not replace or reuse samples from the retained
[first benchmark](skill-discovery-benchmark-20260830.md),
[confirmation](skill-discovery-confirmation-20260830.md), or
[direct-read study](skill-discovery-direct-read-20260830.md). It tests the final candidate's automatic, direct Skill
selection and loading while removing a measured, unrelated Context-worker confound from all arms.

## Reason for this study

The direct-read study completed all 90 scheduled Sessions. Raw Pi passed 30/30; Pi Stuff off and on each passed 29/30.
Every completed on-arm Session passed the strict endpoint, including direct nested `tools.read` with no `tool_search`
or other discovery detour. One matched off/on pair timed out at about 65 seconds before any Provider request, while its
raw peer passed. The earlier confirmation produced the same off/on-only, zero-Provider-request timeout shape.

Post-outcome code-path inspection found that Pi's RPC prompt acknowledgement follows prompt preflight, which includes
Pi Stuff's `before_agent_start` handlers. Direct RPC input starts the optional Magic Context Worker in both Suite arms;
that initialization has no internal deadline and is absent from raw Pi. The retained reports do not identify the exact
timed-out await, so they remain failed rather than being reclassified.

This study does not relax the 60-second RPC-command boundary, retry a failed task, or change the candidate Package.
Instead, every arm uses Pi Stuff's existing `MAGIC_CONTEXT_PI_SUBAGENT=1` native-Context guard. The runner first removes
inherited `MAGIC_CONTEXT_*` variables and then sets that exact guard. This prevents optional Context-worker startup
from entering a Code Mode Skill Discovery measurement and gives raw, off, and on the same native Context authority.

## Arms and Tool authority

One exact Provider/model configuration runs three matched arms:

1. **Raw Pi**: certified Host, study Skills, and measurement-only observer; Pi Stuff is absent.
2. **Pi Stuff off**: the same inputs and candidate Package with Code Mode frozen off.
3. **Pi Stuff on**: the same inputs and candidate Package with Code Mode frozen on and virtual Read active.

Every arm receives the identical strict allowlist
`bash,find,grep,ls,read,codemode,tool_search`. The required Provider surfaces are exactly:

- Raw Pi and Pi Stuff off: `bash`, `find`, `grep`, `ls`, `read`;
- Pi Stuff on: `codemode`, `tool_search`.

Raw Pi ignores the two unregistered Code Mode names. Pi Stuff off removes its disabled envelope. Pi Stuff on projects
the same five ordinary Tools behind its two-Tool envelope. Missing or extra Tools, a missing catalog, or an invalid
Provider boundary is an instrumentation failure.

Native Context isolation is an evaluation control, not a product change or a claim about Magic Context. It disables
only the optional derived Context engine for these synthetic one-turn Sessions. All three arms still use Pi's native
prompt, Session, and compaction behavior.

## Run Lock

The complete pre-outcome Run Lock freezes:

- Provider `openai-codex`, model `gpt-5.6-sol`, reasoning `xhigh`, and Context mode `native`;
- candidate commit `518af59db690bd7751ae6e08db9a6750fa411894` and Package tree
  `8d9d7220f39f49fb25d7b7ccb9282b75aedf1c15`;
- certified Pi 0.84.4 Linux x64 release executable SHA-256
  `ce91e1f8bff6176c6a23a690bd0bc4c6e1f5bee1b1183cd2a3b1e92d88c9038a`, size 104,511,616 bytes;
- every runner source, the measurement-only observer, immutable manifest, exact schedule, and sanitized report path.

Exact locked inputs are:

- `scripts/benchmark-skill-discovery.ts`: `028cc81e87a6a98cd8e55b1bffe358a683ee07ba99f54876e367ecb08d4521f1`;
- `scripts/pi-rpc-client.ts`: `75182f6d2a3cbf3a4369921e94063ef6153eacb95dc683397d95b1d943e09eff`;
- `scripts/skill-discovery-benchmark-core.ts`: `b340cb21f27bd0316327c1071674e973053099450050e46f9d3bbd835c7dca9a`;
- `scripts/skill-discovery-benchmark-evidence.ts`: `b92fc647053c2a5ef047f3e35649ff96f12978f68254497fb093f99b2a25df0a`;
- `scripts/skill-discovery-benchmark-report.ts`: `72b2c606b2dd8ac7741da24eb22f313604f67d8c316e9522a24791600b0e31c9`;
- `scripts/skill-discovery-benchmark-session.ts`: `8b50248861e8f54a920b40f7ded6da0372d132b4d95bff873daec2210e6b31d4`;
- observer `test/fixtures/skill-discovery-benchmark-observer.ts`:
  `c7ad035b166ff99950c3138c033e991f6d5ea97b6a3f84d158b3ae34fc7fa705`;
- manifest `test/fixtures/skill-discovery-isolated-confirmation-manifest.jsonl`:
  `aa2f80b2c05be84ac6231aa14aa3b3a25179120430489ad91eb87116fa08aec9`.

The new manifest path is `test/fixtures/skill-discovery-isolated-confirmation-manifest.jsonl`; the Run Lock path is
`test/fixtures/skill-discovery-isolated-confirmation-run-lock.json`; the report destination is
`docs/reports/skill-discovery-isolated-confirmation-20260830.json`.

Preflight rejects a different Host, dirty tree, mismatched Package tree, source, observer, manifest, Context mode,
model configuration, authentication, or existing report before the first Provider request. The candidate commit and
the clean execution tree must resolve to the same locked Package tree while runner inputs are hashed independently.
The later signed Run Lock commit cannot identify itself: `candidateCommit` binds the product Package identity, not the
execution HEAD, which may contain only locked study inputs while preserving that exact Package tree.

## Tasks, order, and isolation

The study contains 30 new matched triads and 90 primary Sessions: ten metadata, ten deterministic-instruction, and ten
relative-resource tasks. IDs begin with `isolated-`, target Skills with `sd-isolated-`, and expected tokens use the
`*_ISOLATED_*` namespace. None occurs in an earlier study. Prompts describe work naturally and never name a Skill,
path, `SKILL.md`, command, catalog, or inspection step.

The deterministic generator uses seed `20260902`. Its immutable JSON Lines manifest records every prompt, target and
decoy Skill, relative resource, expected token, fixture hash, and arm order. All six arm permutations occur exactly
five times after seeded task shuffling. Sessions run sequentially with a 60-second RPC-command timeout and 15-minute
Agent-settle timeout.

Each Session receives fresh project, Agent, Session, cache, config, data, runtime, state, and temporary directories.
Arms share exact prompt and fixture bytes, ordinary Tool authority, model configuration, observer, native Context
mode, timeouts, and one runner-owned Provider authentication chain. Each Session receives a fresh credential copy;
after its safety check, Provider-owned OAuth rotation is copied forward for the next Session. No Session, cache,
fixture path, model history, case-local credential file, or other temporary state is shared.

There are no retries, replacements, post-outcome exclusions, or early stopping. Once sampling starts, every timeout,
process, Provider, parsing, instrumentation, or model failure remains a failed observation in its original arm.

## Per-Session endpoint

Automatic direct Skill-use success requires every condition below:

1. The first Provider prompt contains exactly one target entry with its expected name, description, and location.
2. The prompt does not name the target, but the model selects it automatically.
3. The first relevant operation reads that exact target `SKILL.md`; on must use an outer `codemode` call whose first
   relevant nested operation is `tools.read`.
4. Before that read there is no Bash, Find, Grep, List, `tool_search`, Skill-directory scan, documentation or settings
   lookup, historical Session lookup, unsupported-availability claim, or decoy read.
5. The observed Skill content hash matches the fixture; a relative-resource task then reads its exact declared
   resource and hash.
6. The final answer exactly matches the task token.
7. Provider-Tool, process, Provider, instrumentation, prompt-boundary, protected-file, safety, and privacy checks pass.

Correct output never substitutes for an observed exact Skill read. The protected-file check compares complete
before/after snapshots of the fresh project and generated Agent `skills/` trees. Provider-owned authentication may
rotate and is excluded from that byte comparison; model access to auth, settings, Session, environment, or unrelated
user data is a separate safety violation.

## Statistics and verdict

Each arm reports its success fraction and Wilson 95% interval. Pi Stuff off minus Raw Pi and Pi Stuff on minus off use
20,000 whole-triad bootstrap resamples with seed `20260902` and percentile 95% intervals. Exact two-sided McNemar
results report all four paired cells.

The study passes only if:

- observed rates satisfy `Raw Pi <= Pi Stuff off <= Pi Stuff on`;
- both paired interval lower bounds are greater than `-0.10`;
- all 90 observations remain in their original arms;
- prompt-boundary, protected-file, instrumentation, safety, and report-privacy violations are zero; and
- every Host, Package tree, source, manifest, schedule, arm, Context-mode, Provider/model, and Provider-Tool hard
  invariant passes.

Improvement additionally requires more favorable than unfavorable discordant pairs and exact two-sided McNemar
`p <= 0.05`. Otherwise the strongest passing claim is non-inferiority under this exact frozen study.

## Retained outcome

The signed Run Lock was executed exactly once for all 90 scheduled Sessions, with no retry, replacement, exclusion,
or early stop. The sanitized report is
[`docs/reports/skill-discovery-isolated-confirmation-20260830.json`](../reports/skill-discovery-isolated-confirmation-20260830.json),
SHA-256 `91fc30c82ba481aafdcd023d8247b9588dfe4608ad0c72e53e6be88c83cbe8f5`.

- Raw Pi passed 30/30 Sessions.
- Pi Stuff off passed 27/30 Sessions.
- Pi Stuff on passed 29/30 Sessions.
- Every completed on-arm Session passed the strict direct-read endpoint: 29/29 saw the exact catalog, selected the
  target automatically, made the exact target its first relevant operation through nested `tools.read`, made no
  `tool_search` or other detour, matched required hashes, and returned the exact answer.

Four Suite observations timed out between 61,650 ms and 65,163 ms with zero Provider requests, Tool calls, and tokens:
the matched off/on pair for `isolated-resource-05`, plus off for `isolated-inst-05` and `isolated-inst-07`. Their raw
peers passed, and the on peers for both unmatched off failures passed. Those observations caused four instrumentation
and prompt-boundary violations, failed the Provider-Tool hard invariant, and made the observed ordering
`30/30 > 27/30 < 29/30`. The frozen verdict is therefore `failed`.

The descriptive on-minus-off difference was `+0.0667` with bootstrap interval `[0, 0.1667]`; McNemar had two favorable
and zero unfavorable pairs with `p = 0.5`. This supports Code Mode parity among completed Sessions but cannot override
the failed hard gate. There were no safety, protected-file, or report-privacy violations.

Native Context isolation did not remove the repeated Suite-only pre-Provider timeout shape, so the earlier
Magic-Context-specific diagnosis was insufficient. The report still cannot distinguish initial RPC startup/configuration
commands from prompt preflight. This study remains unchanged and failed. Before another study, the shared runner must
record a bounded timeout phase and a no-Provider real-Host probe must identify the affected boundary.

## Post-outcome timeout diagnosis

Recorded after the retained outcome on 2026-08-30. This diagnosis cannot alter, exclude, or retrospectively reclassify
any V4 observation. The shared RPC client now identifies command versus settlement timeouts and the benchmark retains
the bounded phase `setup`, `prompt-preflight`, `settlement`, `evidence`, or `unknown` for every future timeout.

A no-authentication, no-prompt, offline probe used the same certified Pi executable and loaded the candidate Package
through the same Extension path. It issued only `get_state`, `set_auto_retry(false)`, and
`set_auto_compaction(false)`, so it made no Provider request. In sequential Raw/off/on arms, the first `get_state`
response took 1,088 ms, 24,967 ms, and 25,464 ms respectively. The two later configuration commands took only 2–24
ms in every arm. A second Suite-off probe ran while other repository checks saturated the Host: Suite cold startup
took 34,307 ms, then both configuration commands completed in 26 ms total.

The affected boundary is therefore the first RPC response: the old 60-second general command budget also included
the complete Pi process and Suite Extension cold startup. External CPU contention could exhaust that budget before
prompt preflight or any Provider request, exactly matching V4's four 61–65 second failures. The evidence does not
support Magic Context, Skill selection, Code Mode, prompt preflight, or Agent settlement as the cause of those four
timeouts.

The shared benchmark client now expresses that protocol boundary explicitly. `getInitialState` uses a five-minute
Host-startup budget; later RPC commands retain the 60-second budget and Agent settlement retains 15 minutes. A
real-Host regression proved the separation by setting the ordinary command budget to one second: the 34,307 ms Suite
startup passed through the independent startup budget, and the later commands still completed under the ordinary
budget. This fixes future measurement validity but leaves the frozen V4 failure intact. A new independently locked
study is required for any success-rate claim.

## Public-data policy

The observer inspects Provider payloads and Tool lifecycles only in memory. The sanitized report may retain synthetic
IDs, hashes, path classes, counts, booleans, bounded failure enums, Tool names, timing, token totals, locked identities,
statistics, and verdict. It must not contain credentials, prompts, Assistant text, Skill bodies, Provider payloads,
Session JSON or IDs, private absolute paths, or temporary directories. The runner validates privacy before and after
writing the report, then deletes every temporary project, Session, fixture, auth copy, and observer log.
