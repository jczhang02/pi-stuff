# Absorbed MCP implementation

This directory is the private implementation behind Pi Stuff's `mcp` module. It is source code absorbed from a pinned,
locally adapted `pi-mcp-adapter` snapshot; it is not a Package, dependency, or independently installed extension.

Pi Stuff owns the user-visible proxy Tool and Command Dialog in the parent directory. The implementation here supplies
configuration, transports, discovery, OAuth, lifecycle, output guarding, and protocol handling. See
[`UPSTREAM.md`](./UPSTREAM.md) for exact provenance, integrity records, license, and the maintained delta.
[`UPSTREAM_README.md`](./UPSTREAM_README.md) preserves the source project's documentation for maintenance reference;
its installation instructions do not apply to Pi Stuff. Direct Tools, JavaScript batching, prompts, Apps, sampling,
and elicitation are intentionally absent rather than retained behind flags.

`implementation.ts` keeps one per-factory adapter state and wires ordered session, Command, and gateway Tool phases.
`init.ts` owns state construction and startup projection; `server-manager.ts` alone owns connection identity and
transport cleanup.
`config-sources.ts` owns path and host-config discovery; `config.ts` owns precedence-safe loading, narrow writes, and
its compatibility exports.

`mcp-setup-panel.ts` owns setup interaction, writes, and lifecycle state. `mcp-setup-panel-view.ts` renders immutable
snapshots and exact write previews without mutating that state.
