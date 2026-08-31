# Skill Discovery direct-read real-model preregistration

Date: 2026-08-30

Status: completed exactly once; retained as a failed study because two Suite Sessions timed out before any Provider
request.

This is a new, independent study for Bead `ps-1gd`. It does not replace or reuse samples from the retained
[first benchmark](skill-discovery-benchmark-20260830.md) or
[confirmation](skill-discovery-confirmation-20260830.md). It tests whether the final candidate preserves automatic,
direct Skill selection and loading when Code Mode virtualizes Read.

## Reason for this study

The first benchmark accidentally excluded `codemode` and `tool_search` through Pi's strict `--tools` allowlist. The
confirmation corrected that surface and completed 90 Sessions. In each of its 29 completed on-arm Sessions, the model
saw the exact Skill catalog, selected and read the exact target, matched its content and optional resource hashes, and
answered exactly. Every one first called `tool_search`, however, so all failed the frozen direct-read gate. Six also
received a post-settlement process flag because the RPC close helper treated a signal-terminated child as still live.

The new candidate makes only the two repairs justified by that retained evidence:

1. The Code Mode Skill projection bridges Pi's ordinary Read wording to a direct `codemode` `tools.read` call and says
   that the already-known Read method needs no `tool_search` or scan.
2. The shared RPC helper recognizes either an exit code or signal code as terminal.

The strict behavioral endpoint is unchanged. New task identities, prompts, Skill names, tokens, fixtures, seed,
manifest, Run Lock, and report prevent outcome reuse or tuning.

## Arms and Tool authority

One exact Provider/model configuration runs three matched arms:

1. **Raw Pi**: certified Host, study Skills, and measurement-only observer; Pi Stuff is absent.
2. **Pi Stuff off**: the same inputs and candidate Package with Code Mode frozen off.
3. **Pi Stuff on**: the same inputs and candidate Package with Code Mode frozen on and virtual Read active.

Every arm receives the identical strict allowlist
`bash,find,grep,ls,read,codemode,tool_search`. The required Provider surfaces remain exactly:

- Raw Pi and Pi Stuff off: `bash`, `find`, `grep`, `ls`, `read`;
- Pi Stuff on: `codemode`, `tool_search`.

Raw Pi ignores the two unregistered Code Mode names. Pi Stuff off removes its disabled envelope. Pi Stuff on projects
the same five ordinary Tools behind its two-Tool envelope. Missing or extra Tools, a missing catalog, or an invalid
Provider boundary is an instrumentation failure.

## Run Lock

The pre-outcome Run Lock is complete:

- Provider `openai-codex`, model `gpt-5.6-sol`, reasoning `xhigh`.
- Candidate commit `518af59db690bd7751ae6e08db9a6750fa411894`; Package tree
  `8d9d7220f39f49fb25d7b7ccb9282b75aedf1c15`.
- Runner sources:
  - `scripts/benchmark-skill-discovery.ts`: `263670606ce48c8f1ac63575a5a7efeb529f0c43b1c530282eb242399859a101`;
  - `scripts/pi-rpc-client.ts`: `75182f6d2a3cbf3a4369921e94063ef6153eacb95dc683397d95b1d943e09eff`;
  - `scripts/skill-discovery-benchmark-core.ts`: `44ecc6df41d951a5f73401509169688147085cdbd4b9e7e45dc6ebe47346a8b9`;
  - `scripts/skill-discovery-benchmark-evidence.ts`: `b92fc647053c2a5ef047f3e35649ff96f12978f68254497fb093f99b2a25df0a`;
  - `scripts/skill-discovery-benchmark-report.ts`: `72b2c606b2dd8ac7741da24eb22f313604f67d8c316e9522a24791600b0e31c9`;
  - `scripts/skill-discovery-benchmark-session.ts`: `2d5a7ea8180c357c89f798f57e1f8d62937c8fbcd9ed0fef785045269e5e16b9`.
- Measurement-only observer `test/fixtures/skill-discovery-benchmark-observer.ts`:
  `c7ad035b166ff99950c3138c033e991f6d5ea97b6a3f84d158b3ae34fc7fa705`.
- Immutable manifest `test/fixtures/skill-discovery-direct-read-manifest.jsonl`:
  `d4a6d02e3c0b9cbb5501bd8e0ac9b6d508de2ab947a6472d101acee28c5b93c1`.
- Run Lock `test/fixtures/skill-discovery-direct-read-run-lock.json`.
- Sanitized report destination `docs/reports/skill-discovery-direct-read-20260830.json`.

The Host remains the certified Pi 0.84.4 Linux x64 release executable: SHA-256
`ce91e1f8bff6176c6a23a690bd0bc4c6e1f5bee1b1183cd2a3b1e92d88c9038a`, 104,511,616 bytes. Preflight rejects a
different Host, dirty tree, mismatched Package tree, source, observer, manifest, model configuration, authentication,
or existing report before the first Provider request. The later Run Lock commit cannot self-identify, so the candidate
commit and clean execution tree must resolve to the same locked Package tree while every runner input is hashed
independently.

