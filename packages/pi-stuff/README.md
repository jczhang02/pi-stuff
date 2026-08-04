# `@jczhang02/pi-stuff`

The ordered Aggregate Package for the Pi Stuff Suite.

Version `0.1.0` is the first public release line.

## Contract

- Loads through the native Pi Package system.
- Requires the upstream Host profile documented in the repository compatibility contract; tagged `v0.83.0` lacks the
  public Markdown rendering API needed by Live Thoughts.
- Exports one default Extension factory.
- Invokes Capability factories in the explicit registry order.
- Fails fast when a Capability cannot initialize.
- Does not install itself or mutate Host settings.

## Included capabilities

- `@jczhang02/pi-stuff-ui`: responsive Statusline and Welcome header, live Thought projection, input highlighting and
  inline slash autocomplete, unified `/ui` settings, and the shared non-floating Command Dialog host.
- `@jczhang02/pi-stuff-tools`: compact presentation for Pi's seven built-ins and participating Suite tools, with focused `/tools` details.
- `@jczhang02/pi-stuff-context`: lazy continuity through the owned Magic Context fork, with raw Pi JSONL authority,
  bounded projections, project isolation, and automatic fallback to native Pi context when local derived state fails.
- `@jczhang02/pi-stuff-rtk`: certified fail-open Bash command rewriting plus Bash/Grep compaction only in model-visible context; raw Tool results remain in the session.
- `@jczhang02/pi-stuff-codex`: one `/codex` surface for Fast mode and subscription usage, plus shared-rendered
  `apply_patch`, `view_image`, and confirmed `gpt-image-2` generation Tools.
- `@jczhang02/pi-stuff-agents`: current-session foreground and background Agents with a compact roster and full-width control view.
- `@jczhang02/pi-stuff-todo`: four model-facing Task tools and a compact task widget above Pi's editor.
- `@jczhang02/pi-stuff-btw`: one-shot side questions that use the effective conversation context without changing the main transcript.

`/ui` is the single settings entry point. It contains Statusline visibility, density, latest-prompt and icon preferences;
Welcome header; input highlighting; inline slash autocomplete; the Tool running timer; and RTK rewriting/projection.
The boolean settings are enabled by default, density and icons default to automatic, and `/tool-settings` is no longer
registered. `/rtk` opens the shared Command Dialog for runtime identity and savings diagnostics.

Published releases install through Pi's Package system:

```bash
pi install npm:@jczhang02/pi-stuff
```
