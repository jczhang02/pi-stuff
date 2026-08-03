# Claude Code 2.1.197 Tool-State Icon Behavior

**Date:** 2026-08-03  
**Product context:** Pi Stuff, with Pi 0.83.0 as the Host  
**Primary specimen:** official Claude Code 2.1.197 Linux x64 native package  
**Question:** how Claude Code changes the Tool icon across running, success, failure, rejection, and cancellation

## Answer

Claude Code 2.1.197 does **not** assign a different glyph to each Tool outcome.

On the tested Linux build, every ordinary Tool operation uses the same `●` marker. State is expressed through three other channels:

1. **animation:** while a Tool is actively running, `●` blinks by alternating with a blank cell;
2. **semantic color:** unresolved is inactive/dim, success is success-colored, and failure/rejection/cancellation are error-colored;
3. **the attached result line:** `Running…`, output, an error, or `Interrupted · What should Claude do instead?` states what happened.

The marker occupies a stable two-column slot. When the running marker blinks off, Claude renders a blank in that slot rather than removing the slot, so the Tool name never shifts horizontally.

The practical state grammar observed in 2.1.197 is therefore:

```text
running       ● ↔ blank    inactive/dim
success       ●            success
failure       ●            error
rejected      ●            error
cancelled     ●            error
```

This directly contradicts a state-specific proposal such as `⊙ / ⊕ / ⊗ / ⊘ / ⊖`. Claude Code solves alignment by keeping one glyph and one gutter, not by finding five optically compatible glyphs.

## Primary-source provenance