The runner and deterministic generator at current HEAD own only this study. Each retained earlier study is bound to
its own signed Run Lock commit and exact runner-source hashes, and is reconstructed from that commit rather than by
treating the current study generator as a backward-compatible multi-study API.

## Tasks, order, and isolation

The study contains 30 new matched triads and 90 primary Sessions: ten metadata, ten deterministic-instruction, and ten
relative-resource tasks. IDs begin with `direct-`, target Skills with `sd-direct-`, and expected tokens use the
`*_DIRECT_*` namespace. None occurs in the earlier studies. Prompts describe the work naturally and never name a
Skill, path, `SKILL.md`, command, catalog, or inspection step.

The deterministic generator uses seed `20260901`. Its immutable JSON Lines manifest records every prompt, target and
decoy Skill, relative resource, expected token, fixture hash, and arm order. All six arm permutations occur exactly
five times after seeded task shuffling. Sessions run sequentially with command timeout 60 seconds and Agent-settle
timeout 15 minutes.

Each Session receives fresh project, Agent, Session, cache, config, data, runtime, state, and temporary directories.
Arms share exact prompt and fixture bytes, ordinary Tool authority, model configuration, observer, and timeouts, but no
Session, cache, fixture path, model history, mutable authentication copy, or temporary state.

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

The protected-file check compares complete before/after snapshots of the fresh project and generated Agent `skills/`
trees. Provider-owned authentication may rotate and is excluded from that byte comparison; model access to auth,
settings, Session, environment, or unrelated user data is a separate safety violation. Correct output never
substitutes for an observed exact Skill read.

## Statistics and verdict

Each arm reports its success fraction and Wilson 95% interval. Pi Stuff off minus Raw Pi and Pi Stuff on minus off use
20,000 whole-triad bootstrap resamples with seed `20260901` and percentile 95% intervals. Exact two-sided McNemar
results report all four paired cells.

The study passes only if:

- observed rates satisfy `Raw Pi <= Pi Stuff off <= Pi Stuff on`;
- both paired interval lower bounds are greater than `-0.10`;
- all 90 observations remain in their original arms;
- prompt-boundary, protected-file, instrumentation, safety, and report-privacy violations are zero; and
- every Host, Package tree, source, manifest, schedule, arm, Provider/model, and Provider-Tool hard invariant passes.

Improvement additionally requires more favorable than unfavorable discordant pairs and exact two-sided McNemar
`p <= 0.05`. Otherwise the strongest passing claim is non-inferiority under this exact frozen study.

## Retained outcome

The signed Run Lock was executed exactly once for all 90 scheduled Sessions, with no retry, replacement, exclusion,
or early stop. The sanitized report is
[`docs/reports/skill-discovery-direct-read-20260830.json`](../reports/skill-discovery-direct-read-20260830.json),
SHA-256 `5217d70e612b5e8e52d9ea7cc3b5948a48ab486c09fccddab35f091c5fdc8733`.

- Raw Pi passed 30/30 Sessions.
- Pi Stuff off passed 29/30 Sessions.
- Pi Stuff on passed 29/30 Sessions.
- Every completed on-arm Session passed the strict direct-read endpoint: 29/29 saw the exact catalog, selected the
  target automatically, made the exact target its first relevant operation through nested `tools.read`, made no
  `tool_search` or other detour, matched required hashes, and returned the exact answer.

The matched `direct-meta-04` off and on Sessions timed out after 65,622 ms and 65,164 ms respectively, before any
Provider request or Tool call; the raw Session for the same task passed. Those two retained observations caused two
instrumentation and prompt-boundary violations, failed the Provider-Tool hard invariant, and made the observed rate
ordering `30/30 > 29/30 = 29/30`. The frozen verdict is therefore `failed`. The on-minus-off paired difference was
exactly zero with bootstrap interval `[0, 0]`; that descriptive result does not override the failed hard gate.

Post-outcome code-path inspection found the same confound as the earlier confirmation: Pi's RPC prompt response waits
for prompt preflight, which includes Pi Stuff's `before_agent_start` handlers. A fresh direct RPC input starts the
optional Magic Context Worker in both Suite arms, and that initialization path has no internal deadline; raw Pi does
not load it. The sanitized report did not retain the exact timed-out RPC phase, so this evidence identifies a strong
shared-runner confound rather than proving the precise stalled await. This study remains unchanged and failed. A later
study must preregister native Context isolation before producing any new outcome.

## Public-data policy

The observer inspects Provider payloads and Tool lifecycles only in memory. The sanitized report may retain synthetic
IDs, hashes, path classes, counts, booleans, bounded failure enums, Tool names, timing, token totals, locked identities,
statistics, and verdict. It must not contain credentials, prompts, Assistant text, Skill bodies, Provider payloads,
Session JSON or IDs, private absolute paths, or temporary directories. The runner validates privacy before and after
writing the report, then deletes every temporary project, Session, fixture, auth copy, and observer log.
