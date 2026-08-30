# Absorbed MCP implementation

This directory is the private implementation behind Pi Stuff's `mcp` module. It is source code absorbed from a pinned,
locally adapted `pi-mcp-adapter` snapshot; it is not a Package, dependency, or independently installed extension.

Pi Stuff owns the user-visible proxy Tool and Command Dialog in the parent directory. The implementation here supplies
configuration, transports, discovery, OAuth, lifecycle, output guarding, and protocol handling. See
[`UPSTREAM.md`](./UPSTREAM.md) for exact provenance, integrity records, license, and the maintained delta.
Direct Tools, JavaScript batching, prompts, Apps, sampling, and elicitation are intentionally absent rather than
retained behind flags.

`implementation.ts` keeps one per-factory adapter state, forks its Capability Scope from the shared Effect Foundation's
Session Scope, and wires ordered Session, Command, and gateway Tool phases. `runtime-owner.ts` owns the MCP runtime
Scope; `server-manager.ts` owns Fiber-backed single-flight connection identity and per-connection child Scopes;
`metadata-discovery.ts` owns bounded tool and resource pagination. Lifecycle, Session, Command, and gateway operations
compose as Effects, while `mcp-effect-runner.ts` projects them to the existing Promise and `AbortSignal` contracts only
at Pi-facing seams. `mcp-http-transport.ts` owns native HTTP negotiation and failed-acquisition cleanup.
`config-sources.ts` owns path and host-config discovery; `config.ts` owns precedence-safe Effect loading and narrow
writes; `config-persistence.ts` owns Effect-scoped write locks and atomic replacement.

`mcp-setup-panel.ts` owns setup interaction, writes, and lifecycle state. `mcp-setup-panel-view.ts` renders immutable
snapshots and exact write previews without mutating that state.

## Retained runtime contracts

- A supplied in-memory `config` is a complete isolated snapshot: it is cloned per factory and Session, never mutated,
  and never merged with files or command-line configuration.
- A configured `!command` credential source runs only while connecting or authenticating. It receives no stdin or
  stderr, has a 10-second deadline and 1 MiB stdout limit, and never runs while configuration is read, merged,
  previewed, hashed, or rendered.
- OAuth credentials require the operating-system credential store and fail closed when it is unavailable. Linux may
  recover a revoked Session keyring through the packaged `keyctl`/Node helper; failure never falls back to plaintext.
- HTTP connection first probes Streamable HTTP, retries one implicit OAuth challenge with the native SDK provider,
  and falls back to native SSE only after a non-authentication protocol failure. SDK Client and Transport identities
  remain native.
- Endpoint classification keeps manual redirects, a 5-second deadline per request, a 64 KiB response-body limit, and
  guaranteed response cancellation. Effect interruption closes a failed connection acquisition exactly once.
- The runtime Scope owns connection-attempt Fibers, OAuth shutdown, health checks, and each live connection's child
  Scope. Closing interrupts pending acquisition before running the native session, Client, Transport, and trace
  cleanup protocols.
- Each Host Session has one status-publication generation. Authority handoff publishes an empty snapshot, and stale
  initialization or cleanup cannot publish into the newer Session.
- Configuration discovery, previews, and codecs remain synchronous native adapters. Loading and mutation workflows
  compose as Effects, and every mutation acquires the shared settings lock.
- A configured `rmcp-mux` socket is a trusted shared endpoint. Pi Stuff owns only its client connection and never
  starts, adopts, restarts, or stops the mux daemon or upstream process.
- Enabled `eager` and `keep-alive` servers may initialize for a programmatic Host without `session_start`; a later
  Session-owned runtime supersedes that load-time runtime.
- Returned `structuredContent` is validated against an advertised JSON Schema draft-07 or 2020-12 `outputSchema`.
