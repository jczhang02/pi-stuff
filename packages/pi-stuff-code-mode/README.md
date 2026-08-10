# `@jczhang02/pi-stuff-code-mode`

Code Mode is the Pi Stuff Suite's model-facing Tool envelope. It replaces the active Suite Tool schemas with one
`codemode({ code })` schema, executes the JavaScript in OpenAI's isolated V8 Code Mode host, and delegates every
`suite.*` call back to the original Pi Tool.

It is disabled by default for a compatibility-first rollout. Use `/codemode on`, `/codemode off`, or
`/codemode status` to change or inspect the current runtime mode. The setting is deliberately session-runtime state
rather than a new settings file. Headless acceptance environments can start it enabled with
`PI_STUFF_CODE_MODE_DEFAULT=on`.

## What the model uses

```js
const matches = codemode.search("read file");
const contract = codemode.describe(matches.results[0].path);
const result = await suite.read({ path: "README.md", limit: 20 });
text(result.content[0].text);
```

- `suite` contains every currently active Tool registered by the Pi Stuff Aggregate, not a fixed allowlist.
- `codemode.search(query)` and `codemode.describe(path)` inspect the local catalog without adding that catalog to
  model history.
- JavaScript has no direct Node, Bun, filesystem, process, network, module, or credential access. I/O is available
  only through Suite Tools.
- `text(...)`, `image(...)`, `generatedImage(...)`, `store(...)`, `load(...)`, `notify(...)`, and the other host
  helpers control explicit output. `console` is unavailable and a top-level `return` is invalid; finish with an
  explicit output helper such as `text(value)`.
- Yielded cells are waited internally. The provider sees one `codemode` Tool, not a second continuation schema.

The envelope covers active Aggregate-owned Tools. A separately installed third-party Tool that did not register
through the Aggregate remains a normal top-level Pi Tool; Code Mode does not reach into another extension's private
`execute` callback. For the same reason, lifecycle handlers registered by unrelated Extensions continue to observe
the outer `codemode` call rather than pretending Pi exposes a supported nested-dispatch API. Pi Stuff's own Tool
handlers are replayed through the Aggregate registration boundary.

## UI and session contract

Code Mode has no visible Tool row of its own. Each nested call uses the exact renderer, Activity Group metadata,
streaming state, failure state, expansion behavior, and media behavior of the original Tool. The outer result stores
the nested calls in normal Pi session JSONL details, so reload and resume rebuild the same projection without a
separate database. Nested images are carried through the outer Host result so Pi performs its normal image
normalization once. Before TUI rendering, normalized nested media moves into persistent presentation details and is
removed from the outer image list, so Pi cannot append it below the whole envelope. The original renderer receives it
again at its exact text/media boundary; a public context hook restores the same normalized content for every provider
request. Session JSONL therefore stores each nested image payload once, reloads the same UI, and never trades visual
equivalence for model visibility.

The real Pi 0.84.1 acceptance gate compares the full ANSI screen and exact Tool Activity block with Code Mode on and
off at 100×32 and 64×28, both before and after session resume. Only the truthful context-usage number is normalized:
Code Mode exists to change that value, while its icons, placement, colors, and surrounding layout must remain equal.
The gate exercises a mixed Activity containing Read, Bash, Background Work, and Agent management, plus a failed Tool
call, a cancellation-classified Tool result, and interleaved real PNG/text/PNG reads through Pi's media normalization
and terminal fallback path. The media gate also proves that both images reach the next provider request after the UI
projection. An additional test runs Pi 0.84.1's real `ToolExecutionComponent` with Kitty capabilities and proves that
expanded multi-image output stays interleaved with its original Tool rows. Outer execution cancellation is covered
separately so the gate does not inherit process-exit timing races from Pi's native Bash path. The current certified
fixture measures 22 direct schemas / 31,188 serialized characters against one Code Mode schema / 1,251 characters, a
96.0% reduction in the provider-visible Tool contract. Including the system prompt and first user message, Pi 0.84.1's
public estimator reports 9,453 input tokens in direct mode and 1,024 with Code Mode. These figures vary with the active
Tool set; the gate measures the live Aggregate rather than a hard-coded inventory.

Nested execution preserves Pi's argument preparation, validation, call/result hooks, lifecycle events, cancellation,
streaming updates, Tool usage, newly activated Tool names, and termination hints. A serialization failure becomes a
normal failed Tool result instead of leaving a V8 cell hung.

One Code Mode execution may issue at most 768 nested Tool calls. Crossing the safety bound fails explicitly; calls
are never silently dropped, and separate Code Mode calls can still contribute to the same unbounded Activity Group.

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

- Pi Host: `0.84.1`
- Bun: `1.3.14`
- Host assets: Linux/macOS x64 and arm64, Windows x64 and arm64
- Non-Windows archive installation requires `tar`

See [UPSTREAM.md](UPSTREAM.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for provenance.

This package is published as Aggregate support code rather than a standalone Pi Runtime Resource. The registry it
needs exists only while the Aggregate is assembling its owned Tools; the `piStuff.aggregateOnly` manifest marker
makes that boundary explicit instead of shipping a standalone extension that cannot work correctly.
