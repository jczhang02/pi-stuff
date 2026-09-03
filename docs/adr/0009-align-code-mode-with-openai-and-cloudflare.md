---
status: accepted
---

# Align Code Mode with OpenAI and Cloudflare

## Context

ADR 0005 proved that one local execution envelope can preserve Pi Tool behavior and UI while removing repeated Tool
schemas from provider requests. A later routed prototype kept most Tools top-level and added Code Mode beside them. Its
certified benchmark was worse than direct mode: 23 provider Tools and 9,907 estimated first-request tokens versus 22
Tools and 9,573 tokens direct. That prototype did not deliver Code Mode's main benefit.

This decision adopts the full envelope. Pi remains the Host, Code Mode remains one Capability Module in the Pi Stuff
Package, and OpenAI's Codex V8 Code Execution Runtime remains the sandbox. Cloudflare Code Mode is the capability and
API reference, not a reason to add workerd or a second Host.

## Decision

### Provider surface

When Code Mode is on:

- every active Pi Stuff Package-owned Tool moves behind `codemode` and is callable through `tools.*`;
- the provider sees only `codemode` and the small `tool_search` companion from the Package;
- a separately installed Tool that Pi Stuff does not own remains top-level because the Package cannot safely
  redispatch its private implementation; and
- a Tool registered or activated later is hidden automatically without a per-Tool routing declaration.

When Code Mode is off, Pi receives the exact original Tool list and order. Code Mode changes visibility only. It does
not grant a Tool new authority, bypass its validation, or decide whether its effect is safe to repeat.

Tool virtualization must not weaken Host-owned Skill Discovery. When `read` remains active in Code Mode's virtual
Tool set and the Host supplies Skill Discovery inputs for an Agent start, the Provider prompt receives the same
Host-loaded, model-invocable Skill names, descriptions, and locations as direct mode. Later provider-only
continuations may reuse that Host snapshot. A provider-only automatic first turn with no Host snapshot fails open
rather than rediscovering Skills or depending on Host internals. Code Mode adapts the catalog through Context
Management and Pi's public formatter; it does not expose top-level `read` or change `--no-skills`, resource enablement,
`disable-model-invocation`, explicit `/skill`, or custom-prompt behavior.

### Configuration and dialog

Code Mode uses one boolean value with this precedence, from highest to lowest:

1. `PI_STUFF_CODE_MODE_FROZEN`, captured for a child Agent at launch;
2. the trusted project's `.pi/code-mode.json` `enabled` override;
3. the global `codeMode.enabled` Settings Namespace in `<agentDir>/pi-stuff.json`;
4. `PI_STUFF_CODE_MODE_DEFAULT`; and
5. the built-in default, `false`.

`/codemode on|off` writes the project override. `/codemode global on|off` writes the global default. The `/codemode`
Command Dialog shows the effective value and its source, offers project `inherit|off|on` and global `off|on`, and uses
Pi's native `SettingsList` plus the shared Command Dialog restoration contract. Project inheritance removes only the
owned `enabled` field and preserves other project settings.

Untrusted projects cannot supply or change a project override. A frozen child shows the frozen source and cannot
change project or global settings. Persistence completes before runtime projection changes; a failed write leaves the
last durable state visible. Session startup and project changes only read configuration.

There is no `direct`/`programmatic`/`both` caller policy. That policy made every new Tool easy to misclassify and kept
the expensive schemas visible. Replay, approval, compensation, and lifecycle are independent effect contracts.
Unclassified Package Tools are still available through Code Mode and default to the conservative replay policy
`never`.

### Program and discovery contract

OpenAI's Programmatic Tool Calling form is canonical:

- plain JavaScript with top-level `await`;
- nested calls through `tools.*`;
- explicit output through `text(...)`, `image(...)`, and the other supported output helpers; and
- no direct Node.js, Bun, filesystem, process, module, network, or credential access.

Ordinary Tool work is awaited normally. A concrete observable command, file, log, or HTTP condition with a deadline
uses the existing one-shot Monitor and wakes the Agent once; Bash sleeps, status loops, and repeated conversational
polling are not the waiting contract.

Pi 0.84.2 transports source as `codemode({ code })` because its public Tool API does not expose a free-form source
Tool. This wrapper does not create a second JavaScript dialect.

