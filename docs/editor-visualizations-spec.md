# Editor highlighting, fenced visualizations and skill-message display

[简体中文](i18n/zh-CN/editor-visualizations-spec.md) · English is normative.

Status: all four interview topics are settled: editor highlighting, chart/tree, native skill triggering and unified skill-message display. [Issue #119](https://github.com/jczhang02/pi-stuff/issues/119) tracks delivery. The maintainer confirmed implementation through the implement skill in a new worktree.

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

Display the full `/skill:<name>` label and an ordinary prompt together in one user-message card, preserving normal colors, background, spacing and Markdown rendering. A prompt beginning with a list, quote or code block starts below the label to preserve its structure.

Skill instructions are collapsed by default. Use the native expansion operation to show them after the prompt within the same card, without duplicating the prompt. A skill-only invocation shows the label alone and still supports instruction expansion. Apply the same presentation to restored history. Preserve canonical session records and model input.

The maintainer confirmed these display rules. The old implementation is a behavioral reference, not approval to import its rainbow user-message styling or private host patches.

## Ordered interview

1. Editor-only coloring is confirmed: text matching rather than invocation, regex entries with expression-defined boundaries, case-insensitive defaults with per-rule overrides, and invalid-entry isolation. Preserve input responsiveness when evaluating user patterns; implementation details require verification, not additional product exceptions.
2. Chart/tree is confirmed against the full compatibility contract above, including user-message projection without retro recoloring.
3. Native skill triggering is confirmed unchanged.
4. Unified skill/prompt display is confirmed: one normally colored card, native instruction expansion within that card, label-only skill invocations and the same presentation for restored history.

All four topics and implementation are authorized. The agreed test seams are editor rendering/configuration, fenced Markdown projection and skill-message composition/expansion, plus actual-host acceptance. Independent review compares against main `1369773`.

## Integration and acceptance

The implementation baseline is main `1369773`, including merged statusline #117. Conversation UI #106 / PR #107 remains separately owned and unmerged. This branch has one Markdown transformer owner. Pi stores only one transformer per extension, so the later integration of #107 must share that owner with its assistant/tool adapters and this branch's skill adapter; registering two owners would disable one side. Combined #107 behavior is not verified by this delivery. No other owner's worktree was changed.

Prefer existing host editor and Markdown APIs. Keep one owner for Markdown projection. The requested editor retro text is a scoped exception to ordinary semantic theme colors; update the paired design rules when the exception's boundaries are agreed. No new dependency is authorized by this specification.

Chart algorithms derive from `@howaboua/pi-unicode-charts` 0.1.0, commit `8d63d300597488e6fa4c30ccd6a3eb0fed2d4304`, under MIT. Preserve source/license notices and record provenance in implementation evidence. The retro source cites pi-footer `1b83749f`, `src/ui/title-bar.ts`; verify and retain applicable notices before importing it. Do not add an `UPSTREAM.md` file.

Before delivery, verify accepted matching examples, input/cursor/completion behavior, source preservation, streamed and restored messages, visualization fallbacks, Unicode widths, dark/light themes and coexistence with other UI features. Record supported-host terminal evidence and ordinary-path performance; an attractive palette preview is not product acceptance. Required independent review, checks and merge authorization follow the repository workflow.

## Configuration and operation

`/editor` opens the native settings list. The single switch applies immediately after a successful save. Keywords are regular-expression source strings in the global configuration; JSON escaping still applies:

```json
{
  "editor": {
    "enabled": true,
    "keywords": [
      {"pattern": "review"},
      {"pattern": "\\bFIXME\\b", "caseSensitive": true}
    ]
  }
}
```

Reload after file edits. Invalid regex entries are reported by their one-based position and skipped. Regex matching runs in a private worker so pathological expressions cannot block input. A request exceeding 200 ms after worker startup falls back to skill-only highlighting for that draft; subsequent edits retain only the latest draft. After termination completes, the latest draft queued by subsequent edits runs after a 1-second cooldown, doubling on repeated failures up to 30 seconds. A failed draft is not retried without another edit. A successful match resets the delay. Reload or shutdown cancels pending recovery. This is a responsiveness safeguard, not a different matching grammar.

Chart/tree and skill-message composition remain enabled independently of the editor switch. Native skill expansion is unchanged. Click the skill card's first content row or use Pi's configured expansion binding to inspect instructions.

The implementation uses the native editor factory and Markdown transformer, with narrow display adapters for editor layout, visualization fence decoration and skill insertion. Each adapter retains native storage and execution and restores its wrapper on reload/quit only if it still owns the method. The worker has no runtime package imports because the compiled host does not inherit the extension loader's package resolution.

Palette provenance: [pi-footer 1b83749f](https://github.com/wobondar/pi-footer/tree/1b83749f), MIT, copyright 2026 wobondar; notice retained in `src/editor/LICENSE-pi-footer.txt`. Chart notice is retained in `src/visualizations/LICENSE-Howaboua.txt`. Parser and tree behavior were adapted from pi-stuff-old `21b636ea`, MIT, copyright 2026 JC Zhang.

## Implementation evidence

Production code at `15f3b62` passed separate read-only Standards and Spec reviews against `1369773`. Reviewer contexts were `implementation_standards` and `implementation_spec`, children of owner `codex:01a0cc15-4b69-7610-8c2f-351db6a5f4e6`. Both applied the mandatory thermo-nuclear review skill. Findings about chart wrapping/root loss, the native editor working indicator and Markdown skill-label placement were fixed and independently rechecked. No structural findings remain.

Terminal Control exercised seven real-host scenarios on compiled Pi 0.85.1, 0.86.1 and 0.87.1, each with 7 passes and 0 failures. They cover saved settings/reload, invalid and pathological regex, cursor editing, native skill expansion and history, normal transcript colors, user/assistant visualizations, narrow layout, transition from an incomplete streamed chart to the completed graphic, and unchanged session source. The save test originally read the file before the asynchronous save completed; it now waits for the persisted value. Commands use `PI_TEST_HOST=<compiled-pi> bun test tests/system/editor-visualizations.test.ts`.

These captures come from the actual compiled 0.87.1 host, replayed by Terminal Control with the design font stack. The editor captures use 100 by 30 cells and explicit black/white terminal defaults for dark/light; the chart capture uses 60 by 30. They are headless terminal captures, not photographs of a desktop terminal.

- [Dark editor and submitted skill card](assets/editor-visualizations/editor-dark.png)
- [Light editor and submitted skill card](assets/editor-visualizations/editor-light.png)
- [Assistant tree and sparkline at 60 columns](assets/editor-visualizations/visualizations.png)

A local Bun 1.4.0 benchmark used the real CustomEditor with inert terminal I/O, a 261-character draft, 100-column render, 100 warmups and seven batches of 1,000 renders. Median per-render time was 0.026 ms native and 0.056 ms with cached regex highlighting, about 0.030 ms added. This measures the ordinary render path, not end-to-end key latency or worst-case pattern cost; the pathological-regex host test separately verifies input responsiveness.

No dependency was added. Reverting the implementation restores native rendering. Remove the new `editor` section from configuration before loading older strict-schema releases; canonical sessions require no migration.

The follow-up [real-host performance report](editor-performance.md) covers input, color completion, message display, RSS snapshots and pathological-regex CPU. It confirms long-draft latency and CPU cost during pathological-regex editing; the early microbenchmark does not establish an absence of performance problems.

The performance repair against `7c35b91` passed 269 offline tests across 47 files (1,701 assertions), plus the seven focused E2E scenarios on each compiled Pi 0.85.1, 0.86.1 and 0.87.1 (28 assertions each). New coverage checks visible Unicode palette bounds, native editor scrolling, keyword recovery after a timeout and closing during cooldown. Static checks and diff checks passed. The same separate Standards/Spec reviewers rechecked the full repair diff; lifecycle verification and documentation findings were resolved, including one median-rounding correction. No review findings remain. The updated performance report retains before/after raw measurements and the remaining observation limits.
