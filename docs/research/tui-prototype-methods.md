# TUI Prototype Methods for Pi Stuff

**Date:** 2026-08-01  
**Product context:** Pi Stuff, with Pi 0.83.0 as the certified Host  
**Question:** How should Pi Stuff create interactive, screenshot-ready, recordable UI prototypes without replacing the terminal with an HTML imitation?

## Recommendation

Use a four-layer workflow:

1. **Build every accepted prototype as a fixture-driven Pi Extension and load it into the real Pi 0.83.0 Host.** This is the prototype itself.
2. **Use a fixed-size `tmux` pane plus Freeze for static decision frames.** `tmux` gives the real process an explicit columns-by-rows grid; `capture-pane -e` preserves the current ANSI screen, and Freeze turns that screen into a reviewable image without inventing a terminal window UI.
3. **Use VHS for scripted interaction and motion evidence.** It drives the real `pi` process through a terminal, can wait on visible screen content, and can emit PNG screenshots, GIF/MP4/WebM recordings, and text/ANSI golden files from one script.
4. **Require one manual pass in the maintainer's target native terminal before accepting a UI direction.** Freeze and VHS rasterize through their own renderers, so they certify real Host behavior and reproducible presentation, but not the exact glyph metrics or input behavior of every terminal emulator.

Use asciinema for exploratory recordings and lightweight sharing. Add `node-pty` plus `@xterm/headless` only when the Suite has stable flows worth programmatic terminal-state regression tests. HTML mockups may still compare rough information architecture, but they must not decide focus, keyboard handling, wrapping, resize behavior, or visual acceptance.

This preserves the repository's central architectural decision: Pi remains the Host. The prototype uses Pi's public TUI contract instead of creating another TUI shell.

## What counts as a real prototype

A Pi Stuff TUI prototype may use fake agents, frozen timers, and prewritten tool results. It does not need an LLM, credentials, network access, session persistence, or working Capability logic. It does need all of the following:

- the certified `pi` binary starts the prototype;
- the prototype is loaded as an Extension with `-e`;
- Pi owns the terminal lifecycle and renders the surrounding interface;
- the proposed surface is a real `@earendil-works/pi-tui` component opened through `ctx.ui.custom()`;
- keyboard input travels through a terminal/PTY to Pi and then to the focused component;
- wrapping and layout respond to the width supplied by Pi;
- the prototype can be resized through the viewport classes that the product intends to support.

