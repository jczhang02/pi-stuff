# Single-Package migration inventory

This record maps the source topology frozen at the start of `ps-7lq` to the completed single-Package layout, including
the Code Mode integration that landed immediately afterward. Every listed Runtime Resource, behavior, prompt, native
helper, provenance record, and verification seam has an explicit destination.

## Source-to-Module map

| Current directory | Destination | Runtime responsibility |
| --- | --- | --- |
| `packages/pi-stuff` | `packages/pi-stuff` | One Package manifest, one default Extension, ordered composition |
| `packages/pi-stuff-ui` | `packages/pi-stuff/src/conversation-ui` | Welcome, Statusline, Thought, input, settings, Command Dialog and shared UI lifecycle |
| `packages/pi-stuff-tools` | `packages/pi-stuff/src/tool-display` | Built-in Tool presentation, Suite Tool contract, activity grouping, detail dialog and resume reconstruction |
| `packages/pi-stuff-context` | `packages/pi-stuff/src/context-management` | Magic Context integration, bounded projection and Context Tool presentation |
| `packages/pi-stuff-rtk` | `packages/pi-stuff/src/rtk` | RTK command rewriting, projection, settings and diagnostic dialog |
| `packages/pi-stuff-codex` | `packages/pi-stuff/src/codex` | Codex Fast/usage controls and the retained native Tool helpers |
| `packages/pi-stuff-goal` | `packages/pi-stuff/src/goal` | Persistent objective, continuation, accounting, completion/blocking and Goal UI |
| `packages/pi-stuff-web` | `packages/pi-stuff/src/web` | Bounded Suite Web surface, URL policy, fake-IP compatibility and Tool presentation |
| `packages/pi-web-access` | `packages/pi-stuff/src/web/runtime` | Adapted search, extraction, storage, PDF and SSRF implementation |
| `packages/pi-stuff-mcp` | `packages/pi-stuff/src/mcp` | Bounded Suite MCP surface, status dialog and Tool presentation |
| `packages/pi-mcp-adapter` | `packages/pi-stuff/src/mcp/runtime` | Adapted transports, discovery, OAuth, lifecycle, output guard and protocol implementation |
| `packages/pi-stuff-work` | `packages/pi-stuff/src/background-work` | Background Shell, Monitor, task dialog and current-work registry |
| `packages/pi-stuff-agents` | `packages/pi-stuff/src/subagents` | Agent discovery, execution, steering, session ownership, roster and dialog |
| `packages/pi-stuff-todo` | `packages/pi-stuff/src/todo` | Todo state, task graph, Task Tools and checklist UI |
| `packages/pi-stuff-btw` | `packages/pi-stuff/src/btw` | One-shot side question, isolated model request, history and Command Dialog |
| concurrent `feat/code-mode` implementation | `packages/pi-stuff/src/code-mode` | Opt-in one-schema Tool envelope, isolated V8 execution, Host acquisition and unchanged nested Tool presentation |

The destination directory name is the internal Module name. No destination other than `packages/pi-stuff` receives a
`package.json`, version, npm export, or Pi `extensions` declaration.

## Non-TypeScript Runtime Resources

The following resources must move with their owning Module and remain in the Package file allowlist:

- `subagents/agents/general-purpose.md`
- `btw/prompts/btw-system.txt`
- `codex/native/{apply-patch,imagegen,view-image}/linux-x64/*`
- `codex/LICENSES/Apache-2.0.txt` and `codex/THIRD_PARTY_NOTICES.md`
- `rtk/upstream/techniques/*.ts`
- `background-work/process-supervisor.mjs`
- `mcp/runtime/app-bridge.bundle.js`
- `mcp/runtime/mcp-script-worker.mjs`
- `mcp/runtime/mcp-keyring-helper.cjs`
- `mcp/runtime/banner.png`
- `code-mode/LICENSES/Apache-2.0.txt`, `code-mode/THIRD_PARTY_NOTICES.md`, and `code-mode/UPSTREAM.md`
- every retained `UPSTREAM.md`, `SECURITY.md`, and third-party license text

Historical per-Package changelogs remain available through Git history. One Package changelog is maintained after the
migration.

## Dependency inventory

Self-owned `@jczhang02/pi-*` dependencies disappear. Pi core Packages remain wildcard peers and exact `0.84.1`
development dependencies. The direct external runtime dependency set is derived from source imports rather than from
the former fully bundled transitive manifests:

- `@cortexkit/pi-magic-context`
- `@modelcontextprotocol/ext-apps`
- `@modelcontextprotocol/sdk`
- `@mozilla/readability`
- `@napi-rs/keyring`
- `@napi-rs/keyring-linux-x64-gnu`
- `ajv`
- `ajv-formats`
- `cross-spawn`
- `linkedom`
- `open`
- `p-limit`
- `proxy-from-env`
- `promise.try`
- `smol-toml`
- `strip-json-comments`
- `turndown`
- `typebox`
- `unpdf`
- `zod`

