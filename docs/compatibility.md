# Runtime compatibility

[简体中文](i18n/zh-CN/compatibility.md)

## Subagent UI prototype

The throwaway launcher uses `Bun.spawn` in [run.ts](../tools/subagent-ui-prototype/run.ts) to start an isolated Bun process with inherited terminal streams and an explicit environment. Bun is already the repository's pinned runtime; a second process gives the SDK host a temporary process cwd and agent storage, while the SDK uses the caller’s project cwd for native display context. No additional runtime dependency was added.

The current prototype runs Pi SDK 0.85.1's `InteractiveMode` under Bun 1.4.0 on Linux, with Tuistory 0.11.0 for terminal interaction. Its session and settings are in memory. The prototype's [README](../tools/subagent-ui-prototype/README.md) records native versus simulated UI boundaries and the reproduction commands.

Those statements describe the UI-only artifact. The separate runtime experiment below adds a development dependency and exercises the compiled host.

## Arhen runtime E2E

The [runtime experiment](../tools/subagent-runtime-e2e/README.md) pins `@arhen/pi-core-subagent` 1.3.54 as a development dependency and retains its optional session hooks and type declarations in a Bun patch. A fresh directory installed the frozen lock with lifecycle scripts disabled and replayed five terminal probes using Pi SDK 0.85.1 and the maintainer's separately compiled `/opt/bin/pi` 0.85.1 on Linux/Bun 1.4.0. Tuistory 0.11.0 drives both profiles. Arhen's declared Pi peer range is `^0.84.2`; these executed probes, rather than that range, support this limited pairing.

`Bun.serve` supplies the loopback model boundary. Real Pi sessions execute real tools and worker processes in temporary projects; no live model or credentials are used. `Bun.spawn` isolates the SDK interactive host, and temporary session files exercise same-process continuation and cleanup. The README records the fork provenance, exact commands, behaviors and screenshots.

The SDK host renders the native footer before Fleet. The compiled extension probe preserves Pi's native footer, but public `setWidget({placement: 'belowEditor'})` places Fleet above it. Pi 0.85.1 has no public footer append/getter API for composing with arbitrary existing footer extensions. A drop-in production package matching the requested placement is therefore not established. Completed-task continuation is also restricted to settled Arhen runs. A controlled companion passed existing-editor binding checks across reload; its custom footer is preserved only by the compiled probe. Live providers, arbitrary extension coexistence, worktree-writing tasks, crash/restart recovery, Node and other systems remain unverified.
