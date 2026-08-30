# Skill Discovery real-model confirmation preregistration

Date: 2026-08-30

Status: design and Run Lock frozen; no confirmation Session, Provider request, or outcome has been produced.

This is a new confirmation study for Bead `ps-1gd`. It does not replace the retained failed-instrumentation
[first study](skill-discovery-benchmark-20260830.md) or reuse any of its samples. The question remains whether Pi Stuff
preserves Raw Pi's automatic Skill use and whether enabling Code Mode introduces further degradation.

## Reason for confirmation

The first study passed `--tools bash,find,grep,ls,read` to every arm. Pi 0.84.4 applies `--tools` as a strict allowlist
to built-in, extension, and custom Tools, so it excluded the on arm's `codemode` and `tool_search` Tools. Every on-arm
first Provider request consequently exposed no Tools and omitted the Skill catalog. This confirmation changes only the
Tool-selection design needed to make the intended authority reachable, then uses a new seed, tasks, fixtures,
manifest, Run Lock, and report.

## Arms and Tool authority

One exact Provider/model configuration runs three matched arms:

1. **Raw Pi**: certified Host, confirmation Skills, and measurement-only observer; Pi Stuff is absent.
2. **Pi Stuff off**: the same inputs and candidate Package with Code Mode frozen off.
3. **Pi Stuff on**: the same inputs and candidate Package with Code Mode frozen on and virtual Read active.

Every arm receives the identical strict allowlist
`bash,find,grep,ls,read,codemode,tool_search`. Raw Pi does not register the last two names. Pi Stuff off removes its
disabled envelope. Pi Stuff on projects the same five active ordinary Tools behind `codemode` and `tool_search`.
Therefore the required first-request Provider surfaces are exactly:

- Raw Pi and Pi Stuff off: `bash`, `find`, `grep`, `ls`, `read`;
- Pi Stuff on: `codemode`, `tool_search`.

Any other surface, missing Tool, or missing catalog is an instrumentation failure and invalidates the confirmation
verdict. The primary comparisons remain Pi Stuff off minus Raw Pi, then Pi Stuff on minus Pi Stuff off.

## Run Lock

The pre-outcome Run Lock is complete:

- Provider `openai-codex`, model `gpt-5.6-sol`, reasoning `xhigh`.
- Candidate commit `361915932c3a50ffc3d8b2d06108bf289c4f2f3a`; Package tree
  `261e1fb3719913a8ca7ed6f62281de3e122cd34c`.
- Runner sources:
  - `scripts/benchmark-skill-discovery.ts`: `53f810d62a600acf59e09e4e5b9ce9a44331521fa1ede67b1f7ba17af603dcbb`;
  - `scripts/pi-rpc-client.ts`: `bad75a34475d04209580df6fc68acda606eab87606cd711ac8b449065509eb1e`;
  - `scripts/skill-discovery-benchmark-core.ts`: `fc9ad5f4875a48d46899ada9cdabe1beb6171609b42cdfd43cd36e25b2d0239d`;
  - `scripts/skill-discovery-benchmark-evidence.ts`: `b92fc647053c2a5ef047f3e35649ff96f12978f68254497fb093f99b2a25df0a`;
  - `scripts/skill-discovery-benchmark-report.ts`: `72b2c606b2dd8ac7741da24eb22f313604f67d8c316e9522a24791600b0e31c9`;
  - `scripts/skill-discovery-benchmark-session.ts`: `2d5a7ea8180c357c89f798f57e1f8d62937c8fbcd9ed0fef785045269e5e16b9`.
- Measurement-only observer `test/fixtures/skill-discovery-benchmark-observer.ts`:
  `c7ad035b166ff99950c3138c033e991f6d5ea97b6a3f84d158b3ae34fc7fa705`.
- Immutable manifest `test/fixtures/skill-discovery-confirmation-manifest.jsonl`:
  `6fa006d7df5273ed38a9c0176eb02f19f73a9ade768d4ebf0bf8b5bb5d51ae59`.
- Run Lock `test/fixtures/skill-discovery-confirmation-run-lock.json`.
- Sanitized report destination `docs/reports/skill-discovery-confirmation-20260830.json`.

The candidate commit identifies the Package source; the later Run Lock commit cannot self-identify. Preflight instead
requires the candidate and clean execution tree to resolve to the same locked Package tree, and independently hashes
every executable runner input, observer, and manifest.

