# Runtime compatibility

[简体中文](i18n/zh-CN/compatibility.md)

## Subagent UI prototype

The throwaway launcher uses `Bun.spawn` in [run.ts](../tools/subagent-ui-prototype/run.ts) to start an isolated Bun process with inherited terminal streams and an explicit environment. Bun is already the repository's pinned runtime; a second process gives the SDK host a temporary process cwd and agent storage, while the SDK uses the caller’s project cwd for native display context. No additional runtime dependency was added.

The current prototype runs Pi SDK 0.85.1's `InteractiveMode` under Bun 1.4.0 on Linux, with Tuistory 0.11.0 for terminal interaction. Its session and settings are in memory. The prototype's [README](../tools/subagent-ui-prototype/README.md) records native versus simulated UI boundaries and the reproduction commands.

This revision does not exercise the separately compiled Pi executable as an extension host. It establishes only the SDK prototype profile above; production extension loading, Node and other operating systems remain unverified.
