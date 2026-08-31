# Codex

[Simplified Chinese](../i18n/zh-CN/docs/capabilities/codex.md)

Codex adds Fast mode, usage visibility, and Codex-specific Tools when Pi is using a supported OpenAI Codex Responses
model.

## Requirements

The active model must use the `openai-codex` provider and a Responses API surface. Authenticate in Pi with:

```text
/login openai-codex
```

Image Tools additionally require a model that declares image input support.

## Quick start

Select a supported Codex model, then run:

```text
/codex
```

The dialog shows Fast mode, usage, and the Tools available for the active model.

## Commands

| Command | Action |
| --- | --- |
| `/codex` | Open Codex controls |
| `/codex fast` | Toggle Fast mode |
| `/codex usage` | Refresh usage |

No other subcommands are accepted.

## Fast mode

Fast mode is off by default and stored as `codex.fast`. When enabled, Pi Stuff adds
`service_tier: "priority"` to supported OpenAI Codex requests. Other providers and API surfaces are unchanged.

The shared Statusline shows `fast` while enabled.

## Usage

Usage is process-local. It refreshes after opening `/codex`, running `/codex usage`, or settling an interactive
user-started run. Requests use a 10-second timeout and do not run in offline mode.

The dialog shows weekly and five-hour remaining allowance when available. The Statusline can show weekly remaining;
Codex usage replaces monetary cost on that surface. Authentication, network, or unsupported-account failures display
`Usage unavailable` without blocking conversation.

## Tools

Supported Codex models expose `apply_patch`. Image-capable supported models also expose:

- `view_image` for inspecting a local image;
- `imagegen` for generating or editing images with `gpt-image-2`.

Generated images are saved locally and up to four eligible files can be projected inline. Native helpers are resolved
for the current platform and report a bounded Tool error when unavailable.

## Authentication

Pi Stuff uses the active model registry entry and its API key or Bearer authentication. Account identity and the
default Codex backend URL are derived from that authenticated model. Use `/login openai-codex` when the account cannot
be resolved.

## See also

- [Codex Module README](../../packages/pi-stuff/src/codex/README.md)
- [Command reference](../reference/commands.md#codex-and-rtk)
- [Settings reference](../reference/settings.md#codex)
- [Troubleshooting](../troubleshooting.md#codex-and-code-mode)