The Host remains the certified Pi 0.84.4 Linux x64 release executable: SHA-256
`ce91e1f8bff6176c6a23a690bd0bc4c6e1f5bee1b1183cd2a3b1e92d88c9038a`, 104,511,616 bytes. Preflight rejects a
different Host, dirty tree, missing report destination, mismatched source, malformed lock, or unavailable
authentication before the first Provider request. A failed preflight creates no sample.

## New tasks and ordering

The confirmation contains 30 new task triads and 90 primary Sessions: ten metadata, ten deterministic instruction,
and ten relative-resource tasks. Task IDs begin with `confirm-`; target Skill names, natural-language subjects, and
expected tokens are all distinct from the first study. Prompts never name a Skill, path, `SKILL.md`, command, or
catalog-inspection instruction.

The deterministic generator uses seed `20260831`. It writes every prompt, target and decoy Skill, relative resource,
expected token, fixture hash, and arm order to one immutable JSON Lines manifest before the Run Lock. All six arm
permutations occur exactly five times after seeded task shuffling. Runs are sequential; no arm is always first.

Each Session receives fresh project, Agent, Session, cache, config, data, runtime, state, and temporary directories.
Arms share no Session, cache, fixture path, model history, or mutable authentication copy. They share exact prompt and
fixture bytes, underlying ordinary Tool authority, model settings, timeout, and observer.

There are no retries, replacements, post-outcome exclusions, or early stopping. After sampling begins, every
instrumentation, process, timeout, Provider, parsing, or model failure remains a failed observation in its original
arm. Any later run requires another preregistration and retains this confirmation unchanged.

## Per-Session measures

Automatic Skill-use success requires every condition below:

1. The first Provider prompt contains exactly one target Skill entry with the expected name, description, and location.
2. The model selects the target without the prompt naming it.
3. The first relevant Tool operation reads the exact target `SKILL.md`; on uses an outer `codemode` call whose first
   relevant nested operation is `tools.read`.
4. No Bash, Find, Grep, List, `tool_search`, Skill-directory scan, Pi documentation/settings lookup, historical
   Session lookup, or decoy read occurs before the target read.
5. Observed Skill content SHA-256 matches the fixture; relative-resource tasks then read the exact declared resource.
6. The final answer exactly matches the task token.
7. Provider-Tool, instrumentation, process, Provider, prompt-boundary, protected-file, and privacy checks pass.

The protected-file check compares complete before/after snapshots of the fresh project and generated Agent `skills/`
trees, including unexpected additions. Provider-owned authentication may rotate and is excluded; any model access to
authentication, settings, Session, or environment data is independently a safety violation.

Secondary fields retain catalog, selection, read, detour, content-hash, resource, answer, Provider-request, Tool-call,
nested-operation, timing, token, failure-class, safety, and integrity evidence. Correct answer text never substitutes
for an observed exact Skill read.

## Statistics and verdict

Each arm reports its success fraction and Wilson 95% interval. The two paired differences use 20,000 whole-triad
bootstrap resamples with seed `20260831` and percentile 95% intervals. Exact two-sided McNemar results report all four
paired cells.

The confirmation passes only if:

- observed rates satisfy `Raw Pi <= Pi Stuff off <= Pi Stuff on`;
- both paired interval lower bounds are greater than `-0.10`;
- all 90 observations remain in their original arms;
- prompt-boundary, protected-file, instrumentation-integrity, safety, and report-privacy violations are zero; and
- every Host, tree, source, manifest, schedule, arm, model, and Provider-Tool hard invariant passes.

Improvement additionally requires more favorable than unfavorable discordant pairs and exact two-sided McNemar
`p <= 0.05`. Otherwise the strongest passing claim is non-inferiority under this exact frozen study.

## Public-data policy

The observer inspects Provider payloads and Tool lifecycles only in memory. The sanitized report may contain IDs,
hashes, relative path classes, counts, booleans, bounded failure enums, Tool names, timing, token totals, exact locked
identities, statistics, and verdict. It must not contain credentials, prompts, Assistant text, Skill bodies, Provider
payloads, Session JSON or IDs, private absolute paths, or temporary directories. The runner validates the report before
and after writing it, then deletes all temporary projects, Sessions, fixtures, authentication copies, and observer logs.
