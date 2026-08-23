# Pi Stuff code-volume reduction results

**Measurement date:** 2026-08-23  
**Beads:** `ps-4xm`, `ps-hxl`  
**Baseline:** `06e627a`  
**Measured implementation:** `bd48b24`  
**Certified Host:** Pi `0.84.2+source.914cf1472e71.binary.9a2d20fab3ca.bun.1.3.14`, Bun `1.3.14`, Linux x64

## Decision

Keep the native implementation and the reduced Web/MCP product surface. Do not add Effect v4 to the production
dependency graph.

The reduction removes dormant interfaces rather than moving them into another package. The final implementation deletes
16,942 more Git lines than it adds, reduces shipped Package source code by 14,669 lines (12.19%), removes five direct
runtime dependencies, and cuts the packed archive by 23.19%. The retained public Tools, transport and security boundaries
continue to pass focused, Package, and real-Host checks.

## Before and after

| Measure | `06e627a` | `bd48b24` | Change |
| --- | ---: | ---: | ---: |
| Package `src/` TS/JS physical lines | 133,957 | 117,920 | -16,037 (-11.97%) |
| Package `src/` TS/JS code lines | 120,348 | 105,679 | -14,669 (-12.19%) |
| Git diff | — | 323 additions, 17,265 deletions | net -16,942 lines |
| Direct runtime dependencies | 24 | 19 | -5 (-20.83%) |
| Installed dependency-tree entries | 507 | 436 | -71 (-14.00%) |
| Packed files | 442 | 415 | -27 (-6.11%) |
| Packed archive | 5,845,130 bytes | 4,489,622 bytes | -1,355,508 (-23.19%) |
| Unpacked file bytes | 13,801,985 | 11,776,000 | -2,025,985 (-14.68%) |
| Fresh-process startup p50 | 2,830.32 ms | 2,726.20 ms | -104.12 ms (-3.68%) |
| Fresh-process startup p95 | 2,892.19 ms | 2,809.60 ms | -82.59 ms (-2.86%) |
| Fresh-process shutdown p50 | 86.62 ms | 85.49 ms | -1.13 ms (-1.30%) |
| Maximum RSS, three-run median | 247,932 KiB | 248,056 KiB | +124 KiB (+0.05%); no measurable change |
| `check:fast` wall time | 39.36 s | 39.17 s | -0.19 s (-0.48%); no material change |

`tokei` counts TypeScript and JavaScript under `packages/pi-stuff/src`, including the retained adapted Web and MCP
runtimes. `bun pm ls --all | wc -l` counts printed dependency-tree entries, not unique package identities. Archive bytes
are the tarball size and the sum of file sizes reported by GNU tar.

Lifecycle samples use a fresh Pi process and cold process-local Suite module cache. One retained warmup precedes five
samples at 80×24, so executable and filesystem caches are warm; global kernel caches are not dropped. RSS is the maximum
resident set reported by zsh for three independent one-warmup/one-sample benchmark batches. The 124 KiB difference is
far below run-to-run variation and is not evidence of a memory regression.

The paired `check:fast` timing was taken at deletion checkpoint `ce19759`. The later cache-invalidation and stale-asset
review fixes also pass `check:fast`; their separately warmed timing is not mixed into the paired comparison.

## Deleted and retained behavior

Web now exposes only `web_search`, `fetch_content`, and `get_search_content`. It retains provider search, HTTP(S), image
and PDF extraction, cancellation, SSRF and redirect protection, fake-IP compatibility, and bounded GitHub API extraction.
The deleted code covered the unreachable curator and hidden command/shortcut handlers, source-check/research workflows,
local video and YouTube extraction, page-answering, and the Git clone fallback.

MCP now exposes one `mcp` gateway plus `/mcp` control. It retains discovery, describe/instructions, connect and single
call actions, resource reads, stdio/HTTP transports, OAuth, lifecycle policy, output guards, approvals, tracing, metadata
cache, and the shared Command Dialog. The deleted code covered direct per-server Tools, JavaScript batching, prompts,
MCP Apps/browser windows, floating panels, bundled Skills, sampling, elicitation, and their supporting runtime assets.

