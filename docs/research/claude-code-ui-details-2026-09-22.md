# Claude Code detailed UI observations

This report answers two questions for the Pi Stuff conversation UI: what happens after `Esc`, and whether a separate collapse/expand marker is needed. The [capture gallery](../../prototypes/ui-session/detail-reference/README.md) contains the corresponding images, text captures, compressed ANSI streams and fixture exchanges. [简体中文](../i18n/zh-CN/research/claude-code-ui-details-2026-09-22.md)

## Scope and method

The installed official Claude Code release was `2.1.261`, binary SHA256 `4ae40dd1784e85753e742e09f267d29ecbb82890361ad3817d27560866d364a6`. I ran eight deterministic local fixtures in both classic and fullscreen modes, for sixteen fresh Terminal Control PTYs at 100 x 40 cells. Each completed case was captured before and after `Ctrl+O`. The running case also captured the live frame and the frame after pressing `Esc`.

The client executed real local `Bash`, `Read` and `Edit` calls in temporary projects. A localhost Anthropic-compatible SSE fixture supplied tool-use blocks and the final `PROBE_COMPLETE` text. This isolates the renderer and tool execution path. It does not prove live model selection, account behavior, or every tool integration. No user credentials, host settings or project files were used.

## 1. Esc interruption should retain native Pi behavior

The [active classic frame](../../prototypes/ui-session/detail-reference/running-classic-100/running.png) shows the ordinary tool header, one `⎿` child connector before live output, elapsed output and `esc to interrupt` in the footer. After `Esc`, Claude Code leaves the tool in place and replaces the live child content with the [native interruption frame](../../prototypes/ui-session/detail-reference/running-classic-100/cancelled.png):

```text
⎿  Interrupted · What should Claude do instead?
```

The active spinner and token counter disappear. The interruption is attached to the tool result; it is not presented as a separate assistant error message. In fullscreen mode, the activity count remains visible. The interruption child is visible in both the compact cancelled frame and the detailed transcript.

The Pi Stuff decision should therefore be simple: keep Pi's native `Esc` interruption style unchanged. The tool display should not add a new failure card, transform the interruption into an assistant error, or replace the existing native copy. The captured Claude behavior is useful as evidence about where an interruption belongs, but it does not authorize changing the user's explicit native-Pi requirement.

## 2. Permanent expand/collapse text is unnecessary

The current prototype appends ` · expand` and ` · collapse`. I recommend removing the permanent ` · collapse` suffix, and replacing the generic ` · expand` suffix with a conditional hidden-content summary such as `… +5 lines`. A short click hint can accompany that summary if discoverability needs it. Expanded content already shows its state; short results with nothing hidden need no hint.

The [classic multiline capture](../../prototypes/ui-session/detail-reference/multiline-classic-100/compact.png) shows `… +5 lines (ctrl+o to expand)`. Short results have no equivalent suffix. Fullscreen uses activity counts and a global detailed-transcript view. Its keyboard interaction is not a test of Pi's per-tool mouse behavior.

Keep the existing clickable tool area and put general keyboard instructions in help. Thoughts already distinguishes `• Thoughts for 4s` from `• Thoughts: ...`; neither needs a permanent action suffix. These are recommendations, not applied changes in this revision.

`⎿` remains a result connector, separate from disclosure. The [two-result capture](../../prototypes/ui-session/detail-reference/two-classic-100/compact.png) has one connector per result, while continuation lines align with the result text.

## 3. What the fresh captures show

### Classic and fullscreen use different density budgets

Classic keeps ordinary Bash and Edit calls visible; read-only retrieval can still aggregate. Fullscreen compact mode collapses completed activity into summaries such as `Ran 2 shell commands`, `Read 2 files`, and `Thought for 1s, read 2 files`. Ctrl+O switches to a detailed transcript and restores the original order. This is a global transcript mode in Claude Code, whereas Pi Stuff can keep its existing per-tool mouse expansion and `Ctrl+O` tool behavior.

### The hidden-lines hint is conditional

The [classic multiline Bash result](../../prototypes/ui-session/detail-reference/multiline-classic-100/compact.png) displays three preview lines followed by `… +5 lines (ctrl+o to expand)`. A two-line result has no hint because nothing is hidden. Empty output stays explicit as `(No output)`. A failed command keeps `Error: Exit code 3` and stderr under one connector. The hint belongs to the hidden-content case, not to every tool invocation. Fullscreen's failed compact capture hides the error behind `Ran 1 shell command`; that is an observed density rule, and Pi should not adopt it because failures must remain visible.

### Edit uses a result-first diff preview

The [Edit fixture](../../prototypes/ui-session/detail-reference/edit-classic-100/compact.png) shows `Update(a.txt)`, then `Added 3 lines, removed 2 lines`, then the colored changed rows. The diff rows do not repeat `⎿`. The detailed view restores the preceding Read call while preserving the same Update result structure and a context line. The useful design cue for Pi is to keep the operation header, result summary and contextual diff as one visual block, with the connector starting the result only once. Pi's current changes-only preview should consider retaining a small context budget, such as the unchanged `gamma` row shown here.

### Running tools can lead with an action description

The [fullscreen running frame](../../prototypes/ui-session/detail-reference/running-fullscreen-100/running.png) uses `Inspecting controlled terminal output` as its title and places the exact command below it. Pi could use an existing meaningful tool description while running, with the command available underneath. This proposal does not require generating an extra description or changing completed tool names.

### Thinking is a separate activity line

The [compact summary](../../prototypes/ui-session/detail-reference/thought-classic-100/compact.png) reads `Thought for 1s, read 2 files`. In the [detailed classic view](../../prototypes/ui-session/detail-reference/thought-classic-100/expanded.png), the thinking content appears as a muted standalone line with a light `∴` prefix between the two Read calls. It is not nested under a tool result and does not receive a `⎿`. Pi's chosen `Thoughts:` prefix can keep this semantic separation while following the Pi setting for hidden or visible thinking.

## Design changes supported by this evidence

For the current Pi Stuff prototype, the evidence supports four narrow changes:

- preserve native Pi abort and interruption rendering;
- remove permanent ` · collapse` text and replace generic ` · expand` with a conditional hidden-content summary;
- retain a conditional hidden-content hint on summaries, while keeping expanded rows quiet;
- preserve one result connector per visible child result and keep Thoughts outside tool-result indentation.

The captures do not justify copying Claude Code's fullscreen mode, global transcript footer, model statusline, or interruption wording into Pi Stuff. Those are client-specific surfaces. The useful transferable ideas are the conditional hint, the separation between connector and disclosure, the result-first diff block, and the density switch between summary and detail.