Version 2.1.197 was published by Anthropic on 2026-06-30. The official wrapper declares same-version platform packages, including `@anthropic-ai/claude-code-linux-x64`; that native package identifies itself as the Linux x64 binary for 2.1.197. See the official npm registry metadata for the [wrapper package](https://registry.npmjs.org/@anthropic-ai%2fclaude-code/2.1.197) and [Linux x64 native package](https://registry.npmjs.org/@anthropic-ai%2fclaude-code-linux-x64/2.1.197).

The inspected artifacts were fetched directly from those registry records:

| Artifact | Registry integrity | Locally computed SHA-256 |
| --- | --- | --- |
| `@anthropic-ai/claude-code@2.1.197` tarball | `sha512-EqrwbRcI7M5y8jQlayIfTMmbZJ2OQaLOc7KwIWKdryQCdKWUEFr+C9rMovZUuj2Asndi7aqLujEzRtr471gncg==` | `0481de729ef296a62291f26227f76d47741536a4fd81097237448d7769b83199` |
| `@anthropic-ai/claude-code-linux-x64@2.1.197` tarball | `sha512-rIlKmrY0QMyHgPRX/MYWNj039vbypICvI9jVe3rs9Xy2RnNklySjyPxqh62QadznzoftEO23uYQ1tFePcQ//bg==` | `42b12aa7a1d57d9f48b49acecca37643a81528ad873629e0fc5f043730621b14` |
| extracted `claude` binary | n/a | `f54e69cbc89b2da61a415700af7ff52a147e862517d4f1b0eecf768448cf7f83` |

The extracted binary reported:

```text
2.1.197 (Claude Code)
```

No Claude Code source was copied into Pi Stuff, and no installed user configuration was changed.

## Runtime method

The official binary was run through a real PTY under tmux with:

- Linux x64, glibc;
- `TERM=xterm-256color`;
- Claude Code dark theme;
- an isolated temporary Claude configuration and workspace;
- `--bare --safe-mode` so plugins, hooks, memory, and project customizations could not affect the renderer;
- the built-in `Bash` Tool;
- a deterministic local Anthropic-compatible SSE endpoint that returned a Tool call and then accepted its Tool result.

The local endpoint replaced only model generation. Tool parsing, permission UI, Bash execution, lifecycle state, result classification, and TUI rendering all came from the untouched official 2.1.197 binary.

Success, failure, cancellation, and rejection were exercised separately:

- success: `sleep 8; printf 'ok\n'`;
- failure: `sleep 4; printf 'boom\n' >&2; exit 7`;
- cancellation: interrupt `sleep 30; printf 'late\n'` with `Esc` while running;
- rejection: choose `No` in the real Bash permission prompt before execution.

Terminal panes were captured with ANSI attributes preserved. Running animation was additionally sampled every 150 ms.

## Observed states

### Running

The ordinary running frame was:

```text
● Bash(sleep 8; printf 'ok\n')
  ⎿  Running…
```

The marker and child line used the dark theme's inactive gray. The Tool name was bold. The `●` itself was not replaced by a spinner glyph.

Rapid PTY sampling showed the marker alternating with a blank while the command remained active:

```text
frame 01  ● Bash(...)
frame 02  ● Bash(...)
frame 03  ● Bash(...)
frame 04    Bash(...)
frame 05    Bash(...)
frame 06    Bash(...)
frame 07    Bash(...)
frame 08  ● Bash(...)
```

The measured visible and blank phases were approximately 600 ms each. Crucially, the blank frame begins with two spaces before `Bash`: one replaces the dot and the other remains the gutter. The label starts in the same terminal column in every frame.

Claude Code also showed its independent assistant-work spinner below the Tool operation. That animated `✶`/asterisk row is not the Tool-state icon and should not be conflated with it.

### Waiting for permission

While the real permission dialog was open, the Tool row was:

```text
● Bash(printf 'should not run\n' > rejected-proof.txt)
  ⎿  Waiting…
```

The marker was inactive gray and static while the dialog owned interaction. Claude therefore does not use a separate permission glyph.

### Success

After a successful Bash call:

```text
● Bash(sleep 8; printf 'ok\n')
  ⎿  ok
```

The same `●` changed to the dark theme's success color. It no longer blinked. The output remained attached beneath the operation through the `⎿` result gutter.

### Failure

After a non-zero Bash exit:

```text
● Bash(sleep 4; printf 'boom\n' >&2; exit 7)
  ⎿  Error: Exit code 7
     boom
```

The same `●` changed to the dark theme's error color. The child result supplied the actual failure semantics; the glyph did not become a cross or warning sign.

### Permission rejection

Choosing `No` in the Bash permission prompt produced:

```text
● Bash(printf 'should not run\n' > rejected-proof.txt)
  ⎿  Interrupted · What should Claude do instead?
```

The marker used the error color. There was no rejection-specific glyph or warning color.

### Running Tool cancellation

Pressing `Esc` during the 30-second Bash call produced the same settled shell as permission rejection:

```text
● Bash(sleep 30; printf 'late\n')
  ⎿  Interrupted · What should Claude do instead?
```

The marker again used the error color. In this Tool's normal transcript, user rejection and active cancellation are distinguished by lifecycle data but intentionally converge on one visible outcome grammar.

## State matrix

| State | Linux glyph | Animation | Header color in tested dark theme | Attached text/result | Horizontal movement |
| --- | --- | --- | --- | --- | --- |
| Awaiting permission | `●` | No | inactive gray | `Waiting…` | None |
| Running | `●` ↔ blank | Yes, about 600 ms per phase | inactive gray | `Running…` or live Tool progress | None |
| Success | `●` | No | success | Tool-specific result | None |
| Failure | `●` | No | error | Tool-specific error | None |
| Rejected by user | `●` | No | error | `Interrupted · What should Claude do instead?` | None |
| Cancelled by user | `●` | No | error | `Interrupted · What should Claude do instead?` | None |

The captured ANSI 256-color indices happened to be `246` for inactive, `114` for success, and `211` for error under the selected dark theme. Those numeric palette values are not the design contract and must not be copied into Pi Stuff; the semantic roles are the relevant evidence.

## Secondary source inspection and its limit

A separately available third-party reconstruction, `tanbiralam/claude-code` at commit `6f6f12b37f529488b10e53928dd5508bb93535c7`, corroborates the runtime behavior:

- `BLACK_CIRCLE` selects `●` outside macOS and `⏺` on macOS, with a comment that the latter is better vertically aligned but not generally supported on Windows/Linux. [`src/constants/figures.ts:1-5`](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/constants/figures.ts#L1-L5)
- the shared Tool loader keeps a minimum width of two columns, blinks unresolved operations by switching the glyph to a space, and changes resolved state by semantic `success`/`error` color. [`src/components/ToolUseLoader.tsx:11-40`](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/components/ToolUseLoader.tsx#L11-L40)
- its blink hook defines a 600 ms interval and returns the glyph as always visible when animation is disabled. [`src/hooks/useBlink.ts:1-33`](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/hooks/useBlink.ts#L1-L33)
- queued calls keep the same circle in a two-column slot, and normal Tool calls reuse the shared loader. [`src/components/messages/AssistantToolUseMessage.tsx:182-228`](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/components/messages/AssistantToolUseMessage.tsx#L182-L228)

This repository is **not Anthropic's official 2.1.197 source**. It describes itself as a leaked/reconstructed snapshot, has an unverifiable product version, contains stubs, and has no redistributable license. It is secondary corroboration only and must not be copied, ported, adapted, or used to claim exact 2.1.197 internals.

There is also a visible version difference: this snapshot contains the wording `Waiting for permission…`, whereas the official 2.1.197 Linux PTY rendered `Waiting…`. That divergence is why the official package and runtime observations above are the authority for the requested version.

The macOS `⏺` branch is established only by that separate source snapshot in this audit; it was not executable on the Linux host and is not claimed as independently verified 2.1.197 macOS behavior.

## Implication for Pi Stuff

If Pi Stuff follows Claude Code's Tool grammar, the reference answer is:

1. Use one platform-safe Tool marker, `●` on the certified Linux host.
2. Reserve a fixed two-cell icon slot for every operation row.
3. Blink the running marker by replacing it with a blank while retaining the slot; do not cycle through spinner glyphs.
4. Keep the same glyph after settlement and change only semantic color.
5. Use success color for success and error color for failure, rejection, and cancellation.
6. Put the precise state in the attached summary/result line, so the operation does not depend on color alone.
7. Do not use five mathematical-circle glyphs merely to encode states; that reintroduces the optical-alignment problem Claude Code avoids.

This recommendation concerns the icon and gutter system only. Pi Stuff may still use its own compact one-line Tool summaries and Pi-native theme tokens. The critical Claude Code behavior to preserve is the stable marker column and the separation of shape, animation, color, and result semantics.

No implementation change was made as part of this research.
