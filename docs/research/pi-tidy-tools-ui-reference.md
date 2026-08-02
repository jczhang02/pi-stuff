# `pi-tidy-tools` as a Tool-Output UI Reference

**Date:** 2026-08-01  
**Product context:** Pi Stuff, with Pi 0.83.0 as the Host  
**Package inspected:** `@mobrienv/pi-tidy-tools` 0.4.1  
**Published source tag:** `pi-tidy-tools-v0.4.1`, commit `4b251377f1b64f904704e7f760e8947688d12a9a`

## Decision

Treat `pi-tidy-tools` as a **high-value reference and a provisional owned-fork candidate**, not as a selected dependency or a finished Pi Stuff design.

It is unusually close to the problem Pi Stuff needs to solve: it replaces Pi's spacious built-in tool cards with compact operation rows, updates running state in place, summarizes results by tool type, expands details on demand, and offers a last-turn diff. It does this through documented Pi Extension seams and has a strong test suite.

It is not yet a mature base we should adopt unchanged. The repository and package were only weeks old at this review; its default layout changes model-visible tool schemas to force a `reasoning` argument; it only covers Pi's seven built-in tools; its fixed ANSI colors, emoji categories, full-row backgrounds, and command-driven settings do not match the chosen Claude Code-like Pi Stuff direction; its global expansion can flood a long transcript; Pi 0.83 compatibility is promising but not release-certified; and an open performance PR reports severe typing lag in long sessions.

If Pi Stuff later adopts it, the project rule applies: **fork a pinned upstream revision into Pi Stuff ownership**. Do not depend on the upstream package at runtime, and do not start the fork until the real-Pi prototype establishes the desired operation grammar.

## Research boundary and provenance

