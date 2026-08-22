# `code-mode`

Code Mode is the Pi Stuff Package's model-facing Tool envelope. It moves every active Package-owned Tool schema behind
`codemode({ code })`, executes JavaScript in OpenAI's isolated V8 Code Mode host, and delegates `tools.*` calls back to
the original Pi Tool. Separately installed Tools remain top-level because the Package does not own their private
implementation.

It is disabled by default for a compatibility-first rollout. Use `/codemode` to open the Pi Stuff Command Dialog, or
`/codemode on` and `/codemode off` for direct control. The dialog shows the current mode, provider surface, active
local catalog size, and Session ledger counts. An explicit per-project toggle is stored in the trusted project's
`.pi/code-mode.json` and is reloaded after Pi restarts or changes projects. `/codemode global on` and
`/codemode global off` set a global default stored as the `codeMode.enabled` namespace in the merged Pi Stuff settings
file (`<agentDir>/pi-stuff.json`). Loading remains read-only, and an absent value falls back to
`PI_STUFF_CODE_MODE_DEFAULT` (`off` when unset). Effective precedence: frozen child launch value, then the project
file, then the global default, then the process default, then `off`.

Launching an Agent freezes the parent session's effective Code Mode state into that child run. The child receives an
explicit `on` or `off` value without mutating the parent process environment; a later parent toggle does not change an
already running Agent. That frozen child value takes precedence over the project's and global persisted preferences.
The child's existing Tool allowlist and capability ceiling still bound what its Code Mode catalog can invoke.

## What the model uses

```js
const pkg = JSON.parse(await tools.read({ path: "package.json" }));
text(pkg.packageManager);
```

- `tools` contains every currently active Pi Stuff Package-owned Tool, including Tools activated after Code Mode was
  enabled.
- Await every `tools.*` call. Stable structured content is returned directly; textual JSON is parsed; other text is
  returned as a string.
- `await codemode.search(query)` and `await codemode.describe(path)` inspect the local catalog without adding that catalog to
  model history.
- JavaScript has no direct Node, Bun, filesystem, process, network, module, or credential access. I/O is available
  only through Package-owned Tools.
- `text(...)`, `image(...)`, `generatedImage(...)`, `store(...)`, `load(...)`, `notify(...)`, and the other Host
  helpers remain available. `console` is unavailable. Images must come from a complete data URL or the structured
  result of an image-producing Tool; Base64 from text-producing Tools such as Bash can be truncated and is rejected.
- Cloudflare's `async () => { return value; }` form is accepted. A returned value is emitted only when the program did
  not already call an output helper, so explicit output is never duplicated. The older `suite.*` namespace remains a
  compatibility alias, not prompt vocabulary.
- The top-level `tool_search({ query })` Tool and `codemode.search/describe` read the same Cloudflare-ranked catalog and
  return the same paths and generated TypeScript input types.
- Yielded cells are waited internally. Continuation does not add another provider Tool schema.

There is no per-Tool caller-routing policy. Visibility and effect safety are separate: all Package-owned Tools enter
the V8 catalog, while each Tool may independently declare replay, durable approval, compensation, and lifecycle
behavior. The safe default is non-replayable. Bash remains non-replayable and still traverses RTK's normal `tool_call`
hook. Separately installed third-party Tools stay top-level because Pi Stuff cannot safely redispatch their private
callbacks.

## UI and session contract

Code Mode has no visible Tool row of its own. Each nested call uses the exact renderer, Activity Group metadata,
streaming state, failure state, expansion behavior, and media behavior of the original Tool. The outer result stores
the nested calls in normal Pi session JSONL details, so reload and resume rebuild the same projection. Final
settlement reprojects nested and direct calls in the model's source order, including standalone Bash rows. Nested
images are carried through the outer Host result so Pi performs its normal image
normalization once. Before TUI rendering, normalized nested media moves into persistent presentation details and is
removed from the outer image list, so Pi cannot append it below the whole envelope. The original renderer receives it
again at its exact text/media boundary; a public context hook restores the same normalized content for every provider
request. Session JSONL therefore stores each nested image payload once, reloads the same UI, and never trades visual
equivalence for model visibility. Invalid or incomplete image output becomes an error before it can be persisted. A
provider-context projection also replaces malformed images from older Code Mode results with an actionable text error
without rewriting Session history.

