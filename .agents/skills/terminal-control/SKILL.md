---
name: terminal-control
description: Control and test terminal applications with Pi Stuff's pinned Terminal Control client and CLI. Use for terminal E2E, interactive TUI inspection, or a shared foreground prototype.
license: MIT
---

# Terminal Control

Use Terminal Control for terminal E2E and interactive TUI inspection. The repository pins `@kitlangton/terminal-control@1.2.1`, and the `tui` package script exposes its installed `termctrl` binary. Keep terminal work in the repository environment and check the local help before using a command:

```bash
bun run tui --help
```

For API work, read the installed package's `README.md` and `dist/index.d.ts` first. The published [TypeScript client documentation](https://github.com/anomalyco/terminal-control/blob/v1.2.1/docs/typescript-client.md) and [source](https://github.com/anomalyco/terminal-control/tree/v1.2.1) are the provenance references when the installed files leave a question.

## Programmatic sessions

Create one driver, launch the command with an explicit viewport when layout matters, and close both resources on every path:

```ts
import {TerminalControl} from '@kitlangton/terminal-control';

const terminal = await TerminalControl.make();
try {
  const session = await terminal.launch({
    command: ['my-cli'],
    viewport: {cols: 120, rows: 36},
  });
  try {
    await session.screen.waitForText('Ready', {timeoutMs: 5000});
    await session.keyboard.type('hello');
    await session.keyboard.press('Enter');
    await session.screen.text();
  } finally {
    await session.stop();
  }
} finally {
  await terminal.close();
}
```

Use the public surfaces that answer the test question:

- `session.screen.waitForText`, `waitForIdle`, `waitUntil`, `capture`, `frame` and `text` observe the visible terminal screen. Give every wait a bounded `timeoutMs`; stable screen captures use options such as `settleMs` and `deadlineMs`.
- `session.keyboard.type`, `press`, `sequence` and `write` send input. `session.resize` changes the viewport, `session.mouse` sends cell-based mouse events, and `session.logs` or `session.transcript` exposes retained output.
- `session.writeArtifacts` is opt-in evidence. Screen output, recordings and transcripts can contain user input or credentials, so keep them in a private failure directory.

The typed `Key` union does not include modified arrows such as `Shift+ArrowLeft` or `Control+ArrowLeft`. `MouseEvent` supports move, button and drag input but has no wheel action. When a test needs those protocols, encode the exact bytes with `session.keyboard.write(new Uint8Array(...))` and keep that raw-input adapter explicit. Do not invent typed key or mouse variants.

Always stop the session started by the test, then close its driver. Preserve useful screen output on failure and let the original assertion or process failure reach the test runner.

The runtime resolves an explicit `binaryPath` before the `TERMCTRL_BINARY` environment override. Use the installed repository binary by default and do not set an unreviewed `TERMCTRL_BINARY`; system tests that require a deterministic native driver should pass the pinned `binaryPath` explicitly.

## CLI sessions

Use the repository command in examples and scripts:

```bash
# Detached persistent session.
bun run tui start demo --host opentui --cols 112 --rows 34 -- opencode
bun run tui wait demo '/connect' --timeout 30000
bun run tui show demo
bun run tui send demo text:/connect enter
bun run tui resize demo --cols 132 --rows 38
bun run tui stop demo
```

`start` creates a persistent background PTY and returns when its local control socket is ready. The application stays alive until `stop`. Use `show`, `wait`, `send`, `mouse`, `status`, `resize`, `logs` and `save` against the named session.

For a prototype that a person should share live from startup, use the foreground form:

```bash
bun run tui run demo --cols 112 --rows 34 -- opencode
```

`run` mirrors the PTY through the current terminal while named-session commands can inspect, send input and resize it. The foreground command owns the application's lifetime and exits with it. In 1.2.1, `run` follows the outer terminal size: changing that PTY and delivering `SIGWINCH` updates the child and screen, while CLI `resize` does not. Resize the outer terminal for shared review; use an API session or `start` for programmatic viewport changes. There is no later `attach` path to an API-launched session, so choose `run` at startup for shared prototypes.

## Isolation and display evidence

Use isolated working, settings and session directories for tests and deterministic local providers where they answer the question. Headless Terminal Control captures are terminal evidence: they do not prove a real window, compositor, font rasterization or pointer experience.

Use CUA only when that actual display evidence is required. Before launching any driver or terminal, require a dedicated display distinct from the host, a private session D-Bus and an isolated runtime that cannot switch the host foreground. When using Xvfb, clear inherited `WAYLAND_DISPLAY`; disable single-instance host-terminal reuse through the private bus/runtime and use an explicit driver endpoint. Verify the host's focus, pointer position and clipboard before, during and after the run. If those conditions cannot be established, stop and report display acceptance as blocked; do not use the host display or relabel headless evidence as native-display evidence.

The Linux Xvfb/Mutter/Ghostty result recorded in issue [#71](https://github.com/jczhang02/pi-stuff/issues/71) covers host X11 focus for that setup only. It does not establish a universal focus guarantee or Wayland support.

Complete a terminal task only after the required screen states and user actions are observed, applicable failure or cancellation paths are checked, and every owned session and driver is closed.
