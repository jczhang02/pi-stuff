# Session Naming

[Simplified Chinese](../i18n/zh-CN/docs/capabilities/session-naming.md)

Session Naming gives settled work a short, searchable English label. It can name Sessions automatically or regenerate
the current name on demand.

## Quick start

Start a new Pi Session and complete a normal user-started Agent run. After the run settles, the unnamed Session receives
a generated name.

Use these commands at any time:

```text
/autoname
/autoname settings
```

`/autoname` regenerates the current name. `/autoname settings` opens the interactive settings list.

## When automatic naming runs

Automatic naming listens for direct user work that has fully settled. It does not run for child Sessions, replaced
contexts, or extension-authored continuation alone.

An unnamed Session is named after its first settled user run. Later naming attempts wait for the configured cooldown,
which is 10 minutes by default. A failed attempt can retry after the next eligible settled run.

## Settings

| Setting | Default | Effect |
| --- | --- | --- |
| Automatic naming | On | Names eligible Sessions after settled user work |
| Rename cooldown | 10 minutes | Minimum interval between automatic naming attempts |
| Keep manually assigned names | Off | Prevents automatic replacement of a manual name when enabled |
| Naming model | Session model | Selects an optional fixed primary model |

The cooldown choices in the dialog are 10 minutes, 30 minutes, 1 hour, 6 hours, and 24 hours. Advanced JSON can provide
an ordered `fallbackModels` list.

Turning automatic naming off does not disable `/autoname`. Selecting **Session model** removes the fixed route and uses
the active Session model first.

## Model routing

Naming tries authenticated candidates in this order:

1. the configured fixed model, when present;
2. the active Session model;
3. configured fallback models.

Each attempt is bounded to 12 seconds and 64 output tokens; the whole operation is bounded to 30 seconds. If model
responses are unavailable or invalid, a local fallback is used only when it passes the same name-quality checks.
Selecting a naming model does not change the active conversation model.

## Name contract

A generated name:

- is English and two to four words;
- is no longer than 30 characters;
- uses printable, filename-safe text;
- preserves useful technical identifiers;
- describes the current task rather than the repository in general.

When the task has not materially changed, a compliant current name may remain unchanged.

## Context and privacy

The naming prompt uses bounded completed User and Assistant text. It removes leading system reminders, treats the
content as untrusted, and redacts credential-like patterns. Tool execution is not available to the naming call.

The active Session name and naming markers remain in Session-owned state. `respectManualName` distinguishes a manual
name from a generated name when deciding whether periodic naming may replace it.

## Recovery

Invalid `sessionNaming` JSON activates the complete built-in defaults and adds a Diagnostic Record. The settings dialog
does not overwrite malformed JSON; correct the namespace first, restart Pi, and reopen `/autoname settings`.

## See also

- [Session Naming Module README](../../packages/pi-stuff/src/session-naming/README.md)
- [Command reference](../reference/commands.md)
- [Settings reference](../reference/settings.md)
- [Troubleshooting](../troubleshooting.md)

