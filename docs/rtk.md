# RTK integration

[简体中文](i18n/zh-CN/rtk.md) · English is normative.

Pi Stuff uses RTK to rewrite supported model-issued Bash commands and filter their output. It also removes ANSI control sequences from final tool-result text. These are independent settings. Pi still owns command execution, cancellation, error results, streaming and long-output truncation.

## Configuration

Load the source extension as described in [Web access](web-access.md#load-the-development-extension), then open `/rtk`. Settings contains Command rewrite, ANSI cleanup and Executable. Both switches default to enabled. Automatic discovery checks the Pi process PATH, then asks mise for RTK in the current working directory. It does not change PATH or source a shell profile.

Settings are stored alongside Web access settings in `pi-stuff.json` under Pi's agent directory. The RTK section is optional:

```json
{
  "rtk": {
    "rewrite": true,
    "ansi": true,
    "executable": "/absolute/path/to/rtk"
  }
}
```

Omit `executable` for automatic discovery. A custom path must be absolute; spaces and shell metacharacters are treated as part of the path. Pi Stuff probes the selected executable rather than trusting its filename. A bad custom path does not silently select another installation.

A successful panel save applies to subsequent operations immediately and survives restart. After staging the replacement, Pi Stuff checks the loaded content and symlink target again before replacing the file. A detected external edit causes a conflict; use `/reload` before retrying. The lock serializes Pi Stuff saves, but cannot prevent another editor writing between the final check and replacement. Avoid saving from both interfaces at once. Atomic replacement preserves unrelated settings and existing symlinks without exposing a partial file. An interrupted save can leave a `.lock` file beside the resolved configuration file. Check that no Pi Stuff save is active before manually removing that stale lock, then reload. Do not remove another running session's lock.

Discovery is cached. Change the executable setting or use `/reload` after updating an RTK installation. Missing RTK leaves normal Bash and independent ANSI cleanup available.

## Panel

`/rtk` opens an inline list with Settings, Usage and Diagnostics. It uses Pi's theme, lists and selection keys. Esc is fixed: it returns from a detail page to the list, then restores the editor, even when Pi's cancel binding is remapped. Ctrl+G is not an RTK back/exit shortcut. The RTK extension adds no bottom status bar. A check beside the version means the executable probe succeeded; runtime details retain a textual status.

Direct commands and their completions are:

- `/rtk integration`: Settings.
- `/rtk gain`: Usage.
- `/rtk diagnostics`: executable discovery and failure details.
- `/rtk refresh`: open Usage and read current statistics.
- `/rtk help`: command help.

Usage supports Overview, Daily, Weekly, Monthly, History and Failures. Press `r` to refresh or retry, `[` for the previous report page and `]` for the next. The panel keeps a stable height across views and loading states; long retained content wraps and pages within it. PageUp/PageDown are not RTK shortcuts. Leaving a view cancels its temporary query, including leaving the root summary for Settings. A failed query does not disable rewriting. Narrow layouts support 56 columns by 26 rows; smaller terminals show a size notice with Esc exit.

Diagnostics is read-only. It shows the resolved executable, probe information, the latest integration rewrite failure in this extension lifecycle and native RTK configuration. Pi Stuff does not edit RTK's configuration, trust decisions, telemetry, hooks or statistics database.

Daily, Weekly, Monthly and History keep their table headers on every page. Failures groups parsed recent records and command frequencies, retaining each section's headings as it pages. Theme accents distinguish headers, savings and fallback outcomes; text labels still identify every status.

The following [100x30 capture](assets/rtk/usage.png) and [56x26 capture](assets/rtk/usage-narrow.png) show compiled Pi 0.85.1 with native RTK 0.45.0 after ten `git status` executions in an isolated fixture repository. The figures belong to this sample, not a general savings benchmark. These are rendered Terminal Control captures, not native desktop screenshots.

The export uses Pi's active dark palette and `JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono`.

![RTK Usage at 100 columns and 30 rows](assets/rtk/usage.png)

## What the statistics mean

Usage reports RTK's estimates of tokens in raw and filtered command output. It does not measure provider billing, exact model context, Pi-session-only usage or savings from Pi Stuff's ANSI cleanup. Global statistics can include commands from other applications using the same RTK database. Project uses RTK's current-working-directory scope, not a separate Git-root aggregation.

RTK 0.45.0 exports summary and daily/weekly/monthly data as JSON. Its History JSON mode contains no history list, so Pi Stuff reads the native text history. That interface provides only recent entries and can already truncate command names; local pagination cannot recover text RTK omitted.

Failures is a global text report even with `--format json`. Pi Stuff parses its total, fallback recovery rate, up to ten frequent commands and ten recent records. `Recovered` means RTK's fallback succeeded; it does not mean parsing succeeded. `Failed` means fallback failed. RTK omits error reasons and shortens commands before printing, so the panel cannot recover them. Multiline command text remains part of its record. The integration reads only the command output, never RTK's database. Unrecognized or invalid reports are shown as unsupported, not as zero statistics. [RTK 0.45.0 report implementation](https://github.com/rtk-ai/rtk/blob/b34be37caf3796b69a50952a28e60e32b5daad43/src/analytics/gain.rs#L695-L739).

## Execution and recovery boundaries

An unsupported command executes unchanged. A non-cancellation discovery or rewrite-preparation error also leaves the original command available and records a diagnostic. A cancelled request does not execute a raw fallback.

Once a command starts, Pi Stuff does not replay it after a nonzero exit, timeout or filter failure. RTK may have its own internal fallback behavior; that remains RTK-owned. Shell forms that Pi Stuff cannot safely bind to the absolute RTK executable bypass rewriting.

ANSI cleanup changes final text blocks, including errors. It preserves other content and result metadata. It does not rewrite streamed updates or Pi's retained full-output files. Pi's truncation notices and full-output paths remain available. No extra summary, deduplication or custom line-selection algorithm runs after RTK.

Manual `!` and `!!` commands are outside automatic rewriting. RTK installation, upgrading, native hook setup, statistics reset/export and other RTK dashboards are outside this integration.

## Compatibility and rollback

The acceptance target is Linux, Bun 1.4.0, Pi 0.85.1 and mise-managed RTK 0.45.0. Other versions and platforms require their own verification. RTK output formats can change independently of Pi Stuff.

To disable optimization, turn both settings off. Before returning to an older Pi Stuff version that predates this feature, remove the `rtk` section from `pi-stuff.json`; the older strict configuration decoder rejects unknown sections. Keep the other configuration fields. Reverting code does not undo settings already saved or native RTK statistics.
