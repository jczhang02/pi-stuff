# Skill Discovery real-model benchmark preregistration

Date: 2026-08-30

Status: design and Run Lock frozen; no benchmark Session, Provider request, or outcome has been produced.

This document freezes the study design for Bead `ps-1gd` before implementation or outcome inspection. The benchmark
asks whether Pi Stuff preserves Raw Pi's automatic Skill use, and whether enabling Code Mode introduces any further
degradation. It is a manual authenticated benchmark, not CI or Capability Contract Acceptance. Deterministic tests and
certified real-Host acceptance remain the release gates for the underlying mechanism.

## Question and scope

One exact Provider/model configuration will run three matched arms:

1. **Raw Pi**: the certified Host, the benchmark Skills, and the measurement-only observer; Pi Stuff is absent.
2. **Pi Stuff off**: the same Host, Skills, observer, and candidate Package with Code Mode frozen off.
3. **Pi Stuff on**: the same inputs and candidate Package with Code Mode frozen on and virtual Read active.

The primary comparisons are Pi Stuff off minus Raw Pi, then Pi Stuff on minus Pi Stuff off. The first detects a
Suite-level regression; the second isolates Code Mode. This study does not claim behavior across other models,
Providers, prompts, task sets, or Host versions. Any later cross-model study is separate and cannot replace these
samples.

## Run lock

The pre-outcome Run Lock is complete:

- Provider `openai-codex`, model `gpt-5.6-sol`, reasoning `xhigh`.
- Candidate commit `faeb674303fdd969a96c190826ebcacf5af5b4c1`; Package tree
  `261e1fb3719913a8ca7ed6f62281de3e122cd34c`.
- Runner sources:
  - `scripts/benchmark-skill-discovery.ts`: `0a7d26a7fcfdb5f67af20b38a245bae1239409ba91edca6b33d97d0fbd1fd82a`;
  - `scripts/pi-rpc-client.ts`: `bad75a34475d04209580df6fc68acda606eab87606cd711ac8b449065509eb1e`;
  - `scripts/skill-discovery-benchmark-core.ts`: `4adf0ff5a35dc34b79d5ddaca65c33f93782e4620e95408960ddb9c3898d51a8`;
  - `scripts/skill-discovery-benchmark-evidence.ts`: `b92fc647053c2a5ef047f3e35649ff96f12978f68254497fb093f99b2a25df0a`;
  - `scripts/skill-discovery-benchmark-report.ts`: `72b2c606b2dd8ac7741da24eb22f313604f67d8c316e9522a24791600b0e31c9`;
  - `scripts/skill-discovery-benchmark-session.ts`: `cdabf7392b99c2f63ba08e59d303e6a5e20bcc56239b859258d9fc612122a1bf`.
- Measurement-only observer `test/fixtures/skill-discovery-benchmark-observer.ts`:
  `c7ad035b166ff99950c3138c033e991f6d5ea97b6a3f84d158b3ae34fc7fa705`.
- Immutable manifest `test/fixtures/skill-discovery-benchmark-manifest.jsonl`:
  `07e79e7b89c6477d1f780ccf88c4d064df4a80e1e7fee822d767da388aed2172`.
- Run Lock `test/fixtures/skill-discovery-benchmark-run-lock.json`.
- Sanitized report destination `docs/reports/skill-discovery-benchmark-20260830.json`.

The candidate commit identifies the Package source, not the necessarily later commit that records the Run Lock. To
avoid a self-referential commit hash, preflight requires both that commit and the clean execution tree to resolve to
the exact locked Package tree, then independently hashes every executable runner input, observer, and manifest.

The Host is already fixed to the certified Pi 0.84.4 Linux x64 release executable: SHA-256
`ce91e1f8bff6176c6a23a690bd0bc4c6e1f5bee1b1183cd2a3b1e92d88c9038a`, 104,511,616 bytes. The preflight rejects a
different executable, a dirty candidate tree, a mismatched manifest, or incomplete Run Lock before the first Provider
request. A failed preflight produces no sample and no outcome.

## Tasks and fixtures

The fixed study contains 30 task triads and therefore 90 primary Sessions. Ten tasks belong to each family:

1. **Metadata**: the matching Skill carries a unique frontmatter verification token.
2. **Instruction**: the matching Skill body defines a deterministic transformation needed for the exact answer.
3. **Relative resource**: the matching Skill directs the Agent to one relative resource containing the exact answer.

Each task has a distinct target Skill, two plausible but non-matching decoy Skills, prompt, expected token, and fixture
hash. The same task fixture is used across its three arms; different task IDs never reuse a target Skill or expected
token. Prompts describe the work naturally and never name a Skill, path, `SKILL.md`, Skill command, or instruction to
inspect the Skill catalog. Automatic selection, rather than explicit invocation, is the behavior under study.

The deterministic manifest generator uses seed `20260830`. Before the Run Lock closes, it writes all 30 prompts,
Skill files, relative resources, expected tokens, fixture hashes, and arm orders to one immutable manifest. Outcomes
must not be inspected before that manifest hash is recorded above.