The dependency cleanup replaces `cross-spawn` with `node:child_process` and native Bun Promise behavior replaces
`promise.try`. The deleted MCP Apps surface removes the direct `@modelcontextprotocol/ext-apps` and `zod` requirements;
`@types/json-schema` is development-only. Two unused Todo store accessors were also removed.

Version 1 MCP metadata caches are intentionally invalidated. They may contain former app-only visibility metadata, which
must not be reconstructed as ordinary model-visible Tool metadata after MCP Apps removal.

## Effect v4 result

The disposable prototype remains rejected for production. At commit
`ad2d770b4accf3068fa5ce05edc9cd69982fe862`, Effect reached lifecycle parity but used 10.2% more lifecycle code, added
23–25 ms to real Pi readiness, added 15–22 MiB median RSS, and enlarged the aggregate archive by 8,225,937 bytes
(38.58%). No Effect dependency or prototype code is merged.

The decision and thresholds remain documented in
[Effect v4 adoption assessment](effect-v4-pi-stuff-adoption-20260810.md) and
[behavior-preserving code reduction and Effect v4 assessment](code-volume-effect-v4-architecture-20260821.md). Revisit
only after stable v4, for one lazy-loaded in-process slice, and only when it beats the optimized native implementation by
at least 15% net code without a material startup, memory, package, or maintenance regression.

## Validation

- Focused Web tests: 14 passed.
- Focused MCP tests: 76 passed; the legacy app-cache invalidation regression test also passes.
- `bun scripts/verify-web-integration.ts`: passed against the retained three-Tool surface.
- `bun scripts/verify-mcp-pty.ts`: passed wide, narrow, low-height, reload, persistence, OAuth, lifecycle, Tool
  call/resume, and Command Dialog scenarios on real Pi.
- `bun run check:fast`: passed after the independent review fixes.
- `PI_BIN="$PI_BIN" bun run pack:verify`: certified one 415-file local Package on Pi 0.84.2.
- `PI_BIN="$PI_BIN" bun run check`: passed on this report snapshot.
- Four independent deletion reviews found no remaining Web or MCP correctness issue after cache and Package findings were
  fixed.

## Reproduction

Create a detached baseline worktree and install the exact lockfile in both worktrees:

```sh
git worktree add .worktrees/ps-4xm-baseline 06e627a
bun install --frozen-lockfile --ignore-scripts
```

Run each measurement from the corresponding worktree:

```sh
tokei packages/pi-stuff/src --types TypeScript,JavaScript
node -e 'const p = require("./packages/pi-stuff/package.json"); console.log(Object.keys(p.dependencies ?? {}).length)'
bun pm ls --all | wc -l

mkdir -p /tmp/pi-stuff-pack-measurement
(cd packages/pi-stuff && bun pm pack --destination /tmp/pi-stuff-pack-measurement)
stat -c %s /tmp/pi-stuff-pack-measurement/jczhang02-pi-stuff-0.3.3.tgz
tar -tvzf /tmp/pi-stuff-pack-measurement/jczhang02-pi-stuff-0.3.3.tgz \
  | awk '{ bytes += $3; files += 1 } END { print files, bytes }'

bun scripts/benchmark-lifecycle.ts \
  --pi "$PI_BIN" \
  --variants suite \
  --scenarios fresh \
  --actions exit \
  --sizes 80x24 \
  --samples 5 \
  --warmups 1 \
  --output /tmp/pi-stuff-lifecycle.json

TIMEFMT='%M'
time bun scripts/benchmark-lifecycle.ts \
  --pi "$PI_BIN" \
  --variants suite \
  --scenarios fresh \
  --actions exit \
  --sizes 80x24 \
  --samples 1 \
  --warmups 1 \
  --output /tmp/pi-stuff-rss.json >/dev/null

time bun run check:fast
PI_BIN="$PI_BIN" bun run check
```

`PI_BIN` must point to the certified Pi release binary verified by `scripts/verify-pi-host-provenance.ts`.
