---
version: alpha
name: Pi Stuff
description: Conversation-first terminal capabilities that remain inside the native Pi Host.
omitted:
  - section: colors
    reason: Pi Host semantic theme tokens are normative; Pi Stuff has no fixed CSS or ANSI palette.
  - section: typography
    reason: The Host and terminal own the font family, size, and cell metrics.
  - section: rounded
    reason: Terminal surfaces use character-cell geometry and do not use rounded corners.
  - section: components
    reason: The current component token schema is CSS-shaped and cannot describe Pi TUI behavior faithfully.
spacing:
  dialog-gutter-cells: 2
  section-icon-cells: 1
  internal-divider-cells: 1
---

# Pi Stuff Design System

## Overview

**Creative north star: “The Quiet Terminal Workbench.”**

Pi Stuff is a set of working surfaces inside Pi, not a second terminal application. The conversation remains the
place where work happens. Temporary surfaces appear only when the user asks to inspect or control something, preserve
the surrounding Host, and disappear without leaving duplicate state behind.

Claude Code is the primary reference for readable hierarchy, restrained density, and visible lifecycle. Pi remains
the authority for interaction grammar, focus, theme, editor ownership, and terminal behavior. Reproduce the useful
reading order and operational calm; do not copy Claude-specific colors, labels, paths, or shell structure.

The interface should feel dense enough for daily engineering work but never cryptic. A user should first see the
identity or outcome they came for, then status and metadata, then bounded detail. Internal protocol concepts appear
only when they help the user act or when an explicit raw/debug view is opened.

## Colors

Color comes only from the active Pi theme. Use semantic roles such as text, muted, dim, border, accent, success,
warning, and error; never hard-code an ANSI palette or choose values for one personal theme.

Accent identifies focus or the one active interaction. Routine information stays in ordinary or muted text. Success,
warning, and error colors reinforce explicit icons and words; color is never the only evidence of state. Every visible
surface must remain legible in both light and dark Host themes.

## Typography

The terminal owns type. Pi Stuff does not prescribe a font, font size, or weight scale beyond capabilities exposed by
the Host.

Create hierarchy with concise wording, bold only where identity or a primary heading needs it, semantic color, blank
rows, and stable alignment. Agent names, Tool Activity summaries, task identities, and the current Context usage are
stronger than section labels and metadata. Avoid decorative capitalization and dense runs of equally emphasized text.

All measurements and truncation operate on visible terminal cells, not JavaScript string length. CJK, emoji, ANSI
sequences, and wrapped continuation lines must retain correct alignment.

## Layout

The conversation document is primary. Focused Capability surfaces are full-width, non-floating Command Dialogs that
temporarily replace the editor region while leaving the conversation visible. Settings use Pi's native SettingsList.
Normal-screen Todo and Agent roster rows occupy only their owned space and collapse to zero height when absent.

Command Dialogs use a two-cell outer content gutter. Within that gutter, headings, body copy, Agent messages, Tool
rows, result previews, and wrapped lines share one content edge. Do not create another indentation level for every
section or event.

When peer items are inspected in one Dialog, keep the outer geometry stable so selection does not move the editor and
surrounding conversation. Long content scrolls inside the content window. At low height, preserve the Header, current
selection or first important detail, attached error, and Escape route before secondary counts, descriptions, hints,
or surrounding rows.

At narrow widths, remove information in this order: decorative wording, counts and ages, optional descriptions,
targets and previews, then secondary metadata. Preserve primary identity, useful summary, lifecycle state, selected
action, and the way back. Wrapping must not introduce extra indentation or repeat a section icon on continuation
lines.

A wide split view remains one Dialog surface. Its top structural rule is continuous across the full width; one internal
vertical divider separates navigation from detail. It must not look like two adjacent cards. Collapse to a single
column before either side becomes unreadable. Show pane focus by applying the semantic accent to the active pane
heading, not by adding a second one-row vertical rail beside it.

## Elevation & Depth

Pi Stuff is flat. It has no shadows, blur, floating cards, or decorative layers. Depth comes from ownership and
sequence: conversation, temporary focused surface, selected row, then detail.

Use one structural divider, restrained spacing, semantic contrast, and section icons to express that hierarchy.
Do not surround each section with another frame. The scrollable Welcome identity card is the sole confirmed bordered
exception because it belongs to the conversation document rather than the temporary Dialog system.

## Shapes

