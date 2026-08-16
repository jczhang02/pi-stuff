# Code Mode reference comparison and revised design

Date: 2026-08-15
Status: design proposal
Scope: Pi Stuff Code Mode model contract, Tool routing, execution, and recovery

This report records the Cloudflare-parity proposal made before the OpenAI review, summarizes the official OpenAI
model, and proposes a replacement design. It does not amend accepted
[ADR 0005](../adr/0005-wrap-active-suite-tools-in-one-local-code-mode-envelope.md). If the replacement is accepted,
that ADR must be revised before implementation because the new routing policy deliberately stops treating every
active Suite Tool as programmatic-only.

## Decision in one paragraph

Use OpenAI's Programmatic Tool Calling and Codex Code Mode as the canonical model-facing contract because Pi Stuff
already runs the official Codex V8 Host and serves OpenAI models. Reuse Cloudflare Code Mode for the parts it has
developed further: permissive source normalization, typed connector discovery, result unwrapping, durable execution
history, replay, rollback, and snippets. Keep the existing Pi Tool registry, V8 runtime, and Session entries as the
three implementation seams. Do not add a second runtime or generic adapter framework.

The resulting rule is simple:

- models should normally write top-level JavaScript using `tools.*`, `await`, and `text(...)` or `image(...)`;
- Cloudflare's async-arrow-and-`return` form and Pi Stuff's existing `suite.*` name remain accepted compatibility
  forms;
- every Tool explicitly declares whether it may be called directly, programmatically, or both;
- the running V8 cell is resumed after nested calls; replay is a recovery mechanism only and is automatic only for
  calls declared replay-safe.

## Evidence already established locally

The local live-provider experiment found that Code Mode materially reduced provider-reported total tokens, but it
also exposed result-shape and final-output mistakes. The measured reduction was 48.6% to 73.0%, depending on the model
and task. See the [token-consumption report](./code-mode-token-consumption-20260815.md).

The Cloudflare investigation then confirmed that generated programs do make both syntactic and semantic mistakes in
production. Cloudflare responds with narrow normalization, runtime validation, and actionable errors rather than
prompting alone or silent coercion. See the
[call-reliability report](./cloudflare-code-mode-call-reliability-20260815.md).

Those findings still stand. The recommendation below changes because the later OpenAI research revealed an official
contract that is closer to Pi Stuff's existing runtime than the Cloudflare Worker contract is.

## Scheme A: recorded Cloudflare-parity proposal

This is the revised proposal that immediately preceded the OpenAI research.

### Reference and model contract

- Treat `@cloudflare/codemode` 0.5.1 as the compatibility target, not merely an inspiration.
- Make the canonical generated program an async arrow function whose returned value is the Code Mode result:

  ```js
  async () => {
    const result = await service.method({ key: "value" });
    return result;
  }
  ```

- Replace Pi Stuff's private `codemode.resultText()` and `codemode.emitText()` dialect with the Cloudflare contract.
- Preserve `registry.invoke()` so nested calls still pass through Pi validation, hooks, permissions, and Tool display.

### Reuse policy

1. Import Cloudflare code directly when it is host-neutral.
2. Where the package's public entry cannot run in Pi because it imports `cloudflare:workers`, vendor the exact pure
   upstream source with version, commit, integrity, licence, and upstream tests.
3. Write only Pi-specific adapters: a V8 executor, a Suite connector, and a Session store.
4. Prefer an upstream host-neutral package export later, but do not block Pi Stuff on it.

### Parity scope

The proposal included Cloudflare's source normalizer, connector name sanitation, `search` and `describe` TypeScript
descriptions, result unwrapping, value formatting and truncation, console capture, stable execution identifiers,
approval pause and replay, deterministic replay policy, rollback, history, snippets, retention and expiry, binary
codec, and connector lifecycle.

Its primary execution model was a durable append-only log. Approval and recovery would replay the program against
recorded results, while calls that had not yet completed would run normally.

### Delivery sequence

1. Match the model-facing interface and normalization behavior.
2. Add the executor and connector abstractions.
3. Add durable execution, approval, replay, rollback, history, and snippets.
4. Add compatibility fixtures and live-provider evaluation.

## What official OpenAI sources say

### Programmatic Tool Calling is OpenAI's direct equivalent

