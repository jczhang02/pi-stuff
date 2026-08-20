# Command Dialog keybindings research

**Date:** 2026-08-18  
**Status:** Accepted and implemented on 2026-08-18

## Question

What keyboard grammar should Pi Stuff Command Dialogs use so that they remain consistent with Pi, resemble the useful
parts of Claude Code, work on compact keyboards, and survive ordinary terminal and tmux input handling?

## Primary-source findings

### Pi is the Host contract

- Pi's standard selection actions are Up/Down, PageUp/PageDown, Enter, and Escape/Ctrl+C. All are configurable through
  the injected `KeybindingsManager` and `~/.pi/agent/keybindings.json`.
  [Pi keybindings](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/keybindings.md#tui-clipboard-and-selection)
- Pi explicitly tells Extension components to use the injected keybinding manager and `keyHint()`/`keyText()` rather
  than hard-coded key labels.
  [Pi Extension keybinding hints](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#keybinding-hints)
- Pi routes unmodified PageUp/PageDown to the transcript in fullscreen mode, but a focused custom component receives
  its own input. The active focus must therefore determine the action.
  [Pi fullscreen viewport bindings](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/keybindings.md#tui-fullscreen-viewport)

### Claude Code uses context-specific actions

- Generic selection uses Up/Down, `K`/`J`, or Ctrl+P/Ctrl+N; Enter accepts and Escape cancels.
- Its diff dialog uses Escape as “detail to list, then close,” Enter to inspect, and pager-style navigation in detail.
- Tab/Right and Shift+Tab/Left move between tabs. Settings use `/` search, Enter/Space change, and Escape close.
- Claude Code removed a permission-dialog Ctrl+D binding because it shadowed the global exit action. This is direct
  evidence against making Ctrl+D a default paging key in an Agent CLI.
- Its keybindings are divided into contexts such as Select, DiffDialog, Settings, Tabs, Help, and Scroll rather than
  assigning one meaning to a key everywhere.

Source: [Claude Code keybinding contexts and actions](https://code.claude.com/docs/en/keybindings).

### Established TUI and pager conventions

- Lazygit uses Up/Down plus `k`/`j` for rows, Tab for panel movement, PageUp/PageDown plus `K`/`J` or Ctrl+U/Ctrl+D
  for main-view paging, `?` for the option menu, and Escape to return.
  [Lazygit default keybindings](https://github.com/jesseduffield/lazygit/blob/master/docs/Config.md#keybindings)
- K9s uses `?` for contextual help and Escape to leave a view, command, or filter.
  [K9s keybindings](https://github.com/derailed/k9s/blob/master/README.md#key-bindings)
- The traditional `less` pager uses Space for the next window and `b` for the previous window. These are plain text
  keys and do not require dedicated navigation keys.
  [OpenBSD less manual](https://man.openbsd.org/less#COMMANDS)

### Terminal compatibility

- tmux documents that modified function keys vary between terminals and are among the combinations that cause the
  most trouble. Shift+Arrow normally uses an xterm-style sequence, but successful delivery depends on terminal and
  multiplexer agreement.
  [tmux modifier keys](https://github.com/tmux/tmux/wiki/Modifier-Keys#modifiers-and-function-keys)
- The Kitty keyboard protocol exists because legacy terminal input has ambiguous encodings and incomplete modifier
  support. Applications cannot assume every user's terminal has opted into an extended protocol.
  [Kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/)
- Plain letters and Space use ordinary text bytes. They are a safer compact-keyboard fallback than modified arrows,
  Alt combinations, or Ctrl+number shortcuts.

## Gap found before implementation

The shared Command Dialog paging helper currently matches raw PageUp/PageDown and Shift+Up/Down sequences. Custom
Dialogs also hard-code most standard selection keys and hard-code their Footer labels even though
`CommandDialogViewContext` already provides Pi's `KeybindingsManager`. This creates three problems:

1. user-rebound Pi selection keys do not consistently apply;
2. Shift+Up/Down is presented as the compact-keyboard paging route despite weaker terminal compatibility;
3. accepted keys and visible Footer hints can drift, as already seen in informational and Settings dialogs.

## Accepted grammar

### Shared principles

1. **Use actions by focus context:** list, detail/scroll, input, panes/tabs, settings, and confirmation.
2. **Honor Pi first:** standard list actions must go through the injected keybinding manager.
3. **Use compact aliases only in read-only navigation:** Ctrl+P/Ctrl+N for one row or line; `b`/Space for one page.
4. **Escape unwinds exactly one level:** raw to formatted, detail to list, nested list to parent, then close.
5. **`?` opens contextual key help** in custom inspection dialogs; Escape returns to the prior screen.

### Default key map

| Context | Previous / next | Previous / next page | First / last | Open or apply | Return |
| --- | --- | --- | --- | --- | --- |
| Custom list | Up/Down, Ctrl+P/Ctrl+N | PageUp/PageDown, `b`/Space | Home/End | Enter | Escape |
| Read-only detail | Up/Down, Ctrl+P/Ctrl+N | PageUp/PageDown, `b`/Space | Home/End | context action only | Escape |
| Split pane | current pane's keys | current pane's keys | current pane's keys | Enter focuses detail | Tab/Shift+Tab switches pane |
| Text input | Pi editor bindings | Pi editor bindings | Pi editor bindings | Enter submits | Escape cancels input |
| Settings | Pi `SettingsList` bindings | Pi `SettingsList` bindings | Pi `SettingsList` bindings | Enter/Space changes | Escape closes |
| Confirmation | Pi selection bindings | — | — | Enter confirms, Space toggles | Escape cancels |

`b`/Space must not be intercepted in text input, Settings, or confirmation contexts. Ctrl+U/Ctrl+D must not be default
Dialog paging keys because they already mean editor deletion and application exit in the Host family. Shift+Up/Down
must stop being the advertised paging path; this branch has not shipped, so no compatibility period is needed.

### Per-Dialog application

- **Agents:** single-column list and detail. Keep lifecycle actions (`s`, `r`, `x`, `n`) contextual.
- **Tasks and Tools:** wide split pane; Tab/Shift+Tab changes focus, Enter moves list to detail, Escape returns to list.
- **Diagnostics:** single-column list and detail; `c` remains list-only.
- **BTW:** answer/history navigation remains its own Claude-derived context; pager aliases apply only while reading.
- **MCP, RTK, and other informational Dialogs:** use pager keys plus Escape. Remove hidden Enter/Space/`q` close behavior unless
  the Footer explicitly presents it and the surface is truly a confirmation.
- **Native Settings surfaces:** do not add letter navigation or `?` interception; preserve Pi's type-to-search behavior.

## Footer and help

The Footer should show only the essential current-context actions and derive configured keys from Pi:

```text
List:    ↑/↓ select · Enter details · ? keys · Esc close
Detail:  ↑/↓ scroll · PgUp/PgDn page · ? keys · Esc back
Split:   ↑/↓ select · Tab pane · Enter details · ? keys · Esc close
```

The `?` screen carries aliases and contextual actions, so narrow Footers do not need to enumerate every accepted key.
At narrow widths, keep only `↑↓ · Enter · ? · Esc` or the equivalent detail actions.

## Implementation

- Standard selection now uses the injected `KeybindingsManager`; one shared resolver adds the read-only aliases without
  creating another keybinding file or Package-wide keyboard runtime.
- Footer labels come from the active Pi bindings, while the contextual `?` page carries aliases and state-specific
  actions.
- Focused tests cover list, detail, split, help, Escape, Home/End, compact aliases, and a user-rebound Pi action. The
  real Pi PTY verifier covers the wide and narrow paths with Space paging and Tab pane switching.
