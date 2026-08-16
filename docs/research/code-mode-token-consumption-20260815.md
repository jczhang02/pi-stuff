# Code Mode token-consumption experiment

Date: 2026-08-15
Repository commit: `49f8b1b5456c0b169e2c544e9cc149a497ce4472`
Certified Host: Pi `0.84.2`
Toolchain: Bun `1.3.14`

## Question

Did introducing Code Mode actually reduce token consumption, rather than only making the serialized Tool schema look
smaller?

## Finding

Yes. In the controlled live-provider runs below, Code Mode reduced provider-reported total tokens by 48.6% to 73.0%,
depending on the model and task. On the repeated `gpt-5.4-mini` samples, the median reduction was 59.4% for one Read and
63.0% for a two-Read-plus-Bash task. A three-turn Session with no Tool calls used 26,739 total tokens in direct mode and
7,287 in Code Mode, a 72.7% reduction.

The earlier fixture claim is directionally correct but is not a live-provider measurement. The fixture run made here
estimated 9,573 first-request input tokens in direct mode and 1,139 in Code Mode, an 88.1% reduction. The corresponding
live OpenAI Codex Responses requests used 8,871 and 2,389 input tokens, a smaller but still material 73.1% reduction.

Token reduction did not imply equal reliability. In the three single-Read Code Mode trials, one returned an empty final
answer and another first issued a failing Code Mode program before recovering. The direct trials were correct without
Tool errors. The `gpt-5.6-luna` multi-Tool Code Mode trial also recovered from one failed program. Code Mode should remain
opt-in until task-level completion quality is measured on a representative workload and the observed result-shape
confusion is addressed.

## Why savings are expected

