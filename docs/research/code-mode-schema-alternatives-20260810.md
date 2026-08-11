# Code Mode and tool-schema context alternatives

Date: 2026-08-10

## Question

Can Pi Stuff materially reduce model context without copying the local Code Mode design described in
the `pi-codex-conversion` article? In particular, how much can static Tool-schema trimming achieve, and
which progressive-discovery or programmatic-calling designs fit Pi Stuff's Host and UI contracts?

## Executive finding

Static schema cleanup helps, but it is not the primary solution. The current main Suite exposes about
7,212 schema tokens across 25 active Tools in a real Pi 0.84.1 turn. A simulated careful rewrite of all
descriptions reaches about 4,563 tokens, while removing every Tool and property description still leaves
about 3,021 tokens. Reaching less than 2,500 tokens with all 25 typed schemas present also requires
removing validation constraints. That would weaken Tool selection, argument generation, and provider-side
validation.

Two designs remain credible:

1. A **temporary typed Tool palette** built on Pi's existing dynamic Tool loading. Keep a small core
   active, load a complete typed Capability palette when needed, and unload it at a deterministic
   boundary. This retains existing Tool validation, renderers, Tool Activity, and Session replay. An
   installed-Pi 0.84.1 source and runtime check confirms that a non-additive unload removes the old
   definition from subsequent provider requests; it is not permanently retained by an earlier
   `addedToolNames` marker.
2. A **fixed local search-and-execute Code Mode**. Keep full schemas in a trusted runtime-side catalog,
   let the model search or describe only the operations it needs, and let one sandboxed program compose
   calls while returning a bounded result. This gives the most stable model prefix and can also keep
   intermediate Tool results out of model history, but Pi Stuff would need to preserve its per-Tool UI,
   validation, cancellation, media, state transitions, and deterministic Session replay through an
   explicit bridge.

The recommended next step is an A/B prototype, not immediate adoption of either design. Static schema
hygiene should accompany both but should not be treated as the context architecture.

## Local measurement

### Method

- Source snapshot: main at `fd1c449`.
- Runtime probe: installed Pi 0.84.1, after `before_agent_start` so Magic Context contributes its real
  schemas rather than registration placeholders.
- Provider shape: the compact OpenAI Responses function representation
  `{ type, name, description, parameters, strict: false }`.
- Tokenizer: `o200k_base`.
- These are reproducible structural estimates, not a claim about a provider's private billing
  tokenizer.

### Results

| Surface | Estimated schema tokens | Change from 7,212 | Main trade-off |
| --- | ---: | ---: | --- |
| Current main, 25 active Tools | 7,212 | baseline | Full current behavior |
| Remove all nested parameter descriptions | 5,380 | -25% | Loses useful argument guidance |
| Simulated concise descriptions throughout | 4,563 | -37% | Still well above 2,500 |
| Remove every Tool and property description | 3,021 | -58% | Serious selection and argument-quality risk |
| Also remove validation constraints | 2,380 | -67% | Reject: weakens validation to reach the target |
| Nine fully typed dispatchers | 7,482 | +4% | Grouping alone duplicates or preserves the same information |
| Nine `operation + args:any` dispatchers | 668 | -91% | This is a generic gateway, not typed schema optimization |
| Bash only | 187 | -97% | Loses native Todo, Goal, Agent, MCP, media, and Tool UI semantics |

The Suite system prompt is a separate source of pressure. In the same isolated no-context/no-Skills
probe, bare Pi was about 532 tokens and the Suite was about 2,932 tokens, a roughly 2,400-token increase.
Tool snippets, guidelines, and Magic Context instructions therefore require a separate audit even after
the Tool schemas are controlled.

### Temporary typed palettes

The tighter measured palette policy was:

| Active palette | Estimated schema tokens |
| --- | ---: |
| `read`, `bash`, `edit`, `write`, `apply_patch`, and loader | 800 |
| Core plus `ctx_reduce` | 1,169 |
| Core plus `subagent` | 2,105 |
| Core plus `ctx_reduce` and `subagent` | 2,474 |
| Todo palette | 1,303 |
| Web palette | 1,422 |
| Work palette | 1,232 |
| Goal palette | 1,361 |
| Core plus the largest single Context action | at most 1,534 |

Additive-only loading without unloading is insufficient: the tested cold surface was 1,303, a common
Work-plus-Subagent surface was 3,040, and eventually loading every palette reached 7,265. By contrast,
unloading a temporary palette returned the next request to 800 or 1,169 tokens.