## Ordering and isolation

All six arm permutations occur exactly five times. The manifest generator shuffles the 30 task IDs with seed
`20260830`, then assigns five copies of each permutation. Runs are sequential; no arm is always first.

Every Session receives fresh project, Agent, Session, cache, data, runtime, and temporary directories. Arms share no
Session, cache, generated fixture path, or model history. They use the same prompt, fixture bytes, Tool authority, model
settings, timeout, and measurement observer. The only intended arm differences are Package presence and frozen Code
Mode state. Ordinary discovery Tools remain available so a model's detour is observable rather than prevented.

There are no retries, replacements, post-outcome exclusions, or early stopping. If authentication or provenance fails
before the first Session, the study is incomplete and has no samples. After sampling begins, instrumentation, process,
timeout, Provider, parsing, or model failures are failed observations in their original arms. A later confirmation
study requires a new preregistration and retains this study unchanged.

## Per-Session measures

The primary binary outcome is **automatic Skill-use success**. It passes only when all conditions pass:

1. The first Provider prompt contains exactly one target Skill entry with the expected name, description, and location.
2. The model selects the target without the prompt naming it.
3. The first relevant Tool operation reads the target `SKILL.md` at its exact location. In the Code Mode arm, the outer
   `codemode` call is expected and its first relevant nested operation must be `tools.read`.
4. Before that read, there is no Bash, Find, Grep, List, `tool_search`, Skill-directory scan, Pi documentation/settings
   lookup, historical Session lookup, or read of a decoy Skill.
5. The observed Skill content SHA-256 matches the fixture. Relative-resource tasks also read the exact declared
   resource after the Skill.
6. The final answer exactly matches the task token.
7. Instrumentation, process, Provider, prompt boundary, and protected-file checks pass.

The protected-file check compares complete before/after snapshots of the fresh project tree and generated Agent
`skills/` tree, including unexpected additions. The Provider-owned authentication copy is excluded because OAuth may
rotate it; any model access to authentication, settings, Session, or environment data is independently a safety
violation.

A correct answer without the observed Skill read is a failure. An unsupported claim that the Skill was loaded is a
failure. Additional calls after the required reads do not invalidate success unless they violate a safety or output
contract.

Secondary outcomes are descriptive and never replace the primary gate:

- target catalog visibility and duplicate count;
- automatic target-selection rate;
- direct-read rate and detour taxonomy;
- task correctness, both unconditional and conditional on the Skill read;
- Provider request count, Tool and nested-operation counts, elapsed time, and total tokens;
- Provider Tool names, including the Code Mode invariant that Package-owned exposure is only `codemode` and
  `tool_search`;
- failure class: catalog, selection, detour, read, resource, answer, safety, instrumentation, process, timeout, or
  Provider.

Disabled, unloaded, `disable-model-invocation`, `--no-skills`, explicit `/skill`, and custom-prompt behavior remain
deterministic regression cases. They are not added as post-hoc live-model tasks.

## Statistics and verdict

For arm outcomes `Y_raw`, `Y_off`, and `Y_on`, report each raw success fraction with a Wilson score 95% interval. Report
the paired differences

```text
delta_suite = mean(Y_off - Y_raw)
delta_code  = mean(Y_on  - Y_off)
```

with 20,000 whole-triad bootstrap resamples using fixed seed `20260830` and percentile 95% intervals. Also report the
four paired cells and exact two-sided McNemar result for each comparison. These describe this fixed task set; they are
not population guarantees.

The preregistered verdict passes only when:

- observed primary success rates satisfy `Raw Pi <= Pi Stuff off <= Pi Stuff on`;
- both paired 95% interval lower bounds are greater than `-0.10`;
- all 90 planned observations are retained in their original arms;
- there are zero prompt-boundary, protected-file, instrumentation-integrity, or report-privacy violations; and
- every hard Host, tree, manifest, arm, and Provider-Tool invariant passes.

The `-0.10` uncertainty bound is not permission for an observed ten-point regression: the observed ordering separately
forbids any lower candidate rate. Claim improvement only when the relevant favorable discordant count exceeds the
unfavorable count and exact two-sided McNemar `p <= 0.05`. Otherwise the strongest permitted statement is
"non-inferior under the preregistered Host/model/prompt/fixture/environment and paired gate."

## Observation and public-data policy

The observer inspects complete Provider payloads and Tool lifecycles in memory but never archives them. The report may
contain only arm/task IDs, hashes, relative path classes, counts, booleans, bounded failure enums, Tool names, timing,
token totals, exact model/Host/source identities, statistical summaries, and the final verdict. It must not contain
credentials, prompts, Assistant text, Skill bodies, Provider payloads, Session JSON, Session IDs, private absolute
paths, or machine-specific temporary directories. All temporary projects, Sessions, fixtures, and observer logs are
deleted after the sanitized report is written and validated.