The public package page describes 0.4.1 as an MIT-licensed Pi Extension published on 2026-07-19. The npm manifest requires Node `>=22.19.0`, declares Pi coding-agent and TUI peers `>=0.80.6`, and exposes one Extension entry point. See the [Pi package page](https://pi.dev/packages/%40mobrienv/pi-tidy-tools), [npm registry metadata](https://registry.npmjs.org/@mobrienv%2Fpi-tidy-tools/latest), [published package manifest](https://github.com/mikeyobrien/pi-tidy-tools/blob/4b251377f1b64f904704e7f760e8947688d12a9a/packages/pi-tidy-tools/package.json), and [MIT license](https://github.com/mikeyobrien/pi-tidy-tools/blob/4b251377f1b64f904704e7f760e8947688d12a9a/packages/pi-tidy-tools/LICENSE).

Source was audited in a temporary checkout at HEAD `de005e986877e45fac379eb698a564d3d7685249`; `packages/pi-tidy-tools/` had no changes after the published 0.4.1 tag. Repository-relative source references below therefore describe the published package and are also linked to the immutable tag.

No source was copied into Pi Stuff. The package was not installed into the user's Pi configuration. Runtime checks used isolated temporary Pi configuration directories and explicit `-e` loading.

## What the user actually sees

### Covered tools

The Extension restyles exactly seven built-in tools:

- retrieval: `read`, `grep`, `find`, `ls`;
- mutation: `write`, `edit`;
- execution: `bash`.

It does not restyle MCP or other third-party tools. The README states that Pi cannot replace a foreign tool's renderer without also owning its execution. This is an important product boundary: the package can be a renderer basis for Pi Stuff-owned tools, but it is not a universal answer for the external and web tools that Pi Stuff considers a major product area. [`packages/pi-tidy-tools/index.ts:34-36`](https://github.com/mikeyobrien/pi-tidy-tools/blob/4b251377f1b64f904704e7f760e8947688d12a9a/packages/pi-tidy-tools/index.ts#L34-L36)

### Compact layouts

There are three persisted layouts:

| Mode | Collapsed shape | Model-visible effect |
| --- | --- | --- |
| `default` | Two lines: `tool + purpose`, then `target → result` | Adds a required `reasoning` field to all seven tool schemas |
| `reasoning` | One line: `tool + purpose → result` | Adds the same required `reasoning` field |
| `result` | One line: `tool + target → result` | Keeps the native tool schemas unchanged |

The result summaries are tool-specific rather than generic: read line count; written line/byte count; edit additions and deletions; bash status and elapsed time; grep matches and files; find file count; and ls entry count. [`packages/pi-tidy-tools/index.ts:161-210`](https://github.com/mikeyobrien/pi-tidy-tools/blob/4b251377f1b64f904704e7f760e8947688d12a9a/packages/pi-tidy-tools/index.ts#L161-L210), [`packages/pi-tidy-tools/index.ts:342-380`](https://github.com/mikeyobrien/pi-tidy-tools/blob/4b251377f1b64f904704e7f760e8947688d12a9a/packages/pi-tidy-tools/index.ts#L342-L380)

The default and reasoning modes do more than restyle UI. They prepend a required, model-generated `reasoning` argument with a detailed prompt contract and strip it before native execution. The result mode is the only presentation-only mode. [`packages/pi-tidy-tools/tool-composition.ts:25-68`](https://github.com/mikeyobrien/pi-tidy-tools/blob/4b251377f1b64f904704e7f760e8947688d12a9a/packages/pi-tidy-tools/tool-composition.ts#L25-L68)

### Running, success, and error

- While a call is running, a semantic dot and elapsed duration update in place once per second. The row uses Pi's pending background.
- A settled success or error removes the inline status glyph and relies on Pi's full-row success or error background.
- An error normally keeps the target and first error line. Bash is a special case: its collapsed error says only `error in <duration>` and omits the exit code and stderr until expansion.
- There is no separate visible grammar for queued, rejected, or canceled operations. The renderer distinguishes partial/running, success, and error.

The timers, event hooks, and background selection are visible in [`packages/pi-tidy-tools/index.ts:486-543`](https://github.com/mikeyobrien/pi-tidy-tools/blob/4b251377f1b64f904704e7f760e8947688d12a9a/packages/pi-tidy-tools/index.ts#L486-L543). A real Pi 0.83 PTY check confirmed the dot, one-second in-place elapsed updates, pending background, and full-row settled backgrounds.

### Expansion and detail

Pi's `Ctrl+O` expansion passes `expanded` into the renderer. A settled row then appends:

- `edit`: colored, line-numbered diff;
- `write`: full written content with line numbers;
- `bash`: full multi-line command followed by output;
- retrieval tools: raw result text.

[`packages/pi-tidy-tools/index.ts:289-335`](https://github.com/mikeyobrien/pi-tidy-tools/blob/4b251377f1b64f904704e7f760e8947688d12a9a/packages/pi-tidy-tools/index.ts#L289-L335)

The real-host check exposed an important practical detail: `Ctrl+O` is a global transcript toggle, not a per-row disclosure control. It expanded every prior tool together with Pi's startup detail. A 60-line Bash result was emitted in full; the Extension imposes no per-item line cap or secondary fold. This is useful as a detailed transcript mode, but unsafe as the only way to inspect one large result.

### Width and truncation

Every rendered line is ANSI-aware and forced to the current terminal width. When a line contains the result arrow, truncation protects the result tail and truncates the head first; rows reflow on resize and do not soft-wrap. [`packages/pi-tidy-tools/index.ts:98-136`](https://github.com/mikeyobrien/pi-tidy-tools/blob/4b251377f1b64f904704e7f760e8947688d12a9a/packages/pi-tidy-tools/index.ts#L98-L136)

This works well for compact success summaries at 46 columns. It has a failure tradeoff: if the error tail is long, the target can disappear. A narrow real-host `read` ENOENT case lost the target while preserving a truncated error. Bash errors have the opposite information loss because their compact summary deliberately omits the real error.

### `/diff`

Successful `edit` and `write` calls are collected in memory. `/diff` or `Ctrl+Shift+O` inserts a custom transcript message containing colored, per-file changes from `lastTurn`. [`packages/pi-tidy-tools/index.ts:261-286`](https://github.com/mikeyobrien/pi-tidy-tools/blob/4b251377f1b64f904704e7f760e8947688d12a9a/packages/pi-tidy-tools/index.ts#L261-L286), [`packages/pi-tidy-tools/index.ts:519-551`](https://github.com/mikeyobrien/pi-tidy-tools/blob/4b251377f1b64f904704e7f760e8947688d12a9a/packages/pi-tidy-tools/index.ts#L519-L551)

The concept is valuable, but the current lifecycle is fragile. `turn_end` always replaces `lastTurn`, including with an empty collection. In a real Pi 0.83 agent loop, a successful edit followed by the model's prose-only continuation resulted in `/diff` reporting no changes. This matches the source assignment at lines 537-539 and means “last model turn” can differ from the user's expected “last task.” Treat the current `/diff` implementation as a prototype, not a behavior to inherit unchanged.

The default shortcut also conflicts with Pi's built-in backward tree-filter cycle; the upstream README documents the collision. A Pi Stuff fork should not claim an existing Host binding. [Upstream shortcut warning](https://github.com/mikeyobrien/pi-tidy-tools/blob/4b251377f1b64f904704e7f760e8947688d12a9a/packages/pi-tidy-tools/README.md#L73-L74)

## How it works inside Pi

The core approach stays on documented public seams:

1. It creates behavior-bearing definitions from Pi's exported built-in factories.
2. It re-registers each tool under the same name, which is Pi's supported built-in override mechanism.
3. It supplies `renderCall`, `renderResult`, and `renderShell: "self"` to own the compact row.
4. It uses documented tool lifecycle events for elapsed time and diff collection.
5. It uses public commands, shortcuts, `registerMessageRenderer`, `sendMessage`, and `ctx.reload()` for management and `/diff`.

Pi explicitly documents same-name built-in overrides and independent custom render slots, and recommends compact defaults with partial and expanded states. [Pi 0.83 Extension documentation: overriding built-ins](https://github.com/earendil-works/pi/blob/v0.83.0/packages/coding-agent/docs/extensions.md#overriding-built-in-tools), [custom rendering](https://github.com/earendil-works/pi/blob/v0.83.0/packages/coding-agent/docs/extensions.md#custom-rendering).

Execution is delegated unchanged for six native tools after stripping the injected `reasoning` field. `write` is the exception: it wraps Pi's write operations to read the previous content and generate a diff. [`packages/pi-tidy-tools/tool-composition.ts:48-104`](https://github.com/mikeyobrien/pi-tidy-tools/blob/4b251377f1b64f904704e7f760e8947688d12a9a/packages/pi-tidy-tools/tool-composition.ts#L48-L104)

The optional `pi-fff` integration is much more than presentation: it manages settings, captures and replays another Extension's registrations, validates capability shapes, journals setup/teardown, and can substitute search execution. It contributes substantially more code and lifecycle risk than the compact renderer itself. It should not enter a Pi Stuff tool-UI fork unless file-search execution is chosen as a separate capability.

## Configuration and interaction

`/tidy` manages enablement, three modes, icons, and optional `pi-fff` integration. Changes are persisted to `~/.pi/agent/pi-tidy-tools.json` and usually reload Extensions. `PI_TIDY_TOOLS` can override whole-Extension enablement. [`packages/pi-tidy-tools/config.ts:5-104`](https://github.com/mikeyobrien/pi-tidy-tools/blob/4b251377f1b64f904704e7f760e8947688d12a9a/packages/pi-tidy-tools/config.ts#L5-L104), [`packages/pi-tidy-tools/index.ts:414-477`](https://github.com/mikeyobrien/pi-tidy-tools/blob/4b251377f1b64f904704e7f760e8947688d12a9a/packages/pi-tidy-tools/index.ts#L414-L477)

The config path is built directly from the process home directory rather than Pi's configured agent directory. An isolated real-host check confirmed that changing `PI_CODING_AGENT_DIR` did not relocate this file. A Pi Stuff fork must use the Host's public path contract instead of assuming `~/.pi/agent`.

This is functional but does not match Pi Stuff's already selected settings direction. User-facing settings should use Pi's native `SettingsList` surface. `/tidy status` may remain a diagnostic command, but a command grammar should not be the primary settings UI.

## Screenshot fidelity

The upstream PNGs are good evidence for the renderer's row strings, but they are **not real Pi/PTY screenshots** and must not be used as Pi Stuff visual acceptance evidence.

The demo generator executes some built-in tools, passes results through the actual `buildToolBlock`, converts ANSI to HTML, and screenshots it with headless Chrome. It then hand-creates the user prompt, spinner, editor rules, terminal window, gradient, spacing, fonts, and success/error backgrounds in HTML/CSS. Some displayed commands also differ from the commands that produced the underlying result fixtures. [`packages/pi-tidy-tools/docs/demo.sh:1-39`](https://github.com/mikeyobrien/pi-tidy-tools/blob/4b251377f1b64f904704e7f760e8947688d12a9a/packages/pi-tidy-tools/docs/demo.sh#L1-L39), [`packages/pi-tidy-tools/docs/demo-html.ts:79-128`](https://github.com/mikeyobrien/pi-tidy-tools/blob/4b251377f1b64f904704e7f760e8947688d12a9a/packages/pi-tidy-tools/docs/demo-html.ts#L79-L128), [`packages/pi-tidy-tools/docs/demo-html.ts:129-175`](https://github.com/mikeyobrien/pi-tidy-tools/blob/4b251377f1b64f904704e7f760e8947688d12a9a/packages/pi-tidy-tools/docs/demo-html.ts#L129-L175)

Pi Stuff should keep its stricter evidence rule: run the proposed renderer inside the pinned Pi Host through a PTY, capture the actual terminal cells, and use HTML only as a report wrapper.

## Compatibility and quality evidence

### Published dependency floor

The package declares Pi coding-agent and TUI peers `>=0.80.6` with no upper bound and develops against 0.80.6. It therefore claims forward compatibility through a range, not certification against every later Pi release. [`packages/pi-tidy-tools/package.json:53-62`](https://github.com/mikeyobrien/pi-tidy-tools/blob/4b251377f1b64f904704e7f760e8947688d12a9a/packages/pi-tidy-tools/package.json#L53-L62)

### Pi 0.83 observations

Two isolated checks were performed:

- The exact published npm package loaded under Pi 0.83.0 through `-e npm:@mobrienv/pi-tidy-tools@0.4.1`; `/tidy status` reported the Extension active. This proves package installation, startup, and command registration only.
- A maintainer-local dependency substitution to `@earendil-works/pi-coding-agent` 0.83.0, `@earendil-works/pi-tui` 0.83.0, and TypeScript 5.9.3 typechecked cleanly. Of 198 tests, 195 passed. The three failures were: an exact prompt-guideline assertion changed by a new Pi 0.83 Bash guideline; a test that intentionally expects the old pinned 0.80.6 host identity; and the optional `pi-fff` loader not finding its old TypeBox alias. Core renderer tests passed.

This is encouraging compatibility evidence, **not a Pi 0.83 release certification**. A fork candidate still needs its own pinned 0.83 dependency update, full green suite, real-host state matrix, and long-session test.

### Test suite

Against the published package's pinned dependency set:

- `npm test --workspace @mobrienv/pi-tidy-tools`: 198/198 passed;
- `npm run check --workspace @mobrienv/pi-tidy-tools`: passed;
- independently observed c8 totals across the package runtime, including `pi-fff`: 97.56% statements/lines, 88.86% branches, and 96.79% functions;
- the core package files excluding `pi-fff` measured 99% statements/lines, 94.49% branches, and 100% functions;
- `npm audit --omit=dev`: no runtime vulnerability reported during this audit.

The repository also publishes an 81.97% mutation-score baseline for this package. That value was not rerun in this audit. [Upstream quality-gate baseline](https://github.com/mikeyobrien/pi-tidy-tools/blob/de005e986877e45fac379eb698a564d3d7685249/docs/quality-gates.md#L78-L88)

The test discipline is strong, particularly around exact renderer rows, width handling, timers, config writes, execution delegation, and the optional integration lifecycle. It reduces implementation risk but does not compensate for the package's short production history.

### Maturity and maintenance

As of this review:

- GitHub reports the repository was created on 2026-07-10; it is a monorepo maintained primarily by one author.
- npm lists eight package versions from 0.1.0 through 0.4.1, all published between 2026-07-11 and 2026-07-19.
- npm's rolling APIs reported 1,616 downloads for 2026-07-01 through 2026-07-30 and 101 for 2026-07-24 through 2026-07-30. Downloads are not unique users and can include automation.
- The repository had 54 stars and two forks, but those figures cover the whole `pi-tidy-*` monorepo.

Sources: [GitHub repository API](https://api.github.com/repos/mikeyobrien/pi-tidy-tools), [npm last-month downloads](https://api.npmjs.org/downloads/point/last-month/%40mobrienv%2Fpi-tidy-tools), [npm last-week downloads](https://api.npmjs.org/downloads/point/last-week/%40mobrienv%2Fpi-tidy-tools), [npm release history](https://registry.npmjs.org/@mobrienv%2Fpi-tidy-tools).

An open pull request reports that settled rows are recomputed on every TUI render and measured roughly 300-400 ms frames in a long session with hundreds of tool calls; it proposes caching rows per width. Source inspection confirms 0.4.1 has no settled-row cache, but this audit did not independently reproduce the reporter's timing. This is a release gate for any fork. [Open long-session performance PR #63](https://github.com/mikeyobrien/pi-tidy-tools/pull/63)

## What Pi Stuff should keep

These are product principles worth carrying into the Pi Stuff operation system:

1. **One compact operation row owns its live and settled states.** Do not append progress ticks to the transcript.
2. **Summaries are semantic.** “2 matches in 1 file,” “+3/-1,” and “done in 4s” are more useful than raw output counts.
3. **Default is compact; detail remains available.** Mutation diffs, commands, and raw results must not be lost merely because they are hidden initially.
4. **Tool layout is width-aware.** Never allow uncontrolled soft wrapping; explicitly choose which information survives truncation.
5. **The result tail has priority.** Users usually need to know what happened before seeing the full target.
6. **Mutation review is a separate action.** A coherent “changes from this task” view is valuable even when individual edit rows are compact.
7. **Use Pi's public renderer and override seams.** No Pi fork is required for owned tools or built-ins.

## What Pi Stuff should not inherit unchanged

1. **Do not require a synthetic `reasoning` argument on every tool.** It spends model tokens, changes the tool contract, can duplicate assistant prose, and cannot apply consistently to foreign tools. Prototype purpose text separately; keep a target/result-only baseline.
2. **Do not make emoji categories the default.** The package supports icons off; the Claude Code-like Pi Stuff baseline should use a small semantic glyph system and Host typography.
3. **Do not hard-code ANSI foreground colors.** The source uses fixed cyan/yellow/magenta/green/red sequences while only backgrounds come from the Pi theme. Pi Stuff should use semantic Host theme tokens for accessibility and theme coherence. [`packages/pi-tidy-tools/vendor/pi-tidy-core/index.ts:4-17`](https://github.com/mikeyobrien/pi-tidy-tools/blob/4b251377f1b64f904704e7f760e8947688d12a9a/packages/pi-tidy-tools/vendor/pi-tidy-core/index.ts#L4-L17)
4. **Do not paint every settled success as a full-width green band.** Keep ordinary success visually quiet; reserve strong background emphasis for running attention, failure, rejection, or required user action.
5. **Do not treat global unbounded expansion as sufficient.** Detailed transcript mode is useful, but one huge result needs a line cap and a focused inspection path.
6. **Do not stop at three states.** Pi Stuff's operation grammar needs queued/waiting, running, success, error, rejected, and canceled where the underlying capability exposes them.
7. **Do not leave third-party tools visually unrelated.** Pi Stuff cannot override arbitrary foreign tools safely, so it should define a renderer contract for every owned capability and use explicit adapters only where it owns execution.
8. **Do not use `/tidy` subcommands as the primary settings experience.** Use Pi's native Settings component.
9. **Do not carry optional `pi-fff` orchestration into a UI fork by default.** Evaluate file-search execution as a separate capability and fork decision.
10. **Do not copy the current `/diff` lifecycle or shortcut.** Define “last task” explicitly, persist the right boundary, and avoid Host key collisions.

## Fork-adoption gates

Promote this from provisional candidate to selected owned fork only after all of the following:

- a real Pi 0.83 fixture prototype compares target/result-only and optional purpose layouts;
- collapsed, running, success, failure, rejected, canceled, narrow, expanded, and very-large-output states are captured through a real PTY;
- the foreground palette uses Pi theme semantics and the accepted Claude Code-like glyph/indent grammar;
- Settings uses Pi's native Settings component;
- owned Pi Stuff tools, including external/web tools, share the same operation contract;
- global transcript detail and focused large-result inspection are both defined;
- the long-session render cache issue is resolved and benchmarked;
- the Pi 0.83 dependency suite is fully green;
- `pi-fff` is either removed or approved as an independently justified capability;
- the fork preserves MIT attribution and records the exact upstream base revision in Beads.

Until those gates pass, the concrete Pi Stuff decision is:

> Use `pi-tidy-tools` to inform the tool-output grammar. Do not install it as the Suite implementation and do not let its current visual styling decide the design.