The shape language is terminal-native and rectilinear. Structural Dialog rules use heavy box-drawing characters; a
wide split uses a heavy internal divider beneath one continuous top rule. A small `◆` identifies section headings. It
appears only on the heading row and never represents lifecycle state, focus, or a Transcript event.

`›` means the currently focused selectable row and nothing else. Lifecycle and severity use separate one-cell-safe
icons. The Conversation Transcript's small `•` marker is already established and does not define Dialog iconography.

Use icon families consistently: `●` for active work, `○` for queued or inactive work, `◐` for a transition such as
stopping, `↻` for resuming, `✓` for success, `!` for attention, `×` for failure, and `■` for a stopped or deliberately
disabled state. A compact list may omit the state word; a detail Header keeps the complete word.

## Components

### Command Dialog

One full-width top rule introduces the surface. The Header answers the surface's primary question before presenting
metadata. Escape returns exactly one level and eventually restores the captured editor draft, Footer, working row,
Todo, and Agent roster.

### Lists

Rows keep a stable domain order unless the owning ADR says otherwise. Live updates change rows in place and do not
steal focus. A row begins with optional `›`, then its primary identity or readable summary, with lifecycle icon and
low-priority timing or counts later. Overflow uses `… N earlier/newer` and `… N later/older` around a focused window.

Up and Down move one row. PageUp and PageDown move one visible page; Shift+Up and Shift+Down are equivalent aliases for
compact keyboards. Show page hints only when overflow exists.

### Detail sections

Use a `◆` heading such as `◆ Task`, `◆ Activity`, `◆ Output`, or `◆ Details`. Section sets are specific to the
job: `/agents` is organized around Agent identity, Task, optional outcome, and Activity; `/ctx` begins with Context
usage; `/diagnostics` begins with the problem; `/tools` begins with a readable Tool Activity. Do not force every
Dialog into the same field template.

Keep complete relevant event order but bound each expensive preview. Say how much was omitted. Raw identifiers,
arguments, and protocol content belong behind an explicit raw/debug action rather than in the default reading path.

### Wide list/detail inspection

At wide terminal widths, a Dialog may show its list and selected detail together when users repeatedly compare peer
items. This applies to `/tools`, `/tasks`, `/diagnostics`, and bare `/btw` history. Each remains one Dialog with one
continuous heavy top rule, one heavy internal divider, and stable outer geometry while selection changes. The active
pane heading carries the focus accent; do not reuse `◆`, `›`, or a short `│` as a pane-focus marker.

`/tools` keeps its accepted fixed 18-row geometry. `/tasks` embeds Shell and Monitor detail but sends an Agent row to
the single-column `/agents` surface. Bare `/btw` may split history from a settled answer, while `/btw <question>` and a
streaming answer remain single-column. `/agents`, `/ctx`, `/mcp`, and `/rtk` remain single-column at every width. Every
split collapses to the existing sequential list/detail flow before either pane becomes unreadable.

### Persistent and transcript surfaces

Todo, Agent roster, Statusline, Conversation Transcript, and Command Dialogs have different jobs. A state has one
visible authority; do not repeat it in a permanent dashboard. Transcript projection remains compact and chronological,
while Command Dialogs provide inspection and control. A Dialog redesign does not silently change transcript markers
or Tool rendering.

## Do's and Don'ts

### Do

- **Do** lead with what the user recognizes: Agent name, work identity, Tool Activity summary, problem, or Context use.
- **Do** keep focus, ordering, scroll position, and outer geometry stable across live updates.
- **Do** pair state color with a fixed icon, and retain the full state word where detail or risk requires it.
- **Do** preserve PageUp/PageDown and provide Shift+Up/Down as the compact-keyboard page equivalent.
- **Do** verify accepted surfaces in the real Pi Host at wide, narrow, and low terminal geometries, in light and dark
  themes; the native terminal is the final visual authority.
- **Do** keep content ownership and safety boundaries unchanged when presentation changes.

### Don't

- **Don't** create another CLI, TUI shell, floating modal system, or permanent Package dashboard.
- **Don't** hard-code colors, fonts, or a personal terminal theme.
- **Don't** make two columns look like two separate Dialogs; keep one continuous structural surface.
- **Don't** frame individual sections or add nested indentation to simulate hierarchy.
- **Don't** reuse `›` or the Transcript's `•` as lifecycle state, and don't use one universal circle for every state.
- **Don't** duplicate Todo, Agent, BTW, Permission, Tool, or diagnostic state outside its owning surface.
- **Don't** copy Claude-specific presentation when it conflicts with Pi's native behavior or Pi Stuff's domain terms.
