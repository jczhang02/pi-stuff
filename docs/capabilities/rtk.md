# RTK

[Simplified Chinese](../i18n/zh-CN/docs/capabilities/rtk.md)

RTK shortens eligible shell commands before execution and projects compact successful Bash and Grep output into model
context.

## Install

Pi Stuff certifies the official RTK `0.45.0` Linux x64 binary:

- archive SHA-256: `c4c036fbf181fc55ef329786c8c17e0d427972b053b825944d968a6aafef1ba4`;
- executable SHA-256: `99e0cff729d52297a23eb832f809d9773ba7c32de818dfe76b2cdd900a951535`;
- source commit: `b34be37caf3796b69a50952a28e60e32b5daad43`.

Install the official binary and put `rtk` on `PATH`. Pi Stuff does not download RTK.

## Quick start

Start Pi Stuff and open:

```text
/rtk
```

The dialog shows runtime state, Command rewriting, Model projection, and current Session savings. `/rtk` takes no
subcommands.

## Two independent behaviors

| Behavior | Default | Effect |
| --- | --- | --- |
| Command rewriting | On | Lets RTK replace an eligible Bash command before Pi executes it |
| Model projection | On | Compacts successful Bash and Grep text for the next provider request |

An unavailable runtime disables rewriting, but Model projection can still compact supported results locally.

## Runtime verification

Startup performs no RTK process work. The first eligible Bash rewrite or explicit verification from the dialog:

1. resolves the first `rtk` on `PATH`;
2. resolves its real path and fingerprints the regular file;
3. runs `rtk --version`;
4. checks the certified version and executable SHA-256.

Every later rewrite rechecks path, real path, fingerprint, and SHA. A changed binary enters `drifted` state and remains
disabled until explicit verification.

Dialog states are `✓ ready`, `○ unchecked`, `! drifted`, and `× unavailable`. Press `v` to verify and `c` to clear
Session savings.

## Command rewriting

Empty commands and commands already invoking RTK are left unchanged. Rewrite discovery, version, and rewrite calls use
bounded timeouts of 600 ms, 1 second, and 2.5 seconds.

RTK exit codes 1 and 2 mean no rewrite. Codes 0 and 3 may return a replacement command. Other results, timeout,
unsupported platform, missing executable, or failed certification leave the original command unchanged.

Pi still executes the final Bash call and owns its permissions, lifecycle, and result.

## Model projection

Projection applies only to successful text results from Bash and Grep:

- ANSI control sequences are removed;
- build, test, Git, and linter output can be compacted;
- Grep results are grouped;
- projected text is bounded to 12,000 characters by default.

Failed results, Read output, non-text blocks, unknown Tools, and source messages remain exact. Projection is copy-on-write
for provider context; Session JSONL and transcript output keep the original Tool result.

Repeated provider projections are idempotent and reuse cached work by Tool-call ID.

## Settings and savings

The `rtk` namespace stores `rewriteCommands` and `outputProjection`, both `true` by default. Only direct changes from
`/rtk` persist.

Session savings compare original and projected character counts. They are an in-memory presentation metric, not a
billing or token claim. Clearing savings does not change Tool results.

## Recovery

If rewriting is unexpectedly inactive, run `/rtk` and verify the runtime. A missing, moved, slow, or non-certified
binary fails open to the original command. See [Troubleshooting](../troubleshooting.md#rtk).

## See also

- [RTK Module README](../../packages/pi-stuff/src/rtk/README.md)
- [Settings reference](../reference/settings.md#rtk)
- [Command reference](../reference/commands.md#codex-and-rtk)
- [Upstream references](../../packages/pi-stuff/src/rtk/UPSTREAM.md)