Cloudflare's `async () => { return value; }` form and the older `suite.*` namespace remain compatibility inputs. A
returned value is emitted only if the program did not call an output helper, so output is never duplicated.
`tool_search`, `codemode.search`, and `codemode.describe` read the same active local catalog and deterministic ranking.
Discovery requires one lexical query-token match and never substitutes an unrelated Tool. The top-level response is
bounded to 4,000 characters. It first returns complete definitions; when those do not fit, it keeps the top Tool
description once, removes generated JSDoc from that Tool's structural TypeScript type, and uses compact signatures for
other matches. If the top description and compact type still do not fit, the response requires
`codemode.describe(path)` and exposes no untyped callable signature. If no complete result path fits, it asks the model
to refine the search. This preserves the invocation contract instead of leaving optional-looking fields without their
required combinations. `codemode.describe` retains the full generated TypeScript input and result types. Full nested
schemas stay inside V8 and never enter provider history.

Pi Stuff reuses the runtime-neutral parts of `@cloudflare/codemode` 0.5.1: source normalization, Connector search and
describe, name sanitation, JSON-schema-to-TypeScript conversion, snippets, binary and bigint codecs, stable replay
serialization, and focused upstream tests. The exact vendored source, commit, package integrity, licence, and local
delta are recorded in the Code Mode upstream notice. Workers-only execution and Durable Object storage are not
imported.

### Invocation and Host boundary

Every nested call goes through the Suite Tool registry's single `invoke()` seam. It therefore preserves Pi argument
preparation and validation, `tool_call` and `tool_result` hooks, permission prompts, lifecycle events, streaming
updates, cancellation, Tool Activity, media, usage, dynamically activated Tool names, and termination hints. Code
Mode never calls a captured Tool callback directly. A returned result with explicit `isError: true` rejects the nested
JavaScript call; uncaught rejection stops that execution, while ordinary `try/catch` may recover deliberately.

The existing Codex V8 Runtime remains the default Executor. Local workerd/Miniflare is unnecessary because the
missing behavior was the Connector, ledger, and approval contract, not JavaScript syntax. Replacing V8 with a Workers
runtime would require a separate decision and evidence that the extra process, RPC bridge, persistence, and platform
certification improve required behavior.

V8 yield and continuation remain an internal Host protocol. Yielded cells are resumed by the Runtime, but
`yield_control` is not model-facing helper vocabulary and does not represent user-level completion.

### Durable effects, approval, and recovery

Each execution and nested call has a stable ID in an append-only Pi Session ledger. The effect contract is explicit:

- `never` is the default. A settled recorded result can be supplied during recovery, but an ambiguous unfinished
  effect is not repeated automatically and the execution becomes `incomplete`.
- `record` stores and reuses a settled result. If Host loss leaves the call unsettled, the execution becomes
  `incomplete` rather than guessing whether it ran.
- `reexecute` deliberately runs again during replay and must be explicitly declared only for safely repeatable or
  idempotency-protected operations.
- `requiresApproval` pauses before the Tool effect. It cannot be combined with `reexecute`.

During historical replay, a valid persisted nested result with explicit `isError: true` is classified as an error in
memory even if an older envelope recorded success. Its old value remains diagnostic evidence; Session JSONL is not
rewritten, and prose, absent flags, or malformed result data never trigger inference.

Approval is durable rather than an in-memory prompt. The first encounter appends a pending action and returns a
paused result without invoking the Tool. `/codemode pending` shows the execution ID, sequence, Tool, and arguments.
`/codemode approve <execution-id>` replays prior settled calls, converts the exact pending action into a running call,
and executes it once. `/codemode reject <execution-id> <seq>` terminates that pending action without executing it.
Stale approval or rejection commands are harmless.

Resume is allowed only in the same Pi Session, from the recorded working directory, while the pending Tool is still
active. A directory change or missing Tool leaves the execution paused. A program cannot swallow the approval signal
and continue into later effects: every later call in that pass also returns the pause and is not added to the ledger.

One typed V8 Host-loss retry is allowed. Completed calls are replayed from the ledger; an ambiguous non-replayable
effect becomes `incomplete` and requires `/codemode abandon`. `/codemode rollback <execution-id>` runs only explicitly
declared compensating operations, in reverse order. It never pretends an external effect was erased. Stale unfinished
and paused work expires, terminal history is bounded, and large or unserializable values fail instead of being stored
approximately.

