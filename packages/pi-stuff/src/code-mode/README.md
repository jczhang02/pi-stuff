# Code Mode

[Simplified Chinese](../../../../docs/i18n/zh-CN/packages/pi-stuff/src/code-mode/README.md)

JavaScript composition of active Pi Stuff Tools inside an isolated V8 host.

## Quick start

```text
/codemode on
```

The model can then discover the local catalog and call `tools.*` from `codemode({ code })`. Open `/codemode` to inspect
the effective policy, catalog, approvals, and Session ledger.

## Highlights

- Resolves trusted-project, global, process, and child-Agent policy explicitly.
- Keeps direct Node, filesystem, process, network, module, and credential access out of the sandbox.
- Preserves each nested Tool's validation, permissions, lifecycle, renderer, and media behavior.
- Records stable execution and nested-call IDs in a bounded Session ledger.
- Supports durable approval, replay policy, rollback, checkpoints, and saved snippets.
- Installs and verifies the pinned V8 helper only on first explicit execution.

## Documentation

- [Code Mode guide](../../../../docs/capabilities/code-mode.md)
- [Command reference](../../../../docs/reference/commands.md#code-mode)
- [Settings reference](../../../../docs/reference/settings.md#codemode)
- [Troubleshooting](../../../../docs/troubleshooting.md#codex-and-code-mode)
- [Upstream references](UPSTREAM.md)

