# Code Mode image benchmark preregistration

Date: 2026-08-27

This document freezes the real-model benchmark before any benchmark outcome is observed. The runner is
[`scripts/benchmark-code-mode-image.ts`](../../scripts/benchmark-code-mode-image.ts), and the Provider-boundary
observer is
[`test/fixtures/code-mode-image-benchmark-observer.ts`](../../test/fixtures/code-mode-image-benchmark-observer.ts).

## Question and immutable inputs

The benchmark asks whether the Code Mode image compatibility and discovery patch improves successful image handling
without allowing damaged images or increasing standing Provider context.

- Host: certified Pi 0.84.3 release artifact.
- Provider/model: `openai-codex/gpt-5.6-sol`, medium Thinking, image input enabled.
- Baseline Package commit/tree: `65b676474cc73411b62bf2cab1c910e2e359a6b9` /
  `24cab67c6893732155ad113747b7f8830335d5c9`.
- Candidate Package commit/tree: `4487a063d1e2693e00e5fbe12ff523366d670baa` /
  `480dcad7f133d4eee1d13ed243620b3111561a96`.
- Prompt: “Inspect challenge.png with the available image Tool. Reply with exactly the six digits shown and nothing
  else. Do not use shell commands or encode the file as text.”
- Resume prompt: “Reply exactly SESSION_SAFE”.
- Twenty fixed six-digit fixtures per arm, in this order: `731905`, `284167`, `609352`, `418730`, `952641`,
  `367824`, `805219`, `146593`, `573086`, `920475`, `238761`, `694028`, `351972`, `782436`,
  `469105`, `817354`, `205687`, `936412`, `542809`, `173648`.
- Pair order alternates: candidate then baseline for odd-numbered fixtures, baseline then candidate for even-numbered
  fixtures.

Each fixture is rendered by the checked-in deterministic grayscale PNG generator. Every run gets a fresh project,
Session directory, temporary directory, runtime directory, and Session ID. Context files, prompt templates, discovered
Extensions, and discovered Skills are disabled. Ponytail is set to `off`; inherited child-Agent and frozen Code Mode
environment values are cleared. Code Mode is enabled by project settings. Runs are sequential to avoid concurrency and
rate-limit asymmetry.

There are 40 independent primary Sessions: 20 baseline and 20 candidate. Tool use and the mandatory resume check can
produce more than one Provider request per Session; the report records the actual request count. No run is retried,
replaced, or excluded. An instrumentation, process, Provider, parsing, or resume failure counts as a failed sample.

## Measures and gates

For each Session, the runner records these booleans:

1. **Tool choice:** nested Code Mode operations contain `view_image`, contain neither `read` nor `bash`, and the
   Code Mode program does not call the explicit `image(...)` helper.
2. **Exact transfer:** the complete Provider payload is traversed in memory; every observed image is canonical PNG, and
   at least one image has the same SHA-256 as the fixture file.
3. **Understanding:** the first final answer is exactly the six fixture digits.
4. **Session safety:** Session JSON contains exactly one decoder-readable image with the fixture SHA-256; a new real Pi
   process resumes that Session, its complete Provider payload contains the same valid image, and the model answers
   exactly `SESSION_SAFE`.
5. **End to end:** instrumentation, Tool choice, exact transfer, understanding, Session safety, and successful Code Mode
   status all pass.

The complete payload is inspected but never archived. The observer archives only payload SHA-256, byte count, traversed
node count, Tool names, Code Mode and total Provider Tool-definition character counts, and image byte/hash/validity metadata. Session and
fixture directories are deleted after the run. The report contains no credentials or machine-specific temporary paths.

Candidate acceptance requires:

- exact transfer: 20/20;
- Session safety and exactly-once image persistence: 20/20;
- no corrupt, truncated, unsupported, or undecodable persisted image: 20/20;
- Tool choice: at least 18/20;
- understanding: at least 18/20;
- end to end: at least 18/20;
- every candidate sample has valid instrumentation and no Code Mode error;
- candidate total Provider Tool-definition size is no greater than baseline.

The report gives raw fractions and Wilson score 95% binomial intervals for both arms. The baseline is descriptive and is
not subject to candidate acceptance thresholds. Separate matched real Claude Code and Pi Host screenshot evidence owns
Viewed-image UI visual acceptance; this behavioral benchmark does not infer pixels from model text or PTY strings.

Run from the candidate worktree with a baseline repository root that still has the preregistered Package tree:

```sh
bun run benchmark:code-mode-image --baseline-root <absolute-baseline-root> --output <absolute-report-path>
```

## Pre-outcome clarification

Recorded at 2026-08-26T01:17:43Z after the runner started and before any run output, log, or outcome was inspected:
`--no-skills` disables ordinary discovered Skills, but Pi 0.84.3 can still expose Skills declared by the explicitly loaded
Pi Stuff Package. Ponytail's standing contribution remains `off`; the Package-declared Skill catalog is the same in both
arms and is part of the real installed-Package target surface. No benchmark input, ordering, measure, threshold, or
failure policy changed.
