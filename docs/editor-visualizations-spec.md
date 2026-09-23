# Retro highlighting and fenced visualizations

[简体中文](i18n/zh-CN/editor-visualizations-spec.md) · English is normative.

Status: design interview in progress. [Issue #119](https://github.com/jczhang02/pi-stuff/issues/119) tracks delivery. Production implementation awaits explicit shared-understanding confirmation.

## Confirmed behavior

### Retro highlighting

Use option B from the palette comparison: the static, bold retro gradient in pi-stuff-old commit `e61ed27e`, `packages/pi-stuff/src/conversation-ui/retro-text.ts`. Its nine RGB stops run through blue, violet, pink and warm yellow, then return to blue. Preserve that algorithm, including short strings whose endpoint colors coincide; do not substitute the old main branch's ANSI rainbow or animate it.

Apply highlighting across the editor, user messages, assistant replies and tool output. The accepted surface scope does not yet settle exclusions within those surfaces, third-party renderers or Thinking.

Recognize complete `/skill:<name>` text and configured keywords. A textual skill reference does not require an installed skill and highlighting does not invoke it. Preserve the editor draft, submitted text, stored messages and provider context.

Keywords are case-sensitive literal text, without regular expressions. Match whole English words and continuous Chinese substrings. The default list is empty. Exact boundaries around identifiers, hyphens, paths and mixed-language text, plus overlap precedence, remain open.

Use the existing global `pi-stuff.json`, with no project override. Provide a settings-panel switch; edit the keyword list in the file and apply file changes with `/reload`. Additional panel editing was not requested. Switch defaults, runtime application and error behavior remain to be finalized.

### Chart and tree display

Preserve pi-stuff-old's observable syntax, supported types and limits. Project complete valid `chart` and `tree` Markdown fences in user messages and assistant prose, including restored history. Keep Markdown source visible in the editor. Do not project Thinking or tool output.

- Charts support bar (including the histogram alias), line, scatter, sparkline and heatmap.
- Trees have one root, two spaces per level, and reject tabs, odd indentation, blank nodes, depth jumps and additional roots. Preserve full labels rather than truncating them.
- A visualization source is limited to 12,000 characters. A message projects at most 16 blocks. Ordinary charts allow up to 64 points, heatmaps up to 32 rows by 64 columns, and trees up to 256 nodes and depth 32.
- Charts need at least 24 content cells and use at most 80. Account separately for the host's indentation and surrounding markers. If a tree row cannot fit, retain the source block.
- Incomplete, malformed, unsafe, nested, oversized and too-narrow input retains ordinary fenced-code display. Closing a valid streamed fence can enable projection.
- Rendering is display-only. Preserve canonical messages, session records, copy/export source and provider context. Do not add chart/tree format instructions to model requests.

The reference behavior is documented in pi-stuff-old ADR 0017, `fenced-visualization.ts`, `unicode-chart.ts` and `indentation-tree.ts` at old-main revision `21b636ea`. This accepts behavior, not automatic reuse of its loader or host patches.

## Outstanding decisions

1. Whether rainbow styling excludes inline/fenced code, diffs, link destinations, semantic status/error text and Thinking.
2. The definition of an English word at identifier, path and mixed-language boundaries.
3. Matching precedence for overlapping keywords and skill references; whether a match restarts its gradient and retains that phase across wrapping.
4. Default switch state, whether the switch controls both skill and keyword highlighting, and when panel changes take effect.
5. Whether tool-output highlighting may alter third-party custom rendering, and how to preserve their own visual semantics.

These are unanswered decisions, not implementation defaults.

## Integration and acceptance

The baseline main revision is `94707f5`. Conversation UI work in #106 and statusline work in #117 have separate owners. Coordinate shared UI/configuration/Markdown boundaries before implementation; do not edit those owners' worktrees. Resolve integration order when their current state is known.

Prefer existing host editor and Markdown APIs. Keep one owner for Markdown projection. The requested retro text is a scoped exception to ordinary semantic theme colors; update the paired design rules when the exception's boundaries are agreed. No new dependency is authorized by this specification.

Chart algorithms derive from `@howaboua/pi-unicode-charts` 0.1.0, commit `8d63d300597488e6fa4c30ccd6a3eb0fed2d4304`, under MIT. Preserve source/license notices and record provenance in implementation evidence. The retro source cites pi-footer `1b83749f`, `src/ui/title-bar.ts`; verify and retain applicable notices before importing it. Do not add an `UPSTREAM.md` file.

Before delivery, finish this interview and obtain shared-understanding confirmation. Then verify accepted matching examples, input/cursor/completion behavior, source preservation, streamed and restored messages, visualization fallbacks, Unicode widths, dark/light themes and coexistence with other UI features. Record supported-host terminal evidence and ordinary-path performance; an attractive palette preview is not product acceptance. Required independent review, checks and merge authorization follow the repository workflow.
