# Editor highlighting, fenced visualizations and skill-message display

[简体中文](i18n/zh-CN/editor-visualizations-spec.md) · English is normative.

Status: design interview restarted in the maintainer's requested order: editor highlighting, chart/tree, native skill triggering, then unified skill-message display. [Issue #119](https://github.com/jczhang02/pi-stuff/issues/119) tracks delivery. Production implementation awaits explicit shared-understanding confirmation.

## Confirmed behavior

### Retro highlighting

Use option B from the palette comparison: the static, bold retro gradient in pi-stuff-old commit `e61ed27e`, `packages/pi-stuff/src/conversation-ui/retro-text.ts`. Its nine RGB stops run through blue, violet, pink and warm yellow, then return to blue. Preserve that algorithm, including short strings whose endpoint colors coincide; do not substitute the old main branch's ANSI rainbow or animate it.

Apply retro highlighting only to the editor draft. Submitted user messages retain their normal colors, including skill labels and instructions. Assistant replies, tool output and Thinking are also outside the highlighting scope. This supersedes every earlier decision to highlight submitted messages; historical-message recoloring is no longer a question.

Match complete skill references and configured keywords without classifying prose, inline code or fenced code. Preserve cursor and selection behavior, surrounding styles, terminal controls, source text and submission semantics. Do not add Markdown-region exceptions.

Recognize complete `/skill:<name>` text and configured keywords. A textual skill reference does not require an installed skill and highlighting does not invoke it. Preserve the editor draft, submitted text, stored messages and provider context.

Every keyword entry is a regular expression, case-insensitive by default, with an optional per-rule case-sensitive override. The default list is empty. The expression alone defines matching boundaries; do not add language-specific whole-word or path exceptions. For example, `review` also matches `Review` and the matching portion of `preview`; use explicit regex boundaries when needed. Regex metacharacters in literal text must be escaped. Complete skill references take precedence over keywords. Resolve keywords left to right, choosing the longest match at the same start. Paint each match once, restart its gradient at its own beginning, and preserve the phase across wrapping.

Use the existing global `pi-stuff.json`, with no project override. Provide a settings-panel switch; edit the keyword list in the file and apply file changes with `/reload`. Additional panel editing was not requested. The switch defaults on, controls both skill and keyword highlighting, and applies and saves panel changes immediately. Disabling highlighting does not disable chart/tree. Retain the existing file/schema error-handling contract. Skip invalid regex entries and report them once per configuration load, while valid rules and the editor continue working.

### Chart and tree display

Preserve pi-stuff-old's observable syntax, supported types and limits. Project complete valid `chart` and `tree` Markdown fences in user messages and assistant prose, including restored history. Keep Markdown source visible in the editor. Do not project Thinking or tool output.

- Charts support bar (including the histogram alias), line, scatter, sparkline and heatmap.
- Trees have one root, two spaces per level, and reject tabs, odd indentation, blank nodes, depth jumps and additional roots. Preserve full labels rather than truncating them.
- A visualization source is limited to 12,000 characters. A message projects at most 16 blocks. Ordinary charts allow up to 64 points, heatmaps up to 32 rows by 64 columns, and trees up to 256 nodes and depth 32.
- Charts need at least 24 content cells and use at most 80. Account separately for the host's indentation and surrounding markers. If a tree row cannot fit, retain the source block.
- Incomplete, malformed, unsafe, nested, oversized and too-narrow input retains ordinary fenced-code display. Closing a valid streamed fence can enable projection.
- Rendering is display-only. Preserve canonical messages, session records, copy/export source and provider context. Do not add chart/tree format instructions to model requests.

The reference behavior is documented in pi-stuff-old ADR 0017, `fenced-visualization.ts`, `unicode-chart.ts` and `indentation-tree.ts` at old-main revision `21b636ea`. This accepts behavior, not automatic reuse of its loader or host patches.

## Native skill triggering

Pi 0.87.1 expands a skill only when the input starts with `/skill:`. Its `_expandSkillCommand` loads a matching skill and appends the user arguments to an internal `<skill>` block. Unknown skills pass through unchanged. The [official skill documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md) describes explicit invocation as a way to ensure skill instructions are loaded, alongside model-directed loading.

The checked documentation does not state why invocation is restricted to the beginning. Separating command syntax from incidental mentions and avoiding multi-skill parsing are reasonable inferences from the implementation, not an attributed maintainer rationale. The maintainer confirmed retaining native skill triggering, expansion and model-directed loading. Do not add invocation at arbitrary positions or multi-skill expansion. Editor highlighting remains independent of invocation.

## Unified skill-message display

The maintainer requests one visible user prompt message for `/skill:name prompt`, as in pi-stuff-old, with normal user-message colors.

Pi 0.87.1 already stores the skill block and prompt in one user message. The interactive renderer splits it into a `SkillInvocationMessageComponent` and, when arguments exist, a `UserMessageComponent`. The request concerns this visible split; it does not require merging two stored records.

Discuss the exact combined label/prompt layout, access to skill instructions, skill-only input and restored history in the fourth interview topic. The old implementation is a behavioral reference, not approval to import its rainbow user-message styling or private host patches.

## Ordered interview

1. Editor-only coloring is confirmed: text matching rather than invocation, regex entries with expression-defined boundaries, case-insensitive defaults with per-rule overrides, and invalid-entry isolation. Preserve input responsiveness when evaluating user patterns; implementation details require verification, not additional product exceptions.
2. Chart/tree is confirmed against the full compatibility contract above, including user-message projection without retro recoloring.
3. Native skill triggering is confirmed unchanged. Continue with unified skill-message display.
4. Define the single visible skill/prompt message using the old display as a reference and normal user-message colors.

Production work still awaits final shared-understanding confirmation after these topics.

## Integration and acceptance

The baseline main revision is `94707f5`. Conversation UI work in #106 and statusline work in #117 have separate owners. Coordinate shared UI/configuration/Markdown boundaries before implementation; do not edit those owners' worktrees. Resolve integration order when their current state is known.

Prefer existing host editor and Markdown APIs. Keep one owner for Markdown projection. The requested editor retro text is a scoped exception to ordinary semantic theme colors; update the paired design rules when the exception's boundaries are agreed. No new dependency is authorized by this specification.

Chart algorithms derive from `@howaboua/pi-unicode-charts` 0.1.0, commit `8d63d300597488e6fa4c30ccd6a3eb0fed2d4304`, under MIT. Preserve source/license notices and record provenance in implementation evidence. The retro source cites pi-footer `1b83749f`, `src/ui/title-bar.ts`; verify and retain applicable notices before importing it. Do not add an `UPSTREAM.md` file.

Before delivery, finish this interview and obtain shared-understanding confirmation. Then verify accepted matching examples, input/cursor/completion behavior, source preservation, streamed and restored messages, visualization fallbacks, Unicode widths, dark/light themes and coexistence with other UI features. Record supported-host terminal evidence and ordinary-path performance; an attractive palette preview is not product acceptance. Required independent review, checks and merge authorization follow the repository workflow.