The accepted design replaces the active Suite Tool definitions with one `codemode({ code })` envelope on every provider
request, while keeping the full catalog inside the local V8 Connector
([ADR 0005](../adr/0005-wrap-active-suite-tools-in-one-local-code-mode-envelope.md#wrap-active-suite-tools-in-one-local-code-mode-envelope)).
The current outer contract is one string parameter and a short description
([extension source](../../packages/pi-stuff/src/code-mode/extension.ts)). The direct surface in this experiment contained
22 Tools.

The repository's acceptance fixture is useful for exact surface comparison but cannot report provider usage: its
Assistant messages deliberately use zero usage
([fixture source](../../test/fixtures/code-mode-provider.ts)). Its token result is an estimate composed from character
counts and Pi's message estimator, not a provider billing tokenizer. The TUI verifier enforces only that the estimate
decreases and can emit the compared request metadata
([verifier source](../../scripts/verify-code-mode-tui.ts)).

## Method

All live arms used the same repository checkout, working directory, prompt, Host, and model. Each arm loaded only the
Pi Stuff Package and disabled discovered Extensions, Skills, Prompt Templates, context files, and themes. Thinking was
off. `PI_STUFF_CODE_MODE_DEFAULT=on` selected Code Mode and `off` selected the direct surface. Telemetry was disabled.

The live commands followed this shape, with `PI_BIN` pointing to the certified Host executable:

```sh
PI_STUFF_CODE_MODE_DEFAULT=on PI_TELEMETRY=0 \
  "$PI_BIN" \
  --provider openai-codex \
  --model gpt-5.4-mini \
  --thinking off \
  --mode json \
  --no-session \
  --no-extensions \
  --extension packages/pi-stuff/index.ts \
  --no-skills \
  --no-prompt-templates \
  --no-context-files \
  --no-themes \
  --approve \
  --print '<prompt>'
```

The direct arm changed only `PI_STUFF_CODE_MODE_DEFAULT=off`. The three-turn experiment used isolated `--session-dir`
directories and resumed the same Session for turns two and three.

For every run, the measurement summed `usage.totalTokens` from all Assistant responses, including responses that
requested Tools and the final response. OpenAI's usage separates uncached `input` from `cacheRead`; `totalTokens`
includes both, so prompt-cache hits do not make logical context consumption disappear. The displayed cost is Pi's
nominal model-price calculation for the reported usage, not evidence of an invoice charge on the OAuth subscription.

Correctness required an exact expected final value:

- Control: return `TOKEN_CONTROL` without Tools.
- Single Read: read the root `package.json` and return `bun@1.3.14`.
- Multi-Tool: read both Package manifests, run `git rev-parse --short HEAD`, and return the exact three-field JSON object.
- Three-turn Session: return `TURN_ONE`, `TURN_TWO`, and `TURN_THREE` on successive no-Tool turns.

## Results

### Offline public-estimator fixture

| Measure | Direct | Code Mode | Reduction |
| --- | ---: | ---: | ---: |
| Provider-visible Tool count | 22 | 1 | 95.5% |
| Serialized Tool-schema characters | 31,208 | 1,251 | 96.0% |
| System-prompt characters | 6,473 | 2,695 | 58.4% |
| Estimated first-request input tokens | 9,573 | 1,139 | 88.1% |

The verifier also passed identical group Activity and full-screen layout before and after Session resume at 100 and 64
columns, excluding the context-usage number that the experiment is intended to change.

### Live `gpt-5.4-mini` provider usage

| Task | Repeats | Direct total tokens | Code Mode total tokens | Reduction | Exact completion |
| --- | ---: | ---: | ---: | ---: | --- |
| No-Tool control | 3 | 8,877 median | 2,395 median | 73.0% | 3/3 direct, 3/3 Code Mode |
| Single Read | 3 | 18,932 median | 7,686 median | 59.4% | 3/3 direct, 2/3 Code Mode |
| Two Reads plus Bash | 3 | 19,927 median | 7,379 median | 63.0% | 3/3 direct, 3/3 Code Mode |

Raw total-token observations:

| Task | Direct | Code Mode |
| --- | --- | --- |
| No-Tool control | 8,877; 8,877; 8,877 | 2,395; 2,395; 2,395 |
| Single Read | 18,932; 18,932; 18,932 | 7,686; 6,199; 8,980 |
| Two Reads plus Bash | 19,929; 19,927; 19,927 | 7,379; 7,387; 7,379 |

The first Single Read Code Mode observation returned an empty final answer. The third returned the correct answer after
one failed envelope execution. A separate diagnostic reproduction also showed the model repeatedly treating the
`suite.read(...)` result as a string before discovering that the Tool returns an object whose text is under `content`.
The Package README demonstrates the correct access as `result.content[0].text`, but the short model-facing common-call
description only names the call and not its return shape.

### Three-turn Session

| Mode | Turn 1 | Turn 2 | Turn 3 | Session total | Nominal cost |
| --- | ---: | ---: | ---: | ---: | ---: |
| Direct | 8,877 | 8,910 | 8,952 | 26,739 | $0.0111624 |
| Code Mode | 2,395 | 2,428 | 2,464 | 7,287 | $0.0055365 |

Code Mode reduced total tokens by 72.7% and nominal cost by 50.4%. Direct mode received 13,312 cached-input tokens over
turns two and three, while Code Mode received no cache hits in this run. This is why the cost reduction was smaller than
the total-token reduction.

One additional warm-cache control observation made the same direct request nominally cheaper than Code Mode despite
using 3.7 times as many total tokens: direct used 8,877 total tokens with 8,704 cached and cost $0.00080505, while Code
Mode used 2,395 uncached tokens and cost $0.00181875. Schema reduction therefore does not guarantee a cheaper individual
request when the larger direct prefix is already cached.

### Cross-model check with `gpt-5.6-luna`

| Task | Direct total tokens | Code Mode total tokens | Reduction | Result |
| --- | ---: | ---: | ---: | --- |
| No-Tool control | 8,877 | 2,395 | 73.0% | Both exact |
| Two Reads plus Bash | 20,035 | 10,298 | 48.6% | Both exact; Code Mode recovered from one failed program |

The multi-Tool nominal cost fell from $0.00263628 to $0.00163332, a 38.0% reduction. This is one sample and supports only
the direction of the token result, not a model-wide reliability claim.

## Interpretation

Code Mode solves the fixed Tool-schema problem it was designed to solve. The live first-request reduction was 6,482
input tokens, and the advantage persisted across later provider requests and Tool-result turns. It also reduced context
when the model did not consolidate several operations into one Code Mode program.

Three qualifications matter:

1. The documented 9,656-to-1,222 figure is an estimator result, not provider usage. The current fixture produced
   9,573-to-1,139, while live usage was 8,871-to-2,389.
2. Prompt caching discounts price but not context-window occupancy. It can make the direct arm's nominal cost advantage
   much better than its total-token count suggests, and occasionally better than Code Mode for one warm request.
3. A smaller context is useful only if task completion remains acceptable. The observed return-shape mistakes show a
   real reliability and extra-round-trip cost that the deterministic acceptance fixture cannot measure.

## Recommendation

Keep Code Mode available and opt-in: it demonstrably reduces provider-visible and provider-reported token consumption.
Do not promote it to the default from token numbers alone. First add a small live, credentialed maintainer benchmark
outside the automated test suite that records completion, envelope failures, provider requests, total tokens, cache
tokens, and nominal cost over representative Read/Bash/Edit and Capability-discovery tasks. Automated repository tests
must remain credential-free.

The smallest likely reliability improvement to evaluate is making the model-facing common `suite.read` example show
the actual result access already used in the README: `result.content[0].text`. Re-run the same exact-completion corpus
before adopting that change; the current evidence identifies a likely instruction gap, not proof that one prompt edit
fully resolves it.
