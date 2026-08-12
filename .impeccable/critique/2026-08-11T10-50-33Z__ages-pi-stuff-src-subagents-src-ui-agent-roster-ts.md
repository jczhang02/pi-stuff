---
target: Pi Stuff Fleetview and Subagent roster
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-11T10-50-33Z
slug: ages-pi-stuff-src-subagents-src-ui-agent-roster-ts
---
Method: dual-agent (A: fleet_design_review · B: fleet_detector_evidence)

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 3 | Agent state and elapsed time are clear, but several states compete for attention. |
| 2 | Match system / real world | 3 | Agent name, task and state are understandable; `general-purpose` reads like an implementation type. |
| 3 | User control and freedom | 3 | Down, Enter, x and Esc form a complete keyboard path. |
| 4 | Consistency and standards | 3 | The roster follows Pi's footer grammar, but its dedicated blank help row differs from Claude's in-place hint row. |
| 5 | Error prevention | 3 | Roster input is accepted only from an empty, focused editor. |
| 6 | Recognition rather than recall | 2 | The idle help slot is blank, so roster management must be remembered. |
| 7 | Flexibility and efficiency | 3 | Fast keyboard management and `/agents` coexist. |
| 8 | Aesthetic and minimalist design | 2 | Accent marker, warning state, long role and task text produce too many equal-weight anchors. |
| 9 | Error recovery | 2 | Terminal states are visible and dismissible, but recovery detail is deferred to `/agents`. |
| 10 | Help and documentation | 3 | Runtime controls appear in management mode and repository documentation is precise. |
| **Total** | | **27/40** | **Acceptable; functional foundation, visible hierarchy needs refinement.** |

## Design Specificity Verdict

The current Fleetview is authored for Pi Stuff rather than generic dashboard UI: it is conversation-first, non-floating, keyboard-driven and bottommost. Its weakness is not the basic geometry. Genuine Claude Code 2.1.197 evidence and current Pi 0.84.1 PTY evidence both use a two-cell roster inset, filled/open circle hierarchy and one child per line. Pi Stuff feels heavier because it gives routine roster state too much contrast and leaves a Fleet-owned blank help row while idle.

The deterministic Impeccable detector returned `[]` with exit 0. This is not a clean bill of health: the detector targets web markup and has no applicable rules for this terminal TypeScript renderer. Real PTY captures, source measurements and terminal-width tests are the relevant evidence.

## Overall Impression

Fleetview works and is structurally close to Claude Code, but looks like a diagnostic roster rather than quiet ambient presence. The biggest opportunity is to reduce visual weight without adding or removing capability.

## What's Working

- The two-cell inset, fixed marker column and right-aligned state column make rows easy to scan.
- The roster stays below the editor and Statusline, never becomes a floating window, and safely yields to focused dialogs.
- Current tests cover 100-, 64-, 48-, 32- and 24-column width behavior; descriptions disappear before they collide with state.

## Priority Issues

### P1 — The idle blank help row looks accidental

**Why it matters:** Claude changes an existing help row in place. Pi Stuff reserves a blank Fleet-owned line, so the roster appears detached from the prompt and wastes vertical rhythm.

**Fix:** Do not reserve a blank line. While managing Fleetview, temporarily replace an existing footer line with the controls and restore it on exit. Keep the roster height stable through the shared footer contract rather than a Fleet-only spacer.

**Suggested command:** `$impeccable layout`

### P1 — Routine states are too colorful

**Why it matters:** The accent `main` marker and warning-colored `queued` at the far right become two strong focal points. Claude's live roster remains subordinate to the conversation by keeping routine markers and timers neutral.

**Fix:** Accent only the selected row. Keep ordinary running, queued, completed and elapsed information muted; reserve warning/error colors for states that need user attention. Retain state words so color is never the only signal.

**Suggested command:** `$impeccable quieter`

### P2 — Raw Agent types make the roster feel mechanical

**Why it matters:** `general-purpose` is long and generic, while Claude's `explorer` and `reviewer` read as concise roles. The long name crowds the actual task and increases the diagnostic feel.

**Fix:** Render a concise configured display label for each Agent. Keep the full type and prompt in `/agents`; do not invent a second naming system inside Fleetview.

**Suggested command:** `$impeccable clarify`

## Persona Red Flags

- **Alex (power user):** The layout is quick to operate, but the blank idle row spends scarce terminal height and the long generic role slows scanning across several children.
- **Sam (keyboard/accessibility):** Management is not discoverable while idle because its help slot is blank. State words are good; they must remain when colors are quieted.
- **Riley (stress tester):** Five wide or four narrow child rows can dominate a short terminal. Current width handling is safe, but there is no equivalent height budget.

## Minor Observations

- Keep the two-cell left inset. It matches the real Claude roster and is not the source of the ugliness.
- Keep `●` and `○`. The problem is their color hierarchy, not the glyph family.
- The 30-second terminal linger is a lifecycle choice, not a visual defect; there is insufficient Claude evidence to change it.
- Claude's captured roster has only two children, so reducing Pi Stuff's row cap based on that capture would be unsupported.

## Questions to Consider

- Can Fleetview management temporarily own the second footer line, replacing the last-prompt text only while active?
- Should concise Agent labels be solved in Agent configuration rather than by truncating names in the renderer?
- Is an attention state the only circumstance in which a non-selected row should use warning or error color?