The real Pi 0.84.2 acceptance gate compares the full ANSI screen and exact Tool Activity block with Code Mode on and
off at 100×32 and 64×28, both before and after session resume. Only the truthful context-usage number is normalized:
Code Mode exists to change that value, while its icons, placement, colors, and surrounding layout must remain equal.
The gate exercises a mixed Activity containing Read, Bash, Background Work, and Agent management, plus a failed Tool
call, a cancellation-classified Tool result, and interleaved real PNG/text/PNG reads through Pi's media normalization
and terminal fallback path. The media gate also proves that both images reach the next provider request after the UI
projection. An additional test runs Pi 0.84.2's real `ToolExecutionComponent` with Kitty capabilities and proves that
expanded multi-image output stays interleaved with its original Tool rows. Outer execution cancellation is covered
separately so the gate does not inherit process-exit timing races from Pi's native Bash path. The gate enforces token
savings. The direct surface is 22 Tools / 31,208 schema characters / 9,573 estimated first-request tokens. The full
envelope is 2 Tools / 1,880 characters / 1,321 tokens: 6.0% of the direct schema and 13.8% of the direct first request.
After one representative Tool round-trip, the two-request total is 19,361 tokens direct versus 2,824 through Code
Mode. CI requires both schema and first-request input to stay at or below 20% of direct mode, and requires cumulative
input to remain lower.

Nested execution preserves Pi's argument preparation, validation, call/result hooks, lifecycle events, cancellation,
streaming updates, Tool usage, newly activated Tool names, and termination hints. A serialization failure becomes a
normal failed Tool result instead of leaving a V8 cell hung.

One Code Mode execution may issue at most 768 nested Tool calls. Crossing the safety bound fails explicitly; calls
are never silently dropped, and separate Code Mode calls can still contribute to the same unbounded Activity Group.

## Recovery and reusable programs

Each execution and nested call receives a stable ID in an append-only Pi Session ledger. Completed calls can be
reused after one typed V8 Host-loss retry. The default `never` policy refuses to repeat an ambiguous unfinished
effect; `record` reuses only a settled result, and `reexecute` deliberately runs an operation again. Any unfinished
`never` or `record` call becomes `incomplete` and is never guessed or repeated.

A Tool marked `requiresApproval` pauses durably before its effect. `/codemode pending` shows the exact action;
`/codemode approve <execution-id>` resumes it once, and `/codemode reject <execution-id> <seq>` terminates it without
execution. Approval cannot be combined with `reexecute`. Resume requires the original working directory and an active
pending Tool; stale decisions change nothing. A swallowed pause cannot reach later effects in the same program.

`/codemode history`, `/codemode abandon <execution-id>`, `/codemode expire`, and
`/codemode rollback <execution-id>` expose recovery decisions. The older `compensate` command remains an alias.
Rollback runs only explicitly declared inverse operations, in reverse order; it never erases history or assumes an
external effect disappeared. Connector cleanup runs after every pass and once at terminal completion, rejection, or
rollback without masking the original result.

`codemode.step(name, fn)` gives a long program a durable named checkpoint. `/codemode save <execution-id> <name>` saves
a successful program as a Session snippet; `codemode.run(name, input)`, `/codemode snippets`, and
`/codemode delete <name>` reuse or curate it. The ledger retains bounded terminal history and expires stale unfinished
work; it is Session data, not a second database.

## Native host

The V8 helper is prepared only on the first explicit Code Mode execution. Installation:

- downloads the exact OpenAI Codex `rust-v0.145.0` asset for the current platform;
- honors standard proxy environment variables;
- has a 120-second timeout and remains cancellable;
- bounds Host startup/handshake to ten seconds and follows outer Tool cancellation;
- verifies the pinned SHA-256 before installation;
- uses an inter-process lock and atomic staging; and
- caches the executable under Pi's agent cache directory.

Set `PI_STUFF_CODE_MODE_HOST` to an existing absolute executable path to use a preinstalled helper. Importing or
starting Pi does not download, write, or spawn anything for Code Mode.

## Compatibility

- Pi Host: `0.84.2`
- Bun: `1.3.14`
- Host assets: Linux/macOS x64 and arm64, Windows x64 and arm64
- Non-Windows archive installation requires `tar`

See [UPSTREAM.md](UPSTREAM.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for provenance.

This is an internal module of the single local `@jczhang02/pi-stuff` Package, not an independently installable Pi
resource. Its registry exists only while the Suite is assembling its owned Tools.