Connector lifecycle hooks run at the end of every pass, including a failed Host pass and a paused approval pass. A
terminal execution is disposed once with `completed`, `error`, `rejected`, or `rolled_back`. Cleanup failures are
best-effort and cannot replace the actual Tool result.

### Agents and RTK

Every foreground, background, parallel, nested, and resumed Agent launch freezes the parent Session's effective Code
Mode state. A child receives an explicit `on` or `off` value without mutating global `process.env`; a later parent
toggle does not change an already running child. This frozen launch value takes precedence over the child working
directory's persisted project preference. The child's existing Tool allowlist and authority ceiling still bound its
local catalog.

RTK remains useful. Code Mode removes provider-visible Tool schemas and intermediate orchestration; RTK reduces noisy
Bash and search output. A nested Bash call still traverses `registry.invoke()` and Pi's normal `tool_call` hook, so RTK
can rewrite it exactly as it does for a direct Bash call.

### Certified result and release gate

The certified Pi 0.84.2 group fixture contains Read, Bash, Background Work, and Agent management. The same program is
run directly and through the full envelope, before and after Session resume, at 100 and 64 columns. Tool Activity and
the full ANSI screen are identical after normalizing only the truthful context-usage number.

Current measurements are:

| Surface | Provider Tools | Serialized Tool schema | Estimated first request | Estimated post-Tool request | Two-request total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Direct | 22 | 31,208 chars | 9,573 tokens | 9,788 tokens | 19,361 tokens |
| Old one-Tool envelope | 1 | 1,431 chars | 1,184 tokens | — | — |
| Full envelope with search | 2 | 1,880 chars | 1,321 tokens | 1,503 tokens | 2,824 tokens |

The shipped full envelope uses 6.0% of the direct Tool-schema characters and 13.8% of direct first-request input. On
the representative two-request exchange it uses 14.6% of direct input. Acceptance enforces, rather than merely
reports, these properties:

- exactly the two Package-owned provider Tools `codemode` and `tool_search` are visible in the certified fixture;
- schema characters and estimated first-request input are each at most 20% of direct mode;
- representative cumulative estimated input is lower than direct mode;
- direct and Code Mode behavior, media, errors, cancellation, RTK hooks, Agent access, and TUI projection remain
  equivalent; and
- approval, Host loss, Session resume, changed working directory, missing Tools, rejection, expiry, and rollback never
  duplicate an effect.

Code Mode remains opt-in while compatibility evidence accumulates. Opt-in status is a rollout choice, not a reason to
keep Package-owned Tool schemas outside the envelope.

## Consequences

- When Code Mode is on, Package-owned Tool schemas leave the provider surface without changing Tool authority,
  validation, lifecycle, or visible results.
- The full envelope preserves Host-owned Skill Discovery from Host-supplied Skill snapshots whenever virtual Read
  remains active; only the invocation path changes to nested `tools.read`.
- The Suite maintains one active Tool catalog and one invocation seam for direct and nested calls.
- Project overrides remain isolated while one Pi-visible global default avoids repeating the same choice per project.
- Durable approval and recovery state prevents ambiguous effects from being repeated automatically.
- The V8 Runtime and compatibility inputs remain implementation details; Pi stays the only Host.

## Consolidation history

This ADR superseded the routed and one-Tool-envelope experiments recorded in ADR 0005 and now incorporates the global
default and dialog decisions formerly recorded in ADRs 0011 and 0014. Those files are removed because they only amend
this Code Mode contract.

## References

- [OpenAI Programmatic Tool Calling](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling)
- [OpenAI Tool Search](https://developers.openai.com/api/docs/guides/tools-tool-search)
- [OpenAI Codex Code Mode execute specification](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/code_mode/execute_spec.rs)
- [OpenAI Codex Code Mode runtime](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/code_mode/mod.rs)
- [Cloudflare Code Mode](https://developers.cloudflare.com/agents/tools/codemode/)
- [Cloudflare durable Code Mode runtime](https://developers.cloudflare.com/agents/tools/codemode/durable-runtime/)
- [Cloudflare Code Mode modular rewrite](https://developers.cloudflare.com/changelog/post/2026-02-20-codemode-sdk-rewrite/)