Pi documents both behaviors. Purely additive activation uses native deferred references on supported
models, while removal or replacement uses a provider-compatible fallback. The fallback means Tool
removal works, but changing the active Tool array can invalidate the cached prefix. See Pi's
[Dynamic Tool Loading documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#dynamic-tool-loading).

## Alternatives found in primary sources

### 1. Native deferred Tool Search

OpenAI and Anthropic both support keeping definitions out of the model-visible initial context and
loading selected schemas later. OpenAI recommends namespace-level discovery because an individually
deferred function still exposes its name and description; Pi 0.84.1 can translate additive activation
to OpenAI Tool Search for GPT-5.4-and-newer families and to Anthropic Tool Reference blocks on supported
Claude families. See [OpenAI Tool Search](https://developers.openai.com/api/docs/guides/tools-tool-search)
and [Anthropic Tool Search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool).

This is the least invasive option because discovered functions remain real Pi Tools. It reduces upfront
definitions but does not reduce the output of the Tool calls themselves. A temporary-palette policy adds
the missing bound by unloading a Capability after use. Its costs are an extra discovery step when a
Capability is cold, cache-prefix changes on unload, and recovery logic if a model attempts to call a Tool
that is no longer active.

### 2. Provider-native programmatic Tool calling

OpenAI's Programmatic Tool Calling lets GPT-5.6 write JavaScript in an isolated V8 runtime. Nested
function, MCP, shell, and patch calls remain explicit response items with caller links, while the program
can filter intermediate data before returning it to the model. Anthropic offers a similar hosted Python
flow, but its current programmatic surface cannot call MCP connector Tools. See
[OpenAI Programmatic Tool Calling](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling)
and [Anthropic Programmatic Tool Calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling).

Installed Pi 0.84.1 supports native Tool Search but does not yet expose a provider-neutral Programmatic
Tool Calling seam. Implementing the OpenAI protocol now would therefore couple a core Suite behavior to
one provider and require model-conversation changes outside ordinary Tool registration. It is a useful
future fast path, not the current Suite-wide foundation.

### 3. Local single-code-tool mode

Cloudflare documents a `code` Tool whose description includes typed methods for every upstream Tool.
This reduces JSON wrapper repetition and model round trips, but it does not hide those method declarations.
The local experiment confirms the limitation: fully typed dispatchers were slightly larger than the
original schemas. This pattern is appropriate only when the catalog is small enough that all declarations
comfortably fit.

### 4. Local search-and-execute Code Mode

Cloudflare's large-API pattern keeps the full OpenAPI document inside the sandbox. A small `search`
surface returns only relevant operations and an `execute` surface composes authenticated calls. Its newer
durable runtime extends that idea with `search`, `describe`, replayed steps, pauses, and persisted execution
records. See [Cloudflare Code Mode MCP patterns](https://developers.cloudflare.com/agents/model-context-protocol/codemode/)
and [How Durable Code Mode works](https://developers.cloudflare.com/agents/tools/codemode/how-it-works/).

This is the strongest provider-neutral fixed-context design found. It is also the most expensive to
integrate correctly. A generic outer Tool would otherwise flatten Pi Stuff's nested Tool Activity,
interactive UI, media projection, Tool-specific state, cancellation, validation errors, and resumed
Session display. The trusted host must still enforce each inner call; generated code is not an authority
boundary.

### 5. Filesystem or CLI progressive disclosure

Anthropic's MCP engineering pattern also generates typed wrappers or Tool documentation into a filesystem
and lets the model discover them through file reads before executing code. See
[Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp). This can expose
almost nothing beyond Bash, but it would turn Suite operations into opaque shell activity unless Pi Stuff
created another CLI, runtime, and replay protocol. That conflicts with the accepted decision to keep Pi as
the Host and with the current UI contract, so it is not recommended for core Capabilities.

## What each technique actually reduces

The MCP client guidance and Anthropic's context-management guide separate four pressures that are often
mistaken for one problem:

| Technique | Reduces | Does not by itself reduce |
| --- | --- | --- |
| Schema cleanup | Size of every active Tool definition | Accumulated Tool results |
| Tool Search or temporary palettes | Definitions loaded upfront or currently active | Large results from invoked Tools |
| Programmatic calling or Code Mode | Intermediate results and inference round trips | Full declarations if they remain in the code Tool description |
| RTK, Context editing, or Magic Context | Old Tool results and history | An oversized current active Tool array |
| Prompt caching | Reprocessing cost and latency | Tokens occupying the context window |

See the official [MCP client best practices](https://modelcontextprotocol.io/docs/develop/clients/client-best-practices)
and [Anthropic guide to managing Tool context](https://platform.claude.com/docs/en/agents-and-tools/tool-use/manage-tool-context).

These techniques compose. Pi Stuff already uses a single lazy MCP gateway and an optional `mcp_script`,
so MCP should not be rewrapped without evidence that its existing boundary is a problem. RTK and Magic
Context remain complementary because they address result/history growth rather than the active-schema
surface.

## Recommendation and experiment gate

Do not make all Suite operations opaque behind Bash, do not replace 25 Tools with typed dispatchers, and
do not delete validation merely to hit a token target.

Prototype these candidates against the same fixture tasks:

1. **Temporary typed palette:** core plus loader, turn-scoped Capability activation, deterministic unload,
   and recovery for stale Tool attempts.
2. **Fixed search-and-execute Code Mode:** runtime-side full schema registry, sandboxed composition,
   bounded final output, and a nested-operation adapter for current Tool Activity and Session replay.

Compare cold and tenth-turn schema tokens, cache-read ratio, added model round trips, completion rate,
argument-validation failures, long-Session behavior after Magic Context reduction, cancellation, media,
reload/resume, and the real Pi TUI. Prefer the temporary typed palette if it stays below the context target
without a material cache or reliability regression. Adopt fixed Code Mode only if the stable-prefix and
intermediate-result gains justify its much larger Host/UI bridge.

