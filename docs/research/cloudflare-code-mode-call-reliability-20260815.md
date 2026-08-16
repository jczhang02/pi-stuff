# Cloudflare Code Mode and model-call reliability

Date: 2026-08-15

## Question

Does Cloudflare publish evidence that models sometimes generate the wrong Code Mode program or call a Code Mode
method incorrectly?

## Finding

Yes. Cloudflare's public implementation and issue tracker document both classes of failure:

1. **Wrong program shape or syntax.** Models wrap code in Markdown fences, emit `export default`, write a named
   function instead of the requested arrow function, omit the final `return`, or emit TypeScript syntax even though
   the sandbox executes JavaScript.
2. **Wrong method arguments.** A production report showed models repeatedly passing the whole result object from
   `cdp.attachToTarget()` into `cdp.send()` where the method required the nested `sessionId` string.

Cloudflare has implemented defenses for both classes. It normalizes several harmless program-shape mistakes and
rejects malformed browser-tool arguments with actionable validation errors. This is direct evidence that model
miscalls are a real operational concern, not evidence that Code Mode is generally unreliable.

No first-party Cloudflare source found in this search publishes an overall Code Mode failure rate, a cross-model
reliability benchmark, or a measured self-repair rate. Cloudflare's claim that models are better at writing code than
calling tools directly is therefore a broad design claim, not proof that every generated Code Mode call is correct.

## What Cloudflare means by Code Mode

Cloudflare defines Code Mode as giving a model one code-execution Tool and exposing operations as typed methods. The
generated program becomes a compact plan that can call several methods, filter intermediate data, branch, and return
only the result the model needs. Current documentation marks the feature experimental
([Code Mode overview](https://developers.cloudflare.com/agents/tools/codemode/)).

Cloudflare now documents two main forms:

- A single client-side Code Mode Tool whose description includes the relevant typed methods.
- A server-side `search` plus `execute` pair for very large APIs. Cloudflare reports that this exposes more than 2,500
  API endpoints in roughly 1,000 tokens, versus 1.17 million tokens for native MCP schemas
  ([server-side Code Mode announcement](https://blog.cloudflare.com/code-mode-mcp/)).

In both forms, the model-facing `code` value is described as a **JavaScript async arrow function**. A normal Cloudflare
program looks like this:

```js
async () => {
  const value = await service.method({ key: "value" });
  return value;
}
```

## Direct evidence of model mistakes

### 1. Cloudflare normalizes common LLM output quirks

Merged pull request [cloudflare/agents#1092](https://github.com/cloudflare/agents/pull/1092) says it hardens
`normalizeCode()` against "common LLM output quirks." The merged implementation:

- strips Markdown code fences that its source comment says LLMs commonly add;
- unwraps `export default`;
- wraps and calls a named function;
- inserts a return for a trailing expression;
- accepts raw statements by wrapping them in an async arrow function.

The current implementation is visible in
[`normalize.ts`](https://github.com/cloudflare/agents/blob/main/packages/codemode/src/normalize.ts).

This is compatibility handling for harmless shape variations. It is not a general program repair engine. The PR tried
stripping TypeScript annotations, then removed that logic because regular-expression rewriting corrupted valid
JavaScript expressions. Cloudflare chose to let invalid TypeScript fail with a clear runtime error so the model could
correct it.

### 2. Cloudflare corrected its own prompt because it encouraged invalid code

Merged pull request [cloudflare/agents#1760](https://github.com/cloudflare/agents/pull/1760) changed the runtime Tool
description from TypeScript to JavaScript. The reason is explicit: the sandbox executes JavaScript, and telling models
to execute TypeScript could encourage annotations and other syntax the sandbox cannot run.

The current default description now gives one complete async-arrow example and explicitly says not to use TypeScript
syntax or named functions
([`shared.ts`](https://github.com/cloudflare/agents/blob/main/packages/codemode/src/shared.ts)). This is strong design
evidence for keeping the executable language, entry shape, and one canonical example directly in the model-facing Tool
contract.

### 3. A semantic miscall was observed repeatedly in production

[cloudflare/agents#2031](https://github.com/cloudflare/agents/issues/2031) reports an exact Code Mode error seen in
production traffic. Models did this:

```js
const session = await cdp.attachToTarget({ targetId });
await cdp.send({ method: "Page.navigate", sessionId: session });
```

The first method returns `{ sessionId: string }`, but the second method requires the string itself. Passing the whole
object reached `.startsWith()` and crashed the execution with an opaque `TypeError`. The reporter said a Tool-description
hint telling the model to destructure helped, but remained only a prompt-level mitigation.

Cloudflare merged [cloudflare/agents#2035](https://github.com/cloudflare/agents/pull/2035) the next day. The fix validates
browser Tool inputs at runtime and returns path-specific errors so the model can correct the call. The maintainers
deliberately rejected silently coercing the common wrong shape because that would make the runtime contract broader
than the advertised schema.

This is the clearest available evidence for the relevant policy: use a clear example to prevent common mistakes, but
also validate at the execution boundary and return an actionable error. Do not rely on prompting alone.

### 4. Broader validation is being explored, but is not current evidence of a released guarantee

Draft pull request [cloudflare/agents#1750](https://github.com/cloudflare/agents/pull/1750) proposes optional validators
for the generated program and individual connector calls, with bounded diagnostics that models can use to correct
their code. It remained an open draft at the time of this report, so it indicates design direction rather than a
released capability.

## What this means for Pi Stuff

Pi Stuff uses Cloudflare Code Mode as an interface reference, but it does not implement the same executable contract.
Cloudflare asks for an async arrow function and automatically returns its value. Pi Stuff's current OpenAI V8 Host runs
top-level statements, rejects top-level `return`, and requires an explicit output helper. Treating these as the same
protocol would invite exactly the kind of learned-contract confusion seen in Cloudflare's own fixes.

The current `code-mode-result-helpers` worktree is aligned with the useful part of Cloudflare's response:

- it gives one complete model-facing example instead of listing only method signatures;
- `codemode.resultText(result)` names and validates the actual Pi Tool-result shape;
- `codemode.emitText(value)` provides one explicit, non-shadowable output path;
- both helpers fail early with specific errors instead of silently guessing.

Those changes directly address the result-shape confusion observed in Pi Stuff's live experiment
([local token-consumption report](./code-mode-token-consumption-20260815.md)). Cloudflare's sources corroborate the
general failure mode and the defense pattern, but they do not prove that these exact Pi Stuff helpers eliminate the
problem.

## Recommendation

Keep the current small helper-and-example change and measure it with the same live exact-completion corpus. Record
failures by category: wrong program shape, wrong method or arguments, wrong Tool-result handling, missing final output,
and unrelated Tool/runtime errors.

Do not add a broad AST repair layer yet. Pi Stuff has direct evidence for result-shape and output confusion, while the
new helpers address those failures at a much smaller seam. If repeated trials later show models emitting Cloudflare's
async-arrow/`return` convention into Pi Stuff, add only the narrow compatibility handling justified by those traces.
Continue rejecting semantic argument errors with actionable validation rather than silently coercing them.