Pi 0.83.0 defines a component as `render(width): string[]`, optional `handleInput(data)`, and `invalidate()`. Its documentation requires every rendered line to fit the supplied width, recommends `matchesKey()` for keyboard input, and exposes overlays, focus control, responsive visibility, Host theme values, and `tui.requestRender()` through the same system used by real Extensions. [`ctx.ui.custom()` and the component contract](https://github.com/earendil-works/pi/blob/v0.83.0/packages/coding-agent/docs/tui.md#component-interface) are therefore not implementation detail: they are the fidelity boundary for a Pi Stuff prototype.

The Host's own overlay implementation computes layout from current terminal dimensions and routes input to the focused component; the official overlay QA Extension exercises anchors, margins, stacking, responsive visibility, animation, and focus. These are precisely the behaviors an HTML facsimile cannot certify. See the pinned [Pi TUI source](https://github.com/earendil-works/pi/blob/v0.83.0/packages/tui/src/tui.ts) and [overlay QA Extension](https://github.com/earendil-works/pi/blob/v0.83.0/packages/coding-agent/examples/extensions/overlay-qa-tests.ts).

## Comparison

The ratings below separate **Host/interaction fidelity** from **pixel fidelity**. A renderer can drive the correct Pi process while still using different fonts or glyph measurements from the user's terminal.

| Method | Host and interaction fidelity | Interaction | Screenshot and sharing | Automation | Best role |
| --- | --- | --- | --- | --- | --- |
| Pi Extension in the target native terminal | Highest: the certified Host, its real TUI, terminal protocol, font, and keyboard path | Fully manual, including resize and IME | OS screenshot or external recorder; weak reproducibility by itself | Low | Final acceptance gate |
| Pi Extension in fixed-size `tmux`, rendered by Freeze | High: real `pi` process, real PTY, and exact requested cell grid; Freeze rasterizes the captured ANSI cells | Manual or scripted keys through `tmux`; captures one settled state | PNG, SVG, or WebP; plain rectangular terminal image is possible | Medium: shell-scriptable, but screen-content waits must be supplied separately | Default static decision frame |
| Pi Extension driven by VHS | High: real `pi` process and real key input, but rendered through VHS's ttyd/browser terminal | Scripted keys; manual actions can first be recorded into a tape | Native PNG screenshot command; GIF, MP4, WebM, or PNG-frame output; easy review | High: declarative tape, screen-content waits, golden `.txt`/`.ascii`, official CI action | Default scripted flow and motion evidence |
| Pi Extension recorded by asciinema, optionally rendered by agg | High at recording time: real terminal session and ANSI stream; replay pixels come from a different renderer | Excellent for unscripted manual exploration | Compact text-based `.cast`; terminal replay and web player; agg produces GIF, including selected single-frame GIFs | Medium: command recording is automatable, but user interaction is not a deterministic scenario language | Exploratory review and lightweight sharing |
| Pi under `node-pty` with `@xterm/headless`/serialize | High behavioral fidelity with exact programmed columns/rows; renderer semantics are xterm.js, not the target native terminal | Fully programmable input and resize | Headless mode has no pixel screenshot; serialized terminal-state snapshots are possible | Very high after building a harness | Later regression infrastructure |
| HTML terminal imitation | Low: no Pi focus ownership, ANSI layout, key protocol, or resize semantics | Only interactions explicitly reimplemented in JavaScript | Excellent and cheap | High, but tests the imitation | Early information-architecture sketch only |

Freeze's official TUI guidance is to run the application inside `tmux`, capture the pane, and pipe the result into Freeze. This combination matters because `tmux` controls terminal cells rather than browser pixels. Freeze still re-rasterizes those cells with a selected font, so it is a stable review image rather than a claim about the exact pixels produced by Kitty, Ghostty, or another native terminal. [Freeze TUI screenshot guidance](https://github.com/charmbracelet/freeze#screenshot-tuis).

VHS describes its tape as commands executed against a virtual terminal, supports real typing and TUI interaction, and depends on ttyd and ffmpeg. ttyd in turn runs arbitrary commands in a writable terminal with an `xterm-256color` default and supports CJK/IME. This makes VHS a real-process capture path, not a static HTML mock, while also explaining why its pixels are not the final native-terminal authority. [VHS command and installation reference](https://github.com/charmbracelet/vhs#vhs-command-reference); [ttyd features and options](https://github.com/tsl0922/ttyd#usage).

asciinema captures terminal output and timing into a lightweight asciicast rather than recording pixels. Asciicast v3 preserves initial columns, rows, terminal type, theme, output events, optional input events, resize events, and exit status. Its web player adds copyable text, accurate timing, markers, themes, and an optional keystroke overlay. This is ideal for discussion, but it is not a deterministic input driver or a pixel-accurate copy of the recording terminal. [asciinema CLI model](https://docs.asciinema.org/manual/cli/); [asciicast v3 format](https://docs.asciinema.org/manual/asciicast/v3/); [player capabilities](https://docs.asciinema.org/manual/player/).

`node-pty` supplies an actual pseudo-terminal with explicit `cols`, `rows`, input, and resize operations. `@xterm/headless` can track xterm.js terminal state in Node, and the serialize addon can export that state. This is powerful for regression tests, but it introduces a custom harness, native dependency, synchronization work, and an xterm-specific interpretation of the output. It should not be the first prototyping layer. [node-pty usage](https://github.com/microsoft/node-pty#example-usage); [xterm.js headless support](https://github.com/xtermjs/xterm.js#nodejs-support); [serialize addon](https://github.com/xtermjs/xterm.js/blob/master/addons/addon-serialize/README.md).

## Recommended working loop

### 1. Implement a fixture-driven Extension

Keep prototype code outside publishable Packages, for example:

```text
docs/prototypes/tui/
  agents-hub-reference.ts
  agents-hub-reference.tape
  artifacts/
```

The TypeScript file should register one clearly named command, such as the existing `/prototype-agents`, and open a real component with `ctx.ui.custom()`. If the proposed product surface is an overlay, use `{ overlay: true, overlayOptions: ... }`; if it temporarily replaces the editor, use the non-overlay form. Use the injected Host theme rather than hard-coded ANSI colors, `matchesKey()` rather than comparing raw byte strings, and `truncateToWidth()` or `wrapTextWithAnsi()` when content can exceed the supplied width. After state changes, invalidate cached output and call `tui.requestRender()`. These are all requirements or facilities in the pinned [Pi 0.83.0 TUI documentation](https://github.com/earendil-works/pi/blob/v0.83.0/packages/coding-agent/docs/tui.md).

The fixtures should expose the states that matter to the design decision, not simulate the entire product. For an agent surface, that may be idle, running, waiting for input, failed, and completed. Freeze elapsed times, identifiers, paths, spinner frames, and message text so screenshots and golden files are stable. Avoid model calls and background work; those test product behavior, not the proposed interaction surface.

### 2. Run it directly in the certified Host

Use an isolated invocation so unrelated installed Runtime Resources, sessions, tools, context files, or startup network activity do not change the screen:

```bash
# Run from the Pi Stuff repository root.
PI_STUFF_PI=./node_modules/.bin/pi
test -x "$PI_STUFF_PI"
test "$("$PI_STUFF_PI" --version)" = "0.83.0"

PI_TUI_WRITE_LOG=/tmp/pi-stuff-tui.log \
  "$PI_STUFF_PI" --no-session \
     --no-extensions \
     -e ./docs/prototypes/tui/agents-hub-reference.ts \
     --no-skills \
     --no-prompt-templates \
     --no-context-files \
     --no-tools \
     --no-themes \
     --offline \
     --approve
```

Pi documents `-e` for loading an Extension file and explicitly permits `--no-extensions` together with explicit `-e` paths. The repository-pinned 0.83.0 executable exposes `--no-session`, the resource-discovery switches, `--no-tools`, `--offline`, and `--approve`. Treat `./node_modules/.bin/pi --help`, not a same-version global executable, as the command-line source of truth for prototype scripts; no additional interface-layout flag is used here. See the exact [published 0.83.0 Package](https://www.npmjs.com/package/@earendil-works/pi-coding-agent/v/0.83.0) and [Extension testing guidance](https://github.com/earendil-works/pi/blob/v0.83.0/packages/coding-agent/docs/extensions.md).

This exact invocation was smoke-tested on 2026-08-01: the repository-pinned executable started, loaded `agents-hub-reference.ts`, opened `/prototype-agents`, wrote a non-empty `PI_TUI_WRITE_LOG`, and exited cleanly without a model call.

`PI_TUI_WRITE_LOG` records the raw ANSI stream written by Pi and is useful when a repaint, cursor, or clearing bug is hard to diagnose; it is diagnostic evidence, not a screenshot. [Pi's debug logging note](https://github.com/earendil-works/pi/blob/v0.83.0/packages/coding-agent/docs/tui.md#debug-logging) documents the variable.

During manual review, resize the actual terminal while the surface is open, verify focus returns to the editor after closing, and type real Chinese text anywhere the design accepts text. A browser-terminal capture cannot replace this IME and terminal-protocol check; Pi's own TUI contract has explicit cursor-marker and focus propagation requirements for IME-capable components. [Pi IME support](https://github.com/earendil-works/pi/blob/v0.83.0/packages/coding-agent/docs/tui.md#focusable-interface-ime-support).

### 3. Capture an exact-grid static frame

Use `tmux` for static comparison frames so the prototype and its reference receive the same terminal-cell geometry. Start the real repository-pinned Host in an explicitly sized pane:

```bash
# Run from the Pi Stuff repository root.
PI_STUFF_CAPTURE_SESSION=pi-stuff-agents-reference

tmux new-session -d \
  -s "$PI_STUFF_CAPTURE_SESSION" \
  -x 100 \
  -y 32 \
  -c "$PWD" \
  './node_modules/.bin/pi --no-session --no-extensions -e ./docs/prototypes/tui/agents-hub-reference.ts --no-skills --no-prompt-templates --no-context-files --no-tools --no-themes --offline --approve'

tmux send-keys -l -t "$PI_STUFF_CAPTURE_SESSION" '/prototype-agents'
tmux send-keys -t "$PI_STUFF_CAPTURE_SESSION" Enter
```

After the expected state appears, preserve both an inspectable plain-text frame and a color ANSI frame, then render the ANSI frame:

```bash
PI_STUFF_CAPTURE_SESSION=pi-stuff-agents-reference

tmux capture-pane -p -t "$PI_STUFF_CAPTURE_SESSION" \
  > /tmp/pi-stuff-agents-reference.txt
tmux capture-pane -p -e -N -t "$PI_STUFF_CAPTURE_SESSION" \
  > /tmp/pi-stuff-agents-reference.ansi

freeze -c base \
  --margin 0 \
  --padding 8 \
  --border.radius 0 \
  --font.family 'Iosevka Nerd Font Mono' \
  --font.size 15 \
  --line-height 1.15 \
  -o docs/prototypes/tui/artifacts/pi-0.83-agents-reference.png \
  /tmp/pi-stuff-agents-reference.ansi

tmux kill-session -t "$PI_STUFF_CAPTURE_SESSION"
```

Pin the Freeze version, font file, font size, line height, palette, and `tmux` geometry before treating regenerated images as comparable. Use `capture-pane -e` to retain ANSI styling and `-N` to retain trailing spaces that carry background fills. Keep the plain-text frame during debugging because it makes truncation and wrapping mistakes easy to inspect. The current reference set was captured at `100 × 32` with Freeze `0.2.2`.

### 4. Turn the successful path into a VHS tape

VHS can first record manual actions into an editable tape:

```bash
vhs record > docs/prototypes/tui/agents-hub-reference.tape
vhs validate docs/prototypes/tui/agents-hub-reference.tape
vhs docs/prototypes/tui/agents-hub-reference.tape
```

The official workflow is to record actions, exit, edit the generated tape, and replay it. A tape can produce several outputs, capture a PNG at an exact state, wait until a regex is present on the whole screen, and produce `.txt` or `.ascii` output for golden-file comparison. [Recording tapes](https://github.com/charmbracelet/vhs#record-tapes), [screenshots and waits](https://github.com/charmbracelet/vhs#vhs-command-reference), and [golden files](https://github.com/charmbracelet/vhs#continuous-integration) are first-class VHS features.

An illustrative tape is:

```tape
Require node

Output docs/prototypes/tui/artifacts/agents-hub-reference.gif
Output docs/prototypes/tui/artifacts/agents-hub-reference.mp4
Output docs/prototypes/tui/artifacts/agents-hub-reference.ascii

Set Shell bash
Set Width 1100
Set Height 720
Set FontFamily "Iosevka Term"
Set FontSize 16
Set TypingSpeed 20 ms
Set CursorBlink false

Hide
Type `mkdir -p docs/prototypes/tui/artifacts`
Enter
Type `test -x ./node_modules/.bin/pi`
Enter
Type `test "$(./node_modules/.bin/pi --version)" = "0.83.0"`
Enter
Type `clear`
Enter
Show

Type `./node_modules/.bin/pi --no-session --no-extensions -e ./docs/prototypes/tui/agents-hub-reference.ts --no-skills --no-prompt-templates --no-context-files --no-tools --no-themes --offline --approve`
Enter
Wait+Screen /pi-stuff/

Type "/prototype-agents"
Enter
Wait+Screen /Agents/
Screenshot docs/prototypes/tui/artifacts/agents-hub-running.png

Right
Down
Wait+Screen /Project agents/
Screenshot docs/prototypes/tui/artifacts/agents-hub-library.png

Down
Enter
Wait+Screen /code-reviewer/
Screenshot docs/prototypes/tui/artifacts/agents-hub-agent-menu.png
```

Keep the visible labels used by `Wait+Screen` stable. Prefer content waits over fixed `Sleep` calls so the tape fails when the expected state never appears and does not depend on machine speed. Use only key commands supported by the pinned VHS version; the official reference documents text entry, arrows, Enter, Tab, Space, Backspace, scrolling, and Ctrl/Alt/Shift combinations. [VHS's command reference](https://github.com/charmbracelet/vhs#vhs-command-reference) also documents `Hide`/`Show`, environment variables, reusable sourced tapes, and multiple output formats.

The tape above was independently syntax-checked and fully rendered on 2026-08-01 with VHS 0.11.0, ttyd 1.7.7, and ffmpeg. The real repository-pinned Pi process reached all three `Wait+Screen` states and produced three 1100 × 720 PNG screenshots plus non-empty GIF, MP4, and ANSI outputs. These are verification versions, not yet a Pi Stuff tooling-version decision.

VHS `Set Width` and `Set Height` describe pixel dimensions of its rendered terminal, not a direct columns-by-rows contract. Pin VHS, ttyd, ffmpeg, the font, font size, padding, and theme used for accepted artifacts. Make the prototype display a small debug-only `columns × rows` label from `tui.terminal.columns` and `.rows`, wait for that label in the tape, and calibrate each capture profile once. Do not infer that two machines will produce the same character geometry merely because their VHS pixel dimensions match.

Create separate tapes or sourced profiles for representative viewport classes. A sensible starting matrix, to be adjusted after measuring real usage, is:

| Profile | Target terminal cells | Purpose |
| --- | --- | --- |
| Standard | 100 × 32 | Primary design and screenshots |
| Narrow | 64 × 28 | Collapse and truncation behavior |
| Minimum | 40 × 24 | Explicit unsupported/compact behavior |
| Wide and short | 100 × 18 | Height pressure, overlays, and footer/editor coexistence |

Exercise both the non-overlay and overlay form only when a design is genuinely considering both ownership models. The cell values above are product-test recommendations, not limits imposed by Pi.

### 5. Keep the right evidence

For each accepted flow, commit:

- the fixture-driven TypeScript prototype;
- the deterministic `.tape` scenario;
- one or two representative PNG screenshots;
- the `.ascii` or `.txt` golden output when it remains stable and readable.

Generate large GIF/MP4/WebM artifacts in CI or attach them to reviews/releases rather than growing the Git repository indefinitely. VHS supports multiple visual outputs and an official GitHub Action, while its `.ascii`/`.txt` output is explicitly intended for checked-in integration-test golden files. [VHS outputs and CI](https://github.com/charmbracelet/vhs#continuous-integration).

A visual artifact passing does not prove usability. Acceptance still requires the manual native-terminal checklist below.

## Native-terminal acceptance checklist

Review the prototype in the terminal and font actually used for Pi Stuff work:

- open, close, reopen, and interrupt the surface;
- verify which surface owns focus at every step and where focus returns;
- use arrows, Enter, Escape, Tab, Shift+Tab, and any documented shortcuts;
- resize while focused, including below the intended minimum width and height;
- inspect long paths, long agent names, multiline output, ANSI styling, CJK text, emoji, and ambiguous-width glyphs;
- test Chinese IME in every editable field;
- test running, waiting, failed, cancelled, and completed fixtures;
- test every intended viewport class in the default Host interface;
- verify that surrounding Pi editor, footer, notifications, and overlays remain legible;
- repeat with the main dark and light/high-contrast theme profiles before calling the visual system stable.

This pass catches the gap between correct Pi behavior and renderer-specific pixels: fonts, fallback glyphs, line height, color palette, terminal keyboard protocols, mouse handling, Kitty images, OSC support, and IME behavior can differ among native terminals, ttyd/xterm, asciinema player, and agg.

## Where asciinema fits

Use asciinema when the interaction is not yet stable enough to script or when another person needs to inspect an exploratory session with copyable text:

```bash
# Run from the Pi Stuff repository root.
mkdir -p docs/prototypes/tui/artifacts

asciinema rec \
  --command './node_modules/.bin/pi --no-session --no-extensions -e ./docs/prototypes/tui/agents-hub-reference.ts --no-skills --no-prompt-templates --no-context-files --no-tools --no-themes --offline --approve' \
  --idle-time-limit 2 \
  docs/prototypes/tui/artifacts/agents-hub-reference.cast

asciinema play docs/prototypes/tui/artifacts/agents-hub-reference.cast
agg docs/prototypes/tui/artifacts/agents-hub-reference.cast \
    docs/prototypes/tui/artifacts/agents-hub-reference.gif
agg --select 12.5 \
    docs/prototypes/tui/artifacts/agents-hub-reference.cast \
    docs/prototypes/tui/artifacts/agents-hub-reference-frame.gif
```

The official CLI supports `rec -c/--command`, `play`, and idle-time limiting; it recommends replaying in a terminal at least as large as the recorded geometry because control sequences are not transcoded for a new size. agg converts asciicast recordings to optimized GIFs and can select a time range or a single state. [asciinema quick start](https://docs.asciinema.org/manual/cli/quick-start/); [agg usage](https://docs.asciinema.org/manual/agg/usage/#frame-selection).

Do not use agg's `--cols` or `--rows` override to claim that a stateful Pi surface was tested at another geometry. Re-record the real Host at that geometry: Pi may make different layout decisions while it is running, and replay-time reflow cannot reproduce them.

Input capture is disabled by default in asciinema. Enable `--capture-input` only when a keystroke overlay is essential, then review the cast before sharing: the official FAQ describes it as terminal-scoped keylogging that captures passwords even when terminal echo is disabled. [asciinema input-capture warning](https://docs.asciinema.org/faq/#does-asciinema-record-the-commands-i-type).

Keep casts local by default. `asciinema upload` is optional; the official tooling also supports local playback, local streaming, embedding, and self-hosting. [Sharing options](https://docs.asciinema.org/manual/cli/quick-start/#share-via-asciinemaorg).

## When to add a headless PTY harness

Adopt `node-pty` plus `@xterm/headless` only after repeated regressions justify its maintenance cost. It becomes useful when tests need to:

- start Pi at an exact `cols × rows` geometry;
- send byte-accurate key sequences;
- resize at a precise point in a scenario;
- wait for terminal state programmatically;
- serialize the final buffer for structured or golden comparison.

The dependency direction would be:

```bash
bun add --dev node-pty @xterm/headless @xterm/addon-serialize
```

The harness would spawn `pi` directly with `cols`, `rows`, `cwd`, `env`, and `name: "xterm-256color"`; feed each `onData` chunk into the headless terminal; write input bytes to the PTY; call `resize(cols, rows)`; and serialize only after the terminal has consumed the expected output. The APIs for spawning, writing, and resizing are shown in the official [node-pty example](https://github.com/microsoft/node-pty#example-usage), and xterm.js documents headless state tracking and serialization as its Node use case. [xterm.js headless support](https://github.com/xtermjs/xterm.js#nodejs-support).

This harness would be a development test dependency, not a Runtime Resource and not a replacement Host. Headless serialization is also not a screenshot: if browser-rendered PNGs were required, a browser xterm.js renderer plus a screenshot runner would be another layer, and native-terminal acceptance would still remain necessary. The serialize addon is described as experimental, so its version and snapshots would need deliberate pinning. [Serialize addon status](https://github.com/xtermjs/xterm.js/blob/master/addons/addon-serialize/README.md).

## Decision rules

- **A UI concept may begin in HTML, but it cannot be accepted there.** Move it into a real Pi Extension before deciding focus, density, wrapping, shortcuts, overlays, or visual quality.
- **`tmux` plus Freeze is the default static artifact path.** It makes reference and proposal frames comparable at an explicit terminal-cell geometry.
- **VHS is the default reproducible flow path.** It gives the best combination of real process interaction, screen-content waits, recordings, and automation.
- **The target native terminal is the final authority.** Every accepted direction gets a manual behavior, resize, glyph, and IME pass.
- **asciinema is the discussion recorder.** Prefer it for spontaneous flows and compact, text-preserving sharing, not deterministic acceptance.
- **Headless PTY testing is earned infrastructure.** Add it after stable flows exist and recurring terminal regressions make its cost worthwhile.
- **Prototype data is deterministic.** No LLM, credentials, network, changing clocks, random IDs, or live subprocess timing should be required to reach a review state.
- **The Host remains visible.** A prototype must show how the proposed surface coexists with Pi's editor, output, footer, status, and overlays rather than presenting an isolated replacement-shell fantasy.

The resulting workflow is intentionally asymmetric: use the real Host to build the interaction, `tmux` plus Freeze to compare settled states, VHS to make the flow reproducible, and the native terminal to decide whether it actually feels right.
