---
status: accepted
---

# Project chart and tree fences inside Conversation Markdown

Pi Stuff will recognize complete `chart` and `tree` fenced code blocks at the existing Conversation Markdown
projection seam. It will replace valid blocks with width-bounded terminal text for display while leaving the
canonical User or Assistant message, Session records, copy/export source, and Provider context unchanged. Thinking
remains under Live Thoughts and never enters this visualization path.

The dispatcher is static and internal to Conversation UI. It runs inside the Module’s one registered Host Markdown
transformer; there is no second transformer, plugin registry, setting, Capability, Package, or runtime dependency.
Assistant candidate recognition is fused into the existing chunk-preserving sanitizer traversal; User Markdown uses an exact opening-fence
prefilter. Ordinary messages never enter visualization parsing. A matched block is projected only when its
closing fence, grammar, safety checks, limits, and available terminal width all succeed. At most 16 valid blocks are
projected per Markdown message. Otherwise the original fence is returned byte-for-byte.

`chart` accepts `bar`/`histogram`, `line`, `scatter`, `sparkline`, and `heatmap`. Its adapted MIT implementation is
pinned and recorded beside the source. Input is capped at 12,000 characters and 64 ordinary points; heatmaps are
capped at 32 rows by 64 columns. Charts require at least 24 content cells and use at most 80; the Host code indent
requires two additional available cells. `tree` accepts exactly one root and two spaces per level, rejects tabs, odd
indentation, depth jumps, blanks, and multiple roots, and is
capped at 12,000 characters, 256 nodes, and 32 levels. Tree labels are never truncated: if one output row does not
fit, the source fence remains visible.

The projection emits one internal Markdown code block per visualization rather than one inline node per output row. A
scoped adapter on the existing Markdown Theme replaces only that synthetic block’s opening border with its first
content row and suppresses its closing border, then restores ordinary code-block rendering immediately. This keeps the output
borderless and inert while avoiding ANSI or terminal control sequences in projected content. Pi TUI terminal-column
measurement and grapheme boundaries cover CJK and emoji. Rendering reserves the Host code block’s two-cell content
indent; Assistant projection additionally reserves the existing outer `• ` marker width.

## Rejected alternatives

- A second Markdown transformer would split Conversation display authority and add another full-message pass.
- An independently installed chart Package or runtime dependency would violate the one-Package architecture and add
  startup/import work for a small bounded renderer.
- A generic fenced-block registry, settings, or dynamic plugins would add product and lifecycle surface unsupported by
  the two accepted languages.
- One Markdown code span or hard-break node per output row preserves a borderless appearance, but makes maximum-size
  tree rendering scale poorly in the Host. An ordinary code block is efficient but exposes a visible frame. The scoped
  synthetic-border adapter retains the efficient block token without the frame.
- Provider instructions encouraging chart/tree output would add tokens and latency to every request, including requests
  that never use the feature.
- Rewriting messages before persistence or dispatch would corrupt canonical Session and Provider content for a display
  concern.

## Consequences

- Models and users opt in only by writing an explicit complete fence; no prompt injection is added.
- Invalid, unsafe, unsupported, incomplete, over-limit, and too-narrow input remains ordinary fenced code.
- Ordinary and feature paths are benchmarked separately. The baseline/candidate gate uses interleaved samples, paired
  bootstrap confidence intervals, and an independent confirmation run whenever the paired median-ratio 95% interval
  excludes 1 on the slower side. A repeatable ordinary-path regression blocks delivery.
- Changes to formats, limits, supported chart types, projection ownership, or performance acceptance must update this
  ADR and the Conversation UI documentation together.
