# Effect v4 adoption assessment for Pi Stuff

**Research date:** 2026-08-10  
**Pi Stuff snapshot:** `295508c1e37623fc77064111be337847c616d627`  
**Certified runtime:** Bun 1.3.14, Pi 0.84.1, Linux x64  
**Question:** Should Pi Stuff adopt Effect v4, and would doing so improve correctness, code volume, startup, or shutdown behavior?

## Evidence labels

- **Official fact** means the claim is directly supported by Effect's official website, tagged source, release notes, migration material, or npm Registry metadata.
- **Local measurement** means the result was reproduced against the repository snapshot and certified Bun version described above.
- **Inference** means an architectural conclusion drawn from official facts and local repository evidence; it is not a promise made by Effect.
- **Recommendation** is the resulting decision for Pi Stuff.

## Executive decision

**Recommendation: do not add Effect v4 beta to Pi Stuff's shipped production dependency graph now. Do run one bounded, disposable core-only spike, then reassess after v4 reaches a stable release.**

This is not a rejection of Effect's programming model. Its typed error channel, structured concurrency, scopes, schedules, services, and testable time model fit several of Pi Stuff's hardest in-process lifecycle problems. The strongest potential targets are the Background Work notification/retry loop and a narrowly selected Agent task lifecycle.

The present adoption case nevertheless fails four project-specific gates:

1. **Stability:** npm still marks v3 as `latest` and v4 as `beta`; the official migration guide says APIs may change between beta releases. The current beta is `4.0.0-beta.106`, published on 2026-08-08. [Official npm metadata](https://registry.npmjs.org/effect) and the [beta.106 pre-release](https://github.com/Effect-TS/effect/releases/tag/effect%404.0.0-beta.106) establish this directly.
2. **Startup:** Pi Stuff ships TypeScript source and eagerly imports every Capability factory. It does not get application-bundle tree shaking before Pi loads the Suite. In a 30-process Bun 1.3.14 probe, importing `effect/Effect` added about 27 ms to median fresh-process elapsed time and about 18 MB to median RSS; importing the root `effect` entry added about 89 ms and about 49 MB. These are isolated import costs, not a full Pi startup benchmark, but they conflict with the current startup/exit latency objective.
3. **Distribution:** npm reports `effect@4.0.0-beta.106` as 44,637,554 bytes across 2,263 unpacked files. The downloaded official tarball measured 8,028,616 bytes. A throwaway package that bundled Effect's runtime closure measured 9,152,027 compressed bytes, while a paired rebuild of Pi Stuff's current aggregate measured 21,325,131 bytes. These package measurements are not the same as tree-shaken application code, but Pi Stuff distributes bundled runtime dependencies. The dependency would materially expand installation and release verification unless a future packaging design proves otherwise.
4. **Scope of benefit:** Effect can replace in-process Promise, timer, retry, cancellation, resource, and dependency plumbing. It cannot replace Pi Host lifecycle contracts, authenticated process identity, child-process supervision, durable artifacts, crash recovery, inter-process claims, or TUI restoration authority. Those account for much of the complexity in the largest Pi Stuff runtimes.

The defensible position today is therefore:

| Adoption level | Decision | Reason |
| --- | --- | --- |
| Suite-wide runtime and service architecture | **Reject now** | Beta lock-in, startup and package cost, dual runtime model, migration blast radius |
| TUI startup/exit path | **Reject** | The observed eager import cost works against the performance goal; Host-owned UI cleanup remains required |
| `effect/unstable/*` modules | **Reject** | Officially allowed to break in minor releases even after v4 stabilizes |
| Core-only disposable spike | **Recommend** | Can test whether Scope, Schedule, typed errors, and Fiber cancellation actually remove local lifecycle code |
| Production use after stable v4 | **Conditional** | Only if the spike passes explicit size, startup, shutdown, correctness, and maintainability gates |

## What Effect v4 actually is

### The central contract

**Official fact.** The tagged v4 source defines `Effect<A, E, R>` as a lazy description of a workflow that may succeed with `A`, fail with an expected error `E`, and require services `R`. Creating an Effect does not run it; an Effect runner interprets it. The type and constructors are documented in the [beta.106 `Effect.ts`](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/Effect.ts).

That is a broader contract than `Promise<A>`:

| Concern | Native TypeScript surface | Effect surface |
| --- | --- | --- |
| Success | `Promise<A>` | `A` in `Effect<A, E, R>` |
| Expected failure | Convention, thrown `unknown`, or a hand-written result union | `E` in the type |
| Required services | Imports, closures, parameters, or local option objects | `R`, supplied through Context/Layer |
| Cancellation | Manually propagated `AbortSignal` | Fiber interruption, with adapters still required at Promise/Host boundaries |
| Resource release | `try/finally`, `using`, or manual ownership | Scope and finalizers |
| Retry/repetition | Timers and loops | Composable Schedule |
| Concurrency ownership | Promise bookkeeping | Fiber hierarchy and structured concurrency |
| Diagnostics | Error stacks and local logging | Cause, annotations, tracing, logging, and metrics |

### Runtime, fibers, interruption, and resources

**Official fact.** Effect executes concurrent work in lightweight Fibers. A Fiber can be awaited, joined, or interrupted. Child fibers can be lifecycle-bound to their parent, while detached fibers deliberately outlive that parent. v4 also changed fork naming and options, including start behavior. See the tagged [Fiber source](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/Fiber.ts) and [v4 forking migration note](https://github.com/Effect-TS/effect-smol/blob/main/migration/forking.md).

**Official fact.** Scope is a resource-lifetime boundary. Closing a Scope executes registered finalizers with a defined sequential or parallel strategy. Layer describes construction of services, their build-time requirements and errors, and scoped resource ownership. See the tagged [Scope](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/Scope.ts) and [Layer](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/Layer.ts) sources.

**Official fact.** `Effect.tryPromise` can bridge Promise APIs and receives an `AbortSignal` that is aborted when the Effect is interrupted. The official source also warns that the underlying asynchronous operation stops only if it observes that signal. See [`tryPromise` in `Effect.ts`](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/Effect.ts).

**Inference for Pi Stuff.** Effect would improve the expression of in-process ownership, but cancellation does not automatically terminate a child process, authenticate a PID, reap descendants, or persist a terminal outcome. Pi Stuff must continue to connect interruption to its existing process supervisor and durable state machine. An Effect Fiber is not a replacement for a durable OS-process supervisor.

### Errors and diagnostics

**Official fact.** Expected failures live in `E`; full failure diagnostics are represented by Cause and can include typed failures, defects, and interruption. v4 flattened the v3 recursive sequential/parallel Cause tree into a collection of reasons, so the old combination shape is no longer preserved in the data structure. See the tagged [Cause source](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/Cause.ts) and [Cause migration note](https://github.com/Effect-TS/effect-smol/blob/main/migration/cause.md).

**Inference for Pi Stuff.** Typed operational failures would be useful in boundaries that currently convert `unknown` into strings or repeatedly classify errors. They would not remove the need to distinguish authoritative terminal outcomes from best-effort cleanup failures. The Background Work runtime intentionally preserves those distinctions, so its domain outcome types remain necessary even if their orchestration becomes Effect-based.

### Services, layers, and tests

**Official fact.** Context is a typed map from service identifiers to implementations. v4 unifies service definitions around `Context.Service`. Layer builds and composes services, can own scoped resources, and memoizes construction. v4 changed memoization across repeated `Effect.provide` calls: sharing is now the default unless local/fresh behavior is requested. See the tagged [Context source](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/Context.ts), [services migration](https://github.com/Effect-TS/effect-smol/blob/main/migration/services.md), and [Layer memoization migration](https://github.com/Effect-TS/effect-smol/blob/main/migration/layer-memoization.md).

**Inference for Pi Stuff.** Context and Layer could replace some large option objects and make Clock, filesystem, subprocess, notification, and storage dependencies explicit. However, Pi already supplies the authoritative `ExtensionAPI` and lifecycle callbacks. A Suite-global Effect service graph would duplicate Host ownership and make shutdown ordering harder to audit. If used, an Effect runtime must remain inside one Capability and have an explicit session owner.

### Stream and Schema

**Official fact.** `Stream<A, E, R>` models a multi-value, effectful source. The tagged source describes it as pull-based, backpressured, and chunked to amortize execution overhead. See [beta.106 `Stream.ts`](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/Stream.ts).

**Official fact.** Schema is part of the v4 core package and covers runtime decoding/validation, encoding, transformations, refinements, JSON Schema, arbitrary data generation, formatters, equivalence, optics, and diffing. See [beta.106 `Schema.ts`](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/Schema.ts).

**Inference for Pi Stuff.** Stream may fit event feeds and bounded output processing, but replacing existing Pi TUI/event surfaces would be a large adapter project. Schema should not be adopted incidentally: the Suite already ships Zod through the aggregate and TypeBox through several Capabilities. Adding Effect Schema creates a third schema language unless a separate, evidence-backed consolidation removes the others.

## Current v4 status and stability

### Release state

**Official fact.** As of the research date, npm Registry tags are:

| Tag | Version | Published |
| --- | --- | --- |
| `latest` | `3.22.1` | 2026-07-30 |
| `beta` | `4.0.0-beta.106` | 2026-08-08 |

The registry has published 104 distinct `4.0.0-beta.*` versions since `beta.0` on 2026-02-18. The official GitHub release labels beta.106 as a pre-release. Sources: [npm Registry metadata](https://registry.npmjs.org/effect) and [beta.106 release](https://github.com/Effect-TS/effect/releases/tag/effect%404.0.0-beta.106).

**Official fact.** The official v3-to-v4 guide states that v4 is in beta and APIs may change between beta releases. It also states that core concepts remain, while package organization, versioning, imports, and APIs change substantially. See [Migrating from Effect v3 to Effect v4](https://github.com/Effect-TS/effect-smol/blob/main/MIGRATION.md).

**Official fact.** beta.106 still contains correctness fixes in shared resource generations, interrupted queues, Fiber error typing, resource leaks, scoped replacement cleanup, worker pools, and shutdown hangs. It also removes or consolidates Schema APIs and changes an encrypted event-log wire shape. This is visible in the [beta.106 release notes](https://github.com/Effect-TS/effect/releases/tag/effect%404.0.0-beta.106).

**Inference.** A high patch cadence is healthy maintenance activity, but it also means Pi Stuff would be accepting semantic and migration churn while trying to stabilize its own process and TUI lifecycle. Exact version pinning controls surprise installation changes; it does not eliminate the cost of future upgrades or security/correctness backports.

### Stable versus unstable namespace

**Official fact.** v4 consolidates many former ecosystem packages into `effect` and synchronizes versions across packages. Platform-, provider-, and technology-specific packages remain separate. The official migration guide says `effect/unstable/*` modules may receive breaking changes in minor releases, while modules outside that namespace follow strict semver after stabilization. See the [migration overview](https://github.com/Effect-TS/effect-smol/blob/main/MIGRATION.md).

**Official fact.** The beta.106 package export map puts AI, CLI, cluster, devtools, encoding, event log, HTTP, HTTP API, observability, persistence, process, reactivity, RPC, schema internals, socket, SQL, workflow, and workers under `effect/unstable/*`. See the tagged [package export map](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/package.json).

**Recommendation.** A Pi Stuff spike should use only top-level core modules such as `effect/Effect`, `effect/Scope`, `effect/Schedule`, `effect/Layer`, and optionally `effect/Schema`. It should not use `effect/unstable/process`, HTTP, RPC, workflow, worker, or observability APIs as architecture foundations.

### v3-to-v4 migration implications

Pi Stuff does not currently use Effect v3, so it does not owe a v3 migration. The migration surface still matters because it demonstrates how deeply the framework can shape application code and how expensive a future major upgrade can be.

**Official facts include:**

- service definitions consolidate on `Context.Service`, and automatic `.Default` Layer generation changes ([services migration](https://github.com/Effect-TS/effect-smol/blob/main/migration/services.md));
- catch operators were renamed or removed ([error-handling migration](https://github.com/Effect-TS/effect-smol/blob/main/migration/error-handling.md));
- many previously Effect-subtyped structures became narrower Yieldables, requiring explicit `Ref.get`, `Deferred.await`, or `Fiber.join` ([Yieldable migration](https://github.com/Effect-TS/effect-smol/blob/main/migration/yieldable.md));
- `Runtime<R>` was removed in favor of Effect-level execution and application-lifecycle runtime APIs ([Runtime migration](https://github.com/Effect-TS/effect-smol/blob/main/migration/runtime.md));
- structural equality defaults changed for ordinary arrays and objects ([equality migration](https://github.com/Effect-TS/effect-smol/blob/main/migration/equality.md));
- Schema migration includes removals and semantic rewrites, not only import changes ([Schema migration](https://github.com/Effect-TS/effect-smol/blob/main/migration/schema.md)).

**Inference.** If Effect becomes pervasive, leaving it later is also an architectural migration. Adoption should therefore be judged as a programming-model commitment, not as adding a small Promise helper library.

## Verified advantages for Pi Stuff

### 1. Lifecycle correctness can become compositional

**Official fact.** Scope and finalizers provide a standard ownership model across success, expected failure, defect, and interruption.

**Local evidence.** [`packages/pi-stuff-work/src/runtime.ts`](../../packages/pi-stuff-work/src/runtime.ts) currently tracks completion and detach Promises, timeout handles, stop Promises, finalizing/finalized flags, launch identity, supervisor state, and several terminal/cleanup paths in one runtime. [`packages/pi-stuff-agents/src/runs/background/subagent-runner.ts`](../../packages/pi-stuff-agents/src/runs/background/subagent-runner.ts) combines child processes, writers, worktrees, durable events, steering, timeouts, and cleanup.

**Inference.** A Scope can make in-process timer/listener/temporary-resource cleanup single-owner and mechanically complete. It can reduce some hand-written `try/finally` and shutdown registration. It cannot remove the durable process state or domain terminal-state logic.

### 2. Cancellation and concurrency policy can be explicit

**Official fact.** Fibers, interruption, bounded concurrency, race, timeout, and schedule are first-class and compose under one runtime.

**Local evidence.** Pi Stuff currently coordinates Promise races, timeout timers, AbortSignals, notification retry, concurrent Agents, and shutdown waits in several independent modules. A heuristic scan of 298 product TypeScript files found 393 `AbortController`/`AbortSignal` occurrences and 269 timer API occurrences. These are search counts, not unique defects or guaranteed refactoring opportunities.

**Inference.** Effect could reduce accidental orphan work and make policies such as “cancel sibling work on failure,” “wait for all terminal receipts,” or “retry only this operational failure” easier to inspect. Any Promise/Host boundary still requires careful signal propagation.

### 3. Expected errors can be visible in function signatures

**Official fact.** The `E` parameter tracks expected failures and tagged recovery can target specific variants.

**Inference.** This is valuable for web/provider/auth/storage operations and background-task orchestration, where current `unknown` failures are repeatedly normalized. It is less valuable for small pure formatters and TUI render functions, where discriminated unions or ordinary exceptions are simpler.

### 4. Tests can control services and time

**Official fact.** Effect provides service Layers and a testing surface under `effect/testing`, including TestClock. The package also maintains separate Vitest integration. See the [v4 package exports](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/package.json), tagged [TestClock source](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/testing/TestClock.ts), and [migration overview](https://github.com/Effect-TS/effect-smol/blob/main/MIGRATION.md).

**Inference.** Clock and service substitution could simplify timer-heavy unit tests. Pi Stuff's final certification must still use Pi's real RPC/TUI/package-loader seams, so Effect test doubles cannot replace Host compatibility tests.

### 5. One coherent library can replace repeated utilities

**Official fact.** Effect includes Schedule, Queue, PubSub, caching, concurrency, resource, configuration, Stream, Schema, logging, tracing, and metrics primitives. The project officially describes incremental adoption as supported. See the [Effect website](https://effect.website/) and [package source tree](https://github.com/Effect-TS/effect/tree/effect%404.0.0-beta.106/packages/effect/src).

**Inference.** The value appears only if Pi Stuff removes several local mechanisms or one-off dependencies. Merely wrapping existing helpers in `Effect.gen` increases code and concepts without reducing ownership complexity.

## Verified disadvantages and risks

### 1. The framework has a real learning and review cost

**Official fact.** Effect's own website acknowledges a learning curve, a different programming style, and an extensive API surface. It presents `yield*`, `Effect.gen`, tagged errors, services, interruption, and scopes as a new model rather than ordinary async syntax. See the [official FAQ and trade-offs](https://effect.website/).

**Inference.** Reviewers must understand typed failures versus defects, interruption masking, Fiber ownership, Scope lifetime, Layer memoization, runtime boundaries, and Promise adapters. A locally shorter function can therefore have a higher cognitive cost for contributors unfamiliar with the model.

### 2. Pi Stuff would operate two async/lifecycle systems

**Local evidence.** Pi Extension callbacks and Tools expose `void | Promise`, receive Host `AbortSignal`s, and are owned by Pi lifecycle events. The generated aggregate [`packages/pi-stuff/index.ts`](../../packages/pi-stuff/index.ts) registers twelve Capability factories and ultimately returns a Promise.

**Inference.** Every Capability using Effect must enter with Host callbacks/signals and exit as a Promise. Misplacing `runPromise`, creating unmanaged runtimes, or detaching Fibers can undermine structured concurrency. The architectural rule must be “one explicit boundary and owner,” not ad hoc Effect execution throughout handlers.

### 3. Effect does not automatically reduce source volume

**Official fact.** Effect supplies reusable operators and runtime semantics, but no official source-LOC reduction guarantee exists.

**Local evidence.** Much of the largest Agent and Work code concerns durable protocol records, process identity, file ownership, artifacts, recovery, UI projection, and Host integration rather than generic Promise mechanics.

**Inference.** A migration may reduce `try/finally`, retry loops, timeout plumbing, and dependency threading while leaving most domain code intact. Service tags, Layers, error classes, adapters, and runtime boundaries can offset or exceed those savings. Source-volume improvement must be measured against an optimized native baseline.

### 4. The npm artifact is large even when application bundles can be small

**Official fact.** npm metadata for `effect@4.0.0-beta.106` reports 44,637,554 unpacked bytes and 2,263 files. The tagged manifest declares `sideEffects: []`, exports fine-grained subpaths, and publishes source, JavaScript, declarations, and source maps. See [npm metadata](https://registry.npmjs.org/effect/4.0.0-beta.106) and the [tagged manifest](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/package.json).

**Local measurement.** The downloaded official tarball was 8,028,616 bytes. To approximate this repository's `bundledDependencies` distribution model, a throwaway package with Effect as its only bundled runtime dependency was packed with the same release path. Its archive was 9,152,027 compressed bytes and 50,969,600 uncompressed tar bytes. A paired rebuild of the current Pi Stuff 0.3.3 aggregate was 21,325,131 compressed bytes and 122,322,432 uncompressed tar bytes. Effect's standalone bundled closure is therefore about 42.9% of the current aggregate's compressed size and 41.7% of its uncompressed tar size. This ratio is an incremental-cost proxy, not the exact final aggregate delta: shared dependencies, package-manager deduplication, tar metadata, and cross-package compression can change the result. A production prototype must pack the actual aggregate and compare it directly.

**Official claim, not a Pi Stuff measurement.** The migration overview says the rewritten v4 runtime reduces memory overhead and improves execution speed, and claims approximately 6.3 KB minified+gzip for a minimal Effect bundle and 15 KB with Schema. Effect's repository has a Rollup/minify/gzip [bundle measurement tool](https://github.com/Effect-TS/effect/blob/main/packages/tools/bundle/README.md) and a focused [runtime performance harness](https://github.com/Effect-TS/effect/blob/main/packages/effect/runtimeperf/README.md). No official end-to-end latency or memory SLA was found for Bun, Pi, Promise comparisons, or this Suite.

**Inference.** Tree-shaken application bundle size and package installation size answer different questions. Pi Stuff ships source and currently does not bundle its application into one optimized JavaScript entry, so it must evaluate runtime imports and npm distribution separately.

### 5. Root imports are expensive in the certified source-loading profile

**Local measurement.** The official `effect@4.0.0-beta.106` tarball was extracted in an isolated directory. Thirty fresh Bun processes were run per case on Linux x64 with Bun 1.3.14 and warm OS caches. Parent-observed elapsed time includes Bun startup and module loading; RSS is reported by the child after import.

| Fresh process case | Median elapsed | P95 elapsed | Median RSS | Delta from baseline |
| --- | ---: | ---: | ---: | ---: |
| Bun baseline, no Effect import | 13.97 ms | 16.99 ms | 25.56 MB | baseline |
| `import("effect/Effect")` | 40.89 ms | 53.46 ms | 43.54 MB | +26.93 ms, +17.98 MB |
| `import("effect")` | 102.46 ms | 113.56 ms | 74.19 MB | +88.50 ms, +48.63 MB |

This probe is not a full Pi TUI benchmark and should not be treated as a universal Effect overhead number. It does prove that import path and no-bundle ESM loading materially affect this project's runtime profile.

**Local measurement.** Bun 1.3.14 minified bundles of the same tiny programs produced:

| Entry style | Minified bytes | Gzip bytes |
| --- | ---: | ---: |
| Root import, `Effect.succeed(42)` | 86,182 | 29,933 |
| Subpath import, `Effect.succeed(42)` | 14,754 | 5,360 |
| Root imports with a small Schema decode | 273,325 | 84,424 |
| Subpath imports with a small Schema decode | 70,920 | 23,386 |

These numbers use Bun's bundler rather than Effect's Rollup tool and therefore do not contradict the official fixture; they show why the official 6.3/15 KB claim cannot be transferred to Pi Stuff without matching imports, bundler, versions, and entry behavior.

**Recommendation.** If a spike proceeds, use fine-grained subpath imports and verify that no eagerly loaded aggregate path imports the root package. Prefer a lazy, user-triggered experiment so Effect is absent from Suite startup until needed.

### 6. v4 beta and unstable ecosystem APIs increase maintenance risk

**Official fact.** The core programming model persists, but v4 includes broad organizational and semantic changes. The official migration map records hundreds of module mappings and numerous API renames or missing correspondences. See the [complete import/API map](https://github.com/Effect-TS/effect-smol/blob/main/migration/v3-to-v4.md).

**Inference.** Pi Stuff's exact dependencies and certified Host policy favor predictable upgrades. An exact beta pin is necessary for a spike, but shipping it would add another high-churn certification axis.

### 7. Broad Schema adoption duplicates existing authority

**Local evidence.** [`packages/pi-stuff/package.json`](../../packages/pi-stuff/package.json) ships Zod 4.4.3, while Capability packages such as [`pi-stuff-work`](../../packages/pi-stuff-work/package.json) and [`pi-stuff-agents`](../../packages/pi-stuff-agents/package.json) ship TypeBox 1.3.7.

**Inference.** Using Effect Schema only because it is available would increase vocabulary, package reach, and migration cost. Any Schema adoption needs a separate consolidation decision with compatibility tests for Pi Tool schemas and existing serialized data.

## Fit by Pi Stuff area

| Area | Potential benefit | Main mismatch | Decision |
| --- | --- | --- | --- |
| Background Work notification retry and timeout policy | Schedule, typed errors, interruption, test clock | Must preserve Host notifications and terminal outcome authority | **Best spike candidate** |
| Background Work process ownership | Scope and finalizers can organize cleanup | Fibers cannot replace process identity, supervisor, reaping, recovery, or artifacts | Core remains native/durable |
| Agent foreground/background orchestration | Structured concurrency and typed terminal errors | Very large migration surface; persistent writers and steering outlive simple Fiber scopes | Later candidate only |
| MCP OAuth/network flows | Retry, timeout, Scope, typed errors | Existing adapter boundaries and credentials require careful audit | Plausible isolated future use |
| TUI startup and shutdown | Scope could centralize listeners/timers | Eager import cost; Pi owns TUI lifecycle and restoration | Do not use for startup path |
| Pure UI/rendering and formatters | Little | Effect ceremony exceeds problem complexity | Do not use |
| Tool schemas and serialized state | Schema could unify decoding | Zod and TypeBox already exist; migration and compatibility risk | Separate decision |
| Suite-wide dependency injection | Layer can express services | Duplicates Pi Host ownership and raises startup/runtime scope questions | Do not adopt |

## What Effect would and would not remove

### Likely removable or simplifiable

- timer-backed retry loops that have no durable external protocol;
- repeated timeout/race/AbortSignal glue inside one owned operation;
- some `try/finally` cleanup for in-process listeners, timers, handles, and temporary resources;
- manual dependency option plumbing for Clock, notifier, storage, and narrowly scoped adapters;
- repeated `unknown` error classification when errors are genuinely expected domain variants;
- some nondeterministic time-based unit-test seams.

### Still required

- Pi Extension, Tool, event, UI, and Session contracts;
- authenticated process identity and PID-reuse defenses;
- supervisor process protocol and TERM/KILL escalation;
- durable terminal receipts, artifacts, event logs, and crash recovery;
- cross-process kernel/filesystem claims and atomic persistence;
- bounded output, transcript, and nested-event projections;
- user-visible TUI restoration and single-authority UI rules;
- explicit cleanup behavior when a finalizer itself fails;
- integration and real-Host certification tests.

**Inference.** The largest value is not “replace all async code.” It is “make a small in-process lifecycle kernel deep and auditable while leaving durable and Host boundaries explicit.”

## Proposed bounded experiment

The experiment should live on a disposable branch or prototype directory and should not change production composition until it passes the gate.

### Candidate

Extract the Background Work notification retry/timeout orchestration from [`packages/pi-stuff-work/src/runtime.ts`](../../packages/pi-stuff-work/src/runtime.ts). This candidate has timers, retries, cancellation, shutdown interaction, and failure classification, but it does not own the core process-authentication protocol.

Implement two variants against the same tests:

1. an optimized native Promise/AbortSignal baseline;
2. an Effect v4 core-only implementation using subpath imports, typed operational errors, Schedule, Scope, and interruption.

Do not introduce Layer unless at least three real services require construction or scoped sharing. Do not use Stream, Schema, platform adapters, or any unstable module in the first spike.

### Required gates

| Gate | Pass criterion |
| --- | --- |
| Correctness | All existing Work runtime tests pass, including cancellation, timeout, shutdown races, cleanup failure, concurrent launch, and terminal outcome cases |
| Startup | No statistically meaningful regression in actual Pi cold startup; Effect must not be imported on the aggregate startup path |
| Exit | No increase in shutdown P95 and no extra lingering handles/Fibers |
| First use | Report the lazy-import penalty separately; it must not create a visible TUI stall |
| Code volume | At least 15% net reduction in production lifecycle code after counting error types, adapters, service definitions, and runtime ownership code |
| Tests | Fewer hand-written fake clocks/timer races without reducing real Host integration coverage |
| Distribution | Report aggregate tarball and installed file/byte delta; no accidental inclusion of unused unstable/platform modules |
| Typecheck | No material regression in complete `bun run typecheck` wall time or editor diagnostics |
| Maintainability | One documented Effect runtime owner, one Promise boundary, no detached Fiber without an explicit durable owner |
| Stability | Production promotion waits for a stable v4 release and repeats the spike on that exact version |

### Rejection conditions

Reject production adoption if any of the following occurs:

- the native baseline is similar in code volume and clarity;
- Effect enters the eager Suite import path;
- the implementation needs `effect/unstable/*` to be useful;
- process ownership or durable recovery becomes hidden behind generic Effect abstractions;
- the code requires multiple long-lived runtimes or repeated `runPromise` calls inside lower-level helpers;
- typed errors are immediately collapsed back to `unknown` or strings at most internal boundaries;
- package or first-use latency exceeds the user-visible benefit;
- the team cannot review interruption, Scope, and Layer semantics confidently.

## Final recommendation

**Do not ship Effect v4 beta in Pi Stuff now.** The official beta status and ongoing semantic fixes alone justify waiting for stable v4. Pi Stuff's source-shipping, eager aggregate import model adds a project-specific reason: runtime module loading matters more than Effect's tree-shaken application-bundle headline.

**Do authorize one narrow, lazy-loaded, core-only prototype.** Effect is unusually well matched to Pi Stuff's timer, cancellation, retry, and cleanup problems, and the repository has enough lifecycle complexity for the model to earn its keep. The prototype should target notification/retry orchestration, not TUI startup, whole-Suite dependency injection, Schema consolidation, or durable process supervision.

**Adopt after stable v4 only if measured evidence shows a deep-module win.** A credible win is not fewer lines in one happy-path function. It is a net reduction in lifecycle state and cleanup code, simpler deterministic tests, preserved process/Host authority, and no meaningful startup, exit, first-use, package, or typecheck regression.

Until those conditions are met, native Promise/AbortSignal plus the repository's explicit domain state machines remains the lower-risk production architecture.
