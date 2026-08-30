# Effect v4 adoption baseline

**Measurement date:** 2026-08-30  
**Beads:** `ps-pby`, `ps-pby.1`  
**Baseline commit:** `d45db1a7fa6a60defd822c42d3b103be567ac66a`  
**Certified Host:** Pi `0.84.4+source.b79e4cc83497.binary.ce91e1f8bff6.bun.1.3.14`, Linux x64  
**Repository toolchain:** Bun `1.4.0`, TypeScript `5.9.3`

This report freezes the pre-migration evidence required to compare the completed Effect implementation with the same
Pi Stuff source and Host profile. The measurements were captured before `effect` entered either manifest or the lockfile.
They do not decide whether the experiment should merge.

## Baseline summary

| Measure | Pre-migration baseline |
| --- | ---: |
| Package `src/` TS/JS files | 481 |
| Package `src/` TS/JS physical lines | 120,140 |
| Package `src/` TS/JS code lines | 107,857 |
| Direct runtime dependencies | 19 |
| Installed dependency-tree entries | 433 |
| Packed files | 564 |
| Packed archive | 4,521,469 bytes |
| Unpacked file bytes | 11,827,546 bytes |
| Fresh-process startup p50 | 5,410.89 ms |
| Fresh-process startup p95 | 7,394.82 ms |
| Fresh-process shutdown p50 | 124.64 ms |
| Fresh-process shutdown p95 | 138.18 ms |
| Maximum Host benchmark RSS | 206,116 KiB |
| Warm typecheck wall time | 59.60 s |

The package manifest had zero trusted dependencies. Tokei counted five JavaScript files and 476 TypeScript files under
`packages/pi-stuff/src`. The dependency-tree figure counts lines printed by `bun pm ls --all`; it is not a count of
unique package identities.

## Lifecycle and branching census

The lifecycle census records syntax that the migration intends to contract. It is evidence, not a completeness rule:
native adapters will retain the primitives required to control their external resources.

| Syntax | Count |
| --- | ---: |
| `let` declarations | 1,290 |
| Non-`readonly` class properties | 520 |
| `new Promise` | 73 |
| `new AbortController` | 26 |
| `setTimeout` | 72 |
| `setInterval` | 20 |
| `new Worker` | 1 |
| `fetch` calls | 31 |
| `Bun.spawn` calls | 2 |
| `spawn` / `execFile` / `fork` calls | 21 |

| Branch syntax | Count |
| --- | ---: |
| `if` statements | 10,804 |
| Conditional expressions | 3,407 |
| `switch` statements | 47 |
| `case` clauses | 302 |
| Loops | 1,129 |
| `catch` clauses | 1,121 |
| `&&`, `||`, and `??` expressions | 8,271 |

The AST census used TypeScript 5.9.3 over every TS/JS source file. A mutable class property is a `PropertyDeclaration`
without a `readonly` modifier. Loops include `for`, `for in`, `for of`, `while`, and `do`. Primitive counts use exact
source-token patterns and therefore remain a review aid rather than semantic call-graph proof.

## Runtime method

The lifecycle benchmark used one retained warmup followed by five measured `suite/fresh/exit/80x24` samples. Every
sample launched a new certified Pi process with a cold process-local Suite module cache; executable and filesystem
caches were warm, and global kernel caches were not dropped. The five measured startup samples were 4,475.81,
4,785.86, 5,410.89, 7,394.82, and 6,501.81 ms. Shutdown samples were 105.36, 138.18, 124.64, 135.38, and 121.39 ms.

RSS came from an independent one-warmup/one-sample lifecycle batch under the zsh `time` builtin. Typecheck received one
warmup before the measured five-project command. These timings reflect this machine on the measurement date; the final
comparison must repeat the same commands and sampling model instead of comparing against a differently warmed run.

## Reproduction

Run from the compared worktree with the certified release binary selected through `PI_BIN`:

```sh
tokei packages/pi-stuff/src --types TypeScript,JavaScript
bun pm ls --all
(cd packages/pi-stuff && bun pm pack --destination "$PACK_DIR")
tar -tvzf "$PACK_DIR/jczhang02-pi-stuff-0.3.3.tgz"

bun scripts/benchmark-lifecycle.ts \
  --pi "$PI_BIN" \
  --variants suite \
  --scenarios fresh \
  --actions exit \
  --sizes 80x24 \
  --samples 5 \
  --warmups 1 \
  --output "$LIFECYCLE_REPORT"

TIMEFMT='max_rss_kib=%M wall_seconds=%E'
time bun scripts/benchmark-lifecycle.ts \
  --pi "$PI_BIN" \
  --variants suite \
  --scenarios fresh \
  --actions exit \
  --sizes 80x24 \
  --samples 1 \
  --warmups 1 \
  --output "$RSS_REPORT"

bun run typecheck
TIMEFMT='wall_seconds=%E max_rss_kib=%M'
time bun run typecheck
```

The final comparison must also rerun the documented TypeScript AST node census with the same node definitions above.