OpenAI's public name for this pattern is **Programmatic Tool Calling**. In the Responses API, the model writes
JavaScript that coordinates eligible Tools inside an isolated V8 runtime. Programs can use top-level `await`, loops,
conditions, and parallel calls, and they emit model-visible output through `text(...)` and `image(...)`. The runtime
does not expose Node.js, arbitrary networking, the filesystem, subprocesses, `console`, or persistent JavaScript
state. External effects happen only through allowed Tools
([OpenAI Programmatic Tool Calling guide](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling)).

OpenAI does not put every Tool behind the program. Each Tool has an `allowed_callers` policy: direct only,
programmatic only, or both. The guide recommends direct calls for isolated calls, judgment-heavy sequences, unknown
result shapes, citation-sensitive output, and approval-sensitive writes by default. Programmatic calls fit bounded,
predictable control flow whose intermediate data can be reduced to a compact structured result.

The same guide makes structured result contracts, explicit failures, argument and permission validation,
idempotency, bounded retries, and approval for high-impact work part of Tool design. It recommends evaluating task
success and evidence before comparing tokens, latency, cost, calls, turns, and retries.

### Discovery happens before a program starts

OpenAI Tool Search keeps deferred Tool schemas out of the initial prompt and loads only relevant definitions. Search
is a top-level model action; an already-running JavaScript program cannot discover and load a new Tool into itself.
The required Tools must be found before a later program uses them
([OpenAI Tool Search guide](https://developers.openai.com/api/docs/guides/tools-tool-search)).

This separates two concerns that the Cloudflare client API combines: catalog discovery and program execution.

### Codex has a concrete Code Mode protocol

The open-source Codex implementation exposes Code Mode as a free-form JavaScript Tool backed by an in-process V8
Host. The Tool accepts source text rather than a `{ code: string }` function-style argument. Nested Tool calls are
associated with the parent program, pass through the normal Tool runtime and hooks, and return to the suspended cell.
Function Tool arguments must still be JSON objects, while free-form Tools receive strings. The runtime prevents the
program from recursively invoking its own execute Tool and truncates output by tokens
([execute specification](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/code_mode/execute_spec.rs),
[runtime implementation](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/code_mode/mod.rs),
[response adapter](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/code_mode/response_adapter.rs)).

Current Codex source marks local Code Mode as under development and disabled by default. This is useful implementation
evidence, but it is not a stable public compatibility promise
([Codex feature registry](https://github.com/openai/codex/blob/main/codex-rs/features/src/lib.rs)).

## Scheme B: OpenAI-native, Cloudflare-compatible design

### 1. Canonical program syntax

The prompt and examples should teach one OpenAI-native form:

```js
const [left, right] = await Promise.all([
  tools.read({ path: "left.json" }),
  tools.read({ path: "right.json" }),
]);

text(JSON.stringify({ left: left.value, right: right.value }));
```

The contract is:

- JavaScript, not TypeScript;
- top-level `await`;
- `tools.<name>(args)` is canonical;
- `text(...)` and `image(...)` are the explicit output path;
- no `console`, Node.js, network, filesystem, or subprocess access except through Tools;
- safe independent reads may use `Promise.all`;
- one bounded program should return only the evidence the model needs.

The outer Pi Tool should use free-form source if Pi's certified public Tool interface can represent it. If Pi 0.84.2
only supports object-schema Tools, keep `codemode({ code })` as a transport adapter. The JavaScript inside `code` must
still follow the canonical contract above; transport limitations must not create another execution dialect.

### 2. Compatibility normalizer

Reuse Cloudflare's pure normalization behavior so the runtime also accepts:

- Markdown code fences;
- `export default` wrappers;
- named function declarations;
- raw statements and trailing expressions;
- Cloudflare's `async () => { ...; return value; }` form;
- the existing `suite.*` global as an alias of `tools.*`.

When a compatibility form returns a value without calling an output helper, the adapter should emit that value once.
It must not duplicate output if `text(...)` or `image(...)` was already called. Invalid TypeScript should fail with a
line and column; do not attempt regex-based TypeScript stripping.

`codemode.resultText()` and `codemode.emitText()` should not become public model vocabulary. Their useful behavior—
validating result shape and emitting one final value—belongs in the Tool-result adapter and compatibility layer.

### 3. Explicit caller routing

Add one caller policy to the existing Tool catalog:

| Policy | Meaning | Default use |
| --- | --- | --- |
| `direct` | The model calls the Tool directly. | Writes, approvals, semantic/adaptive steps, citations, native artifacts, or unknown output shapes. |
| `programmatic` | Only JavaScript can call the Tool. | Predictable structured reads or transforms. |
| `both` | Either path is valid. | Safe Tools useful alone and in bulk workflows. |

An unclassified Tool defaults to `direct`. This is a safety default, not a permanent ban on writes in Code Mode. A
write may be marked `programmatic` or `both` when it has explicit approval behavior, a stable structured result,
idempotency or a replay policy, and tests for interruption at the side-effect boundary.

Every nested call must continue to use the existing central `registry.invoke()` seam. Code Mode must not duplicate
argument validation, permission checks, lifecycle hooks, Tool display, or result construction.

### 4. Deferred catalog discovery

Expose at most two small definitions initially: `tool_search` and the Code Mode execute Tool. `tool_search` returns
only matching names, descriptions, caller policies, and TypeScript signatures. A later turn can then:

- make the selected direct Tool definitions active through Pi's existing active-Tool mechanism; or
- make the selected signatures available to the next Code Mode program without exposing the entire Suite schema.

Keep `codemode.search()` and `codemode.describe()` inside V8 for Cloudflare compatibility and snippet workflows, but
do not teach them as the canonical way to discover a Tool during a running program. Both surfaces must read the same
catalog; there must not be two sources of Tool metadata.

### 5. Structured result boundary

A Tool is programmatic-eligible only when its result has a documented stable shape. Prefer an existing output schema;
otherwise add the smallest validator at the catalog boundary. Reuse Cloudflare's MCP unwrapping rules as a fallback
for MCP-shaped results:

1. explicit `toolResult`;
2. structured errors as thrown failures;
3. `structuredContent`;
4. all-text content joined and JSON-decoded when valid;
5. the raw result as a last compatibility value.

Unknown or artifact-rich results stay direct until their contract is known. Errors should name the Tool, argument or
result path, expected type, received type, and whether retry is safe.

### 6. Suspend and resume first; replay only for recovery

Normal execution should use the existing Codex V8 cell protocol:

1. execute one cell;
2. suspend it when JavaScript calls a Tool;
3. run that Tool through `registry.invoke()`;
4. return its result to the same cell;
5. continue until the program emits output, fails, or is cancelled.

Record a parent program identifier and child call identifiers so activity, hooks, and errors retain caller lineage.
This avoids re-running completed JavaScript merely to deliver a nested result.

Retain Cloudflare-style append-only history, replay, rollback, snippets, retention, and expiry in an Execution Ledger,
but change their role:

- approval resumes the suspended cell when the Host is alive;
- after Host loss, completed calls are supplied from the ledger;
- only replay-safe or idempotent unfinished calls may run automatically;
- an ambiguous side effect becomes `incomplete` and requires an explicit user decision;
- rollback is an explicit compensating operation, never a claim that an external side effect was magically undone.

Use Pi Session custom entries for this ledger before introducing another persistence system. Add derived local storage
only if Session entries prove insufficient and a separate accepted ADR defines its lifecycle.

### 7. Retry, approval, and hooks

- Retry only typed transient failures, with a small fixed limit and backoff.
- Retry only calls declared replay-safe or protected by an idempotency key.
- Do not automatically retry an approval denial, validation failure, unknown result shape, or ambiguous write.
- Use the stable child call identifier as an idempotency key when the target Tool supports one.
- A pre-call hook may block or rewrite arguments before the Tool runs.
- A post-call hook may reject what the program sees, but the ledger must record that the Tool already ran.
- Cancellation must reach both the V8 cell and the active nested Tool.

### 8. Output and diagnostics

- Preserve text, image, audio, and generated-image content through the existing response adapter.
- Truncate by tokens with a clear marker, not by a large character constant.
- Report syntax failures with line and column.
- Report unknown Tool names with nearest catalog matches and a `tool_search` hint.
- Report invalid arguments and results with JSON paths.
- Report missing output separately from a valid empty output.
- Keep one canonical prompt example; put edge cases in `describe` output and tests rather than the permanent schema.

## Reuse map

The new design reuses more of what Pi Stuff already has and narrows the new code:

| Need | Reuse | Pi-specific work |
| --- | --- | --- |
| V8 execution, yielded calls, wait, cancellation | Existing pinned official Codex V8 Host and current runtime | Align the model contract and caller lineage; do not create a second executor. |
| Tool execution | Existing Suite catalog and `registry.invoke()` | Add caller policy and stable result metadata. |
| Source tolerance | Cloudflare 0.5.1 pure normalizer, vendored only if no host-neutral export exists | Adapt returned values to `text(...)` without double emission. |
| Search and type descriptions | Existing catalog plus Cloudflare connector algorithms | Add one shared top-level search result and retain the in-V8 compatibility facade. |
| MCP result handling | Cloudflare pure unwrapping behavior | Preserve Pi media and Tool-result types. |
| Persistence | Existing Pi Session custom entries | Add program/child lineage and replay-safety fields. |
| History, replay, rollback, snippets | Cloudflare durable-runtime behavior and tests as the compatibility reference | Resume live cells first and gate recovery replay by safety metadata. |

Do not add generic `PiV8Executor`, `PiSuiteConnector`, or `PiSessionStore` frameworks merely to resemble Cloudflare's
class layout. Those seams already exist in Pi Stuff. Extract an Interface only if two real implementations need it.

## Scheme A versus Scheme B

| Question | Scheme A: Cloudflare parity | Scheme B: OpenAI-native hybrid |
| --- | --- | --- |
| Primary reference | Cloudflare Code Mode 0.5.1 | OpenAI Programmatic Tool Calling and Codex; Cloudflare for compatibility and durability |
| Canonical source | Async arrow function plus `return` | Top-level JavaScript, `tools.*`, and `text(...)`/`image(...)` |
| Accepted source | Primarily Cloudflare forms | OpenAI form plus normalized Cloudflare and existing Pi forms |
| Outer Tool transport | `{ code: string }` | Free-form when Pi supports it; otherwise `{ code }` is transport only |
| Tool exposure | All active Suite Tools are programmatic | Explicit `direct`, `programmatic`, or `both` routing |
| Discovery | `search`/`describe` inside the sandbox | Deferred top-level `tool_search`; in-sandbox search remains compatible |
| Result contract | Connector unwrapping and formatting | Structured output contract required for programmatic eligibility, with Cloudflare unwrapping fallback |
| Writes and approvals | Run inside Code Mode and use durable pause/replay | Direct by default; explicit safe writes may be programmatic; live cells resume after approval |
| Normal continuation | Durable log and deterministic replay | Resume the same V8 cell |
| Crash recovery | Replay recorded execution | Replay only safe calls; ambiguous effects stop as incomplete |
| Retry | Primarily governed by durable replay policy | Typed transient failures plus replay-safe/idempotent declaration and a bound |
| Trace identity | Execution and sequence identifiers | Parent program and child caller lineage, also stored in the ledger |
| Output | Returned program value | OpenAI media-aware output helpers; returned value auto-emitted for compatibility |
| Main reuse | Vendored Cloudflare core plus three Pi adapters | Existing Codex V8 Host, registry, and Session seams plus selected Cloudflare pure utilities |
| Token strategy | Hide the entire Suite behind one Tool | Start with two tiny Tools and load only relevant direct schemas/signatures |
| Main correctness risk | Learned dialect mismatch and duplicate effects during replay | More catalog metadata, but fewer dialect mistakes and safer interruption semantics |

Scheme B may expose a little more schema than Scheme A because it keeps a tiny search Tool and can load selected direct
Tools. That is intentional. It preserves most of the measured schema savings while avoiding the false assumption that
every operation is safer or easier when forced through JavaScript.

## Implementation plan

### Phase 1: contract alignment

- Revise ADR 0005 to define caller routing and the two reference roles.
- Make `tools.*`, top-level `await`, and `text(...)`/`image(...)` canonical.
- Keep `suite.*` and Cloudflare async-arrow programs as compatibility inputs.
- Port only the useful worktree changes: one complete example, actionable result errors, and regression tests.
- Remove `resultText()` and `emitText()` from model-facing guidance.

Acceptance: the same exact-completion tasks succeed with canonical OpenAI syntax and normalized Cloudflare syntax,
with no duplicate output.

### Phase 2: routing and discovery

- Add caller policy and structured-result eligibility to the existing catalog.
- Add the top-level deferred search Tool backed by that catalog.
- Activate only selected direct definitions; pass only selected programmatic signatures to Code Mode.
- Keep all nested execution through `registry.invoke()`.

Acceptance: unclassified and high-impact Tools remain direct; programmatic calls cannot bypass validation, hooks, or
permissions; the first request still has a materially smaller schema than direct mode.

### Phase 3: live continuation and lineage

- Preserve program and child caller identifiers through V8, registry calls, Tool display, and results.
- Resume the same yielded cell after nested calls and approvals.
- Define cancellation and post-call-hook behavior at the side-effect boundary.

Acceptance: a paused call resumes without re-executing completed JavaScript, and every child call is attributable to
one program in traces and UI state.

### Phase 4: Cloudflare durable parity

- Add the append-only Execution Ledger in Pi Session entries.
- Add replay-safe recovery, history, snippets, retention, expiry, and explicit rollback/compensation.
- Port Cloudflare-compatible normalization, search descriptions, result unwrapping, sanitation, binary handling, and
  focused upstream fixtures.

Acceptance: recovery never duplicates an ambiguous side effect; completed results replay deterministically; snippets
and history survive Session resume; compatibility fixtures match the pinned Cloudflare version.

### Phase 5: evaluation and rollout

Run the same representative corpus in three arms:

1. direct Tools;
2. Scheme A behavior, with all Suite Tools forced through Code Mode;
3. Scheme B routing and compatibility behavior.

Score exact task completion, evidence preservation, first-pass program success, missing or duplicate output, argument
and result errors, provider tokens, cache tokens, latency, Tool calls, model turns, retries, approvals, cancellation,
and duplicate effects. Correctness and evidence are release gates; token savings are a secondary optimization.

Keep Code Mode opt-in until Scheme B meets the direct baseline on the agreed representative corpus. This is not a
scope reduction: all Cloudflare durability features remain in the plan, but the rollout gate prevents an experimental
model contract from silently becoming the default.

## Recommendation

Replace Scheme A with Scheme B. Scheme A was right to demand Cloudflare parity and source reuse, but it chose the wrong
canonical dialect and made durable replay carry work that Pi Stuff's existing Codex V8 continuation protocol already
does better. Scheme B reproduces the useful capabilities from both industry references while reusing the Host,
registry, and Session mechanisms already present in Pi Stuff.

The current `code-mode-result-helpers` worktree should remain an experiment until ADR 0005 is revised. Keep its tests
and its emphasis on complete examples and actionable validation, but do not merge its helper names as the final public
contract.

## Follow-up: replacing Codex V8 with a local Workers runtime

### Finding

This is technically possible, but it is not a direct binary substitution.

Cloudflare officially supports running Worker code locally through Miniflare, which uses the same open-source
`workerd` runtime as the hosted platform
([Workers local development](https://developers.cloudflare.com/workers/local-development/)). Cloudflare's official
Dynamic Workers playground also documents running locally while using `env.LOADER` to create Dynamic Workers
([Dynamic Workers playground](https://developers.cloudflare.com/dynamic-workers/examples/dynamic-workers-playground/)).
Together, these sources establish a supported local development path for the relevant Workers execution model.

The replacement architecture would be:

```text
Pi
  -> local Miniflare/workerd supervisor Worker
  -> Worker Loader binding
  -> isolated Dynamic Worker for generated code
  -> RPC/HTTP bridge back to Pi registry.invoke()
```

It would not be:

```text
Pi -> import @cloudflare/codemode -> run
```

`DynamicWorkerExecutor` requires a Worker Loader binding, while the durable Code Mode runtime also requires a Durable
Object facet exported through `ctx.exports`
([Cloudflare durable Code Mode runtime](https://developers.cloudflare.com/agents/tools/codemode/durable-runtime/)).
Those facilities are supplied by the Workers environment, so Pi would need to start and supervise that environment as
a separate local process and bridge its calls back into Pi.

### What the replacement would gain

- The model-generated code would run under Cloudflare's own Worker semantics.
- `DynamicWorkerExecutor`, network isolation, console capture, timeout behavior, and Worker RPC could be reused with
  less translation.
- The Cloudflare durable runtime could use local Durable Objects rather than reimplementing its storage model on Pi
  Session entries.
- Cloudflare compatibility tests would exercise a runtime closer to the hosted reference.

Local Durable Object persistence is not automatic: Miniflare stores it in memory by default, and disk persistence must
be configured explicitly
([Miniflare Durable Object storage](https://developers.cloudflare.com/workers/testing/miniflare/storage/durable-objects/)).

### What the replacement would cost

- Replace the current small stdio protocol with a local Worker service and an RPC or HTTP bridge.
- Reimplement the current Codex cell operations—execute, yielded wait, terminate, cancellation, nested Tool callbacks,
  notifications, media output, and trace attachment—or deliberately map them to Cloudflare execution semantics.
- Add and certify the Wrangler/Miniflare/workerd/Vite dependency chain and its local-state lifecycle.
- Decide where local Durable Object files live, how they are cleaned up, and how they relate to a Pi Session.
- Preserve Pi validation, permissions, hooks, UI, and cancellation across a process and RPC boundary.
- Recheck supported platforms and binary requirements against Pi Stuff's certified profile.

There is also a security qualification. The `workerd` project says the runtime alone does not provide sufficient
defense in depth for potentially malicious code and recommends an outer secure sandbox such as a virtual machine
([workerd security note](https://github.com/cloudflare/workerd#readme)). A local workerd process is therefore not, by
itself, a stronger security boundary than the current dedicated Codex host process.

### Important reuse consequence

Cloudflare made the Code Mode `Executor` Interface runtime-agnostic. Its minimal contract can be implemented for any
sandbox, and `DynamicWorkerExecutor` is only the supplied Workers implementation
([Cloudflare Code Mode modular rewrite](https://developers.cloudflare.com/changelog/post/2026-02-20-codemode-sdk-rewrite/)).

That leaves two valid implementation paths:

| Path | Executor | Consequence |
| --- | --- | --- |
| Reuse Cloudflare core on the current runtime | A thin Codex V8 implementation of Cloudflare's `Executor` Interface | Keeps Pi's current host protocol and requires less replacement work. |
| Replace the runtime | Cloudflare `DynamicWorkerExecutor` inside local Miniflare/workerd | Matches Cloudflare execution semantics more closely but adds a Worker supervisor, RPC bridge, persistence lifecycle, and security hardening. |

The first path is source reuse. The second is runtime replacement. Both can provide Cloudflare feature parity; they
should be compared with a small local prototype before changing ADR 0005. The prototype must prove Worker Loader
startup without credentials, nested Pi Tool RPC, cancellation, media results, local Durable Object persistence,
restart recovery, and no direct network access from generated code.

## Primary sources

- [OpenAI Programmatic Tool Calling](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling)
- [OpenAI model guidance for Programmatic Tool Calling](https://developers.openai.com/api/docs/guides/latest-model)
- [OpenAI Tool Search](https://developers.openai.com/api/docs/guides/tools-tool-search)
- [OpenAI Tools overview](https://developers.openai.com/api/docs/guides/tools)
- [OpenAI Agents SDK Tool documentation](https://openai.github.io/openai-agents-python/tools/)
- [OpenAI Codex Code Mode execute specification](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/code_mode/execute_spec.rs)
- [OpenAI Codex Code Mode runtime](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/code_mode/mod.rs)
- [OpenAI Codex Code Mode response adapter](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/code_mode/response_adapter.rs)
- [OpenAI Codex feature registry](https://github.com/openai/codex/blob/main/codex-rs/features/src/lib.rs)
- [Cloudflare Code Mode overview](https://developers.cloudflare.com/agents/tools/codemode/)
- [Cloudflare Code Mode internals](https://developers.cloudflare.com/agents/tools/codemode/how-it-works/)
- [Cloudflare durable runtime](https://developers.cloudflare.com/agents/tools/codemode/durable-runtime/)
- [Cloudflare Code Mode API reference](https://developers.cloudflare.com/agents/tools/codemode/api-reference/)
- [Cloudflare Code Mode package source](https://github.com/cloudflare/agents/tree/main/packages/codemode)