The migration must confirm dynamic imports and optional platform helpers before deleting any former direct dependency.
The frozen Bun lockfile remains the complete transitive dependency record.

## Composition and interface invariants

The installation order remains:

1. Conversation UI
2. Tool Display
3. RTK
4. Codex
5. Goal
6. Context Management
7. Web
8. MCP
9. Background Work
10. Subagents
11. Todo
12. BTW
13. Code Mode, installed after the complete Tool catalog has registered

Every Module retains one installation interface accepting Pi's `ExtensionAPI`. Subagents additionally receives the
single Package entry path used to launch children. The Suite Tool registration tracker and required, deferred, and
optional Tool inventories remain authoritative. Tool schemas, active Tool policy, registration order, and activity
metadata coverage must not drift.

Internal dependency direction is:

```text
Package entry -> Capability Modules -> conversation-ui
                                  \-> tool-display -> conversation-ui
web -> web/runtime
mcp -> mcp/runtime
btw -> context-management
subagents -> context-management + background-work
code-mode -> tool-display
```

`conversation-ui` and `tool-display` must not import a Capability Module. Cross-Module coordination continues through
the existing shared event bus, module-owned registries, and explicit imported interfaces. Suite startup readiness is
owned by `conversation-ui`, uses a module-local Host registry, and does not add a second runtime or package-global
coordinator.

## Verification destinations

Existing tests retain their behavioral families (`ui`, `tools`, `context`, `rtk`, `codex`, `goal`, `web`, `mcp`,
`work`, `agents`, `todo`, `btw`, and `code-mode`) while imports change to internal Module paths. Specialized Agent, Goal, and RTK
TypeScript profiles remain until their upstream-derived source can satisfy one common strict profile without behavior
changes.

The final required seams are:

- deterministic ordered composition and complete Tool activity metadata;
- repository safety and explicit Package file allowlist;
- one extracted local Package loaded through Pi's Package loader;
- Pi 0.84.1 public RPC Tool and command discovery;
- real PTY coverage at 100x32 and 64x28;
- reload/resume, compaction, long-session reconstruction and background finalization;
- MCP stdio/HTTP fixtures, Web integration, Magic Context, RTK and native Codex Tool checks;
- Code Mode direct/enveloped equivalence, nested media, cancellation, resume, schema reduction, and wide/narrow real
  Pi TUI checks;
- network-isolated acceptance with no model request or credential requirement.

## Removed maintenance surfaces

After the one Package passes equivalent verification, remove:

- the twelve former Capability manifests and two private implementation manifests (Code Mode entered directly as an
  internal Module and never added another manifest);
- self-owned dependency and `bundledDependencies` version synchronization;
- Changesets and per-Package changelogs as active release inputs;
- registry publication and multi-archive release scripts;
- Package-name-based Suite generation and schema validation;
- type declarations that existed only to bridge workspace Package imports.

Single-Package packing and local installation verification remain. Code Mode is integrated through the same internal
Tool registration interface and does not restore another Package boundary.

## Completion evidence — updated 2026-08-11

- `packages/pi-stuff/package.json` is the only manifest below `packages/`; its thirteen Modules have no manifests,
  versions, npm exports, lifecycle scripts, or self-owned Package dependencies.
- Web and MCP implementation source now lives in `src/web/runtime` and `src/mcp/runtime`. The extracted-Package audit
  requires their licenses, provenance, original documentation, Web security policy, MCP banner and runtime helpers,
  every retained RTK technique, and the Codex Apache license and notices.
- The single dependency boundary converges TypeBox on `1.3.10`, the exact version already used by the absorbed Web
  implementation and resolved by Magic Context. Former MCP manifest entries that merely duplicated transitive SDK
  dependencies were removed; the SDK's already-selected nested versions are now deduplicated. The complete schema and
  runtime matrix below verifies the converged boundary.
- Repository safety now rejects a Package added below `packages/`, a nested manifest, publication lifecycle state, or
  an internal Module import that violates the accepted shared-to-Capability dependency direction.
- `bun run typecheck`, `bun run knip`, generated composition, repository safety, formatting, and Tool Activity
  benchmarks pass. The complete isolated test matrix passes in separate Bun processes, followed by the Goal upstream
  suite.
- `bun run pack:verify` certifies one local archive with the source-attested Pi 0.84.1 Host. It covers Package
  loading, commands and Tools, resume, Magic Context, Goal, Web, MCP, RTK, Subagents, Background Work, BTW, and the
  accepted wide/narrow TUI surfaces.
- Code Mode is the thirteenth internal Module. It enters through `suite.json` and the Suite Tool registration tracker,
  preserves direct Tool UI/session/media behavior, and is covered by the same Package and real-Host verification
  matrix.
