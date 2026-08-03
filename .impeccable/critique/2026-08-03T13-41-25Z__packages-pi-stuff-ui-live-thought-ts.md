---
target: Pi Stuff live Thought projection
total_score: 27
p0_count: 0
p1_count: 2
timestamp: 2026-08-03T13-41-25Z
slug: packages-pi-stuff-ui-live-thought-ts
---
# Live Thought projection critique

> **Maintainer disposition (2026-08-03):** the visual-grammar recommendation in this snapshot was rejected. Keep the accepted `✻ thoughts:` prefix, dim italic styling, and settled final fragment. The accepted findings are limited to the renderer defects: several Thinking blocks are being merged instead of replacing one another during streaming, outer Markdown markers leak into the row, and truncation can begin mid-word. Bead `ps-5cb.7.5.1.3` is authoritative.

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 2 | A live state exists, but several historical phases masquerade as the current phase. |
| 2 | Match system / real world | 2 | Literal Markdown and a mid-word ellipsis read as renderer leakage. |
| 3 | User control and freedom | 3 | Native Thinking controls remain available; the compact projection itself is passive. |
| 4 | Consistency and standards | 3 | One-row, dim italic treatment fits Pi; the `thoughts:` debug-label grammar is weaker than the rest of the Suite. |
| 5 | Error prevention | 3 | Terminal protocols, bidi controls, CJK and emoji width are handled safely; Markdown-block structure is not. |
| 6 | Recognition rather than recall | 3 | The row is identifiable, but the displayed phrase does not reliably identify current work. |
| 7 | Flexibility and efficiency | 3 | It is display-only and responsive, but spends twelve cells before useful content. |
| 8 | Aesthetic and minimalist design | 1 | Four phases and raw `** **` syntax occupy one dominant line. |
| 9 | Error recovery | 3 | Original Thinking is preserved and rendering failures do not mutate session content. |
| 10 | Help and documentation | 4 | README, Welcome hint, unit tests and PTY certification describe the feature. |
| **Total** | | **27/40** | **Acceptable; the projection needs one focused redesign.** |

## Anti-patterns verdict

The screenshot looks like an internal debug stream leaking through a polished TUI, not like intentional Claude-style current-work feedback. The web detector returned zero findings because the target is a TypeScript terminal Markdown transformer rather than HTML/CSS; that result is not evidence of visual correctness. Original-size screenshot inspection and an exact transformer reproduction both confirm the visible `** **`, the `…reating` mid-word cut, and the accumulation of four blank-line-separated bold phrases.

## Overall impression

The one-row, low-contrast shell is good. The content projection inside it is wrong. The largest opportunity is to turn the row from a compressed history dump into one plain current-action phrase.

## What's working

- One row updates in place and never grows the transcript during streaming.
- Grapheme and terminal-column handling protects CJK and emoji, and control-sequence cleaning protects the terminal.
- The transformation is display-only; original Thinking remains available to the session and detailed inspection.

## Priority issues

### P1 — Structural boundaries are destroyed before selection

`sanitizeInline()` collapses blank lines before `Intl.Segmenter` runs. Four bold status blocks without periods therefore become one 179-column sentence. Select the newest semantic block from raw Markdown first, then sanitize its text.

### P1 — Presentation syntax and broken truncation look like a renderer failure

Escaped `**` becomes visible syntax, and tail fitting produces `…reating`. Remove only outer heading/list/emphasis wrappers, preserve the phrase's opening action word, and truncate at the end.

### P2 — The settled row remains heavier than Claude Code's normal transcript

Claude's ideal grammar suppresses completed Thinking outside detailed transcript. The current Pi Host inserts spacing from the raw message before running the transformer, so returning an empty settled string leaves the blank row previously rejected by the maintainer. Do not pretend zero-height hiding is currently available: keep one minimal meaningful phrase until a public Host seam can suppress the entire block and its spacing.

### P2 — Live wording can switch before it becomes readable

Do not replace a readable phrase with a new block containing only a marker or a few characters. Promote a new block only after it contains a meaningful word or closes its structural wrapper; add a bounded stability rule if the Host later provides a safe identity/invalidation seam.

## Evaluated visual grammars

1. `✻ thoughts: Adding failure hypotheses commentary` — explicit but redundant, debug-like, and twelve columns are spent before content.
2. `✻ Thinking · Adding failure hypotheses commentary` — more natural, but still redundant and inaccurate after settlement.
3. `✻ Adding failure hypotheses commentary` — quietest, widest content budget, and reads as current work rather than a data field.

## Recommendation

Adopt the third grammar now:

```text
✻ Adding failure hypotheses commentary
```

Rules: pick the latest semantic Markdown block before flattening whitespace; strip its outer presentation wrapper; preserve its original words; keep the beginning and end-truncate only when necessary; retain Pi's dim italic Thinking style; show one meaningful block in both streaming and settled projections under the current Host constraint. If a future public Host API can suppress the full block at zero height, make settled Thinking disappear from the normal transcript and keep it only in detailed inspection.

## Persona red flags

- **Alex (power user):** the long historical row interrupts scanning between a Tool operation and the answer; the debug label and raw Markdown add no actionable information.
- **Riley (stress tester):** newline-only bold blocks reproduce the bug while all current tests pass because their fixtures contain sentence punctuation. The missing fixture is exactly the screenshot's shape.
- **Sam (accessibility-dependent):** an icon-only final grammar relies on position and native Thinking styling, but it remains literal text in terminal order; no additional color-only meaning should be introduced.

## Minor observations

- `isStreaming` is currently unused; do not add a fake lifecycle difference until the Host can support it without blank-space damage.
- The screenshot width is reproduced exactly at 189 terminal columns: the full row would be 191 columns, so fitting drops the opening `**C` and leaves `…reating`.

## Questions to consider

- What information would be lost by removing `thoughts:` that is not already conveyed by the glyph, position, color and italics?
- Should settled Thinking remain visible only because of a Host limitation, and be explicitly marked as a compatibility compromise rather than a desired product behavior?

Questions skipped: the defect and the best feasible grammar are narrow and supported by deterministic evidence; no product choice is required before recording the recommendation.
