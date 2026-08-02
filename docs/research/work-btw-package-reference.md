# Work BTW Package reference

**Audit date:** 2026-08-01  
**Certified Host:** Pi 0.83.0, Linux x64  
**Decision:** Select an owned fork of `@juicesharp/rpiv-btw@2.3.1`; do not fork `@narumitw/pi-btw`

## Decision

Pi Stuff should fork [`@juicesharp/rpiv-btw@2.3.1`](https://registry.npmjs.org/@juicesharp%2Frpiv-btw/2.3.1) from source commit [`75823a68024a0a649cc28087976074be791ca554`](https://github.com/juicesharp/rpiv-mono/tree/75823a68024a0a649cc28087976074be791ca554/packages/rpiv-btw).

This supersedes the earlier working assumption that `@narumitw/pi-btw` was the leading fork candidate. The earlier assumption was reasonable before the BTW product shape was fixed. After the maintainer selected the current Claude Code lifecycle—one no-tool question, one answer, no follow-up composer—the narrower rpiv Package is the better capability base.

The selection is a source-base decision, not approval of the upstream UI. Pi Stuff will preserve the useful request, context, cancellation, and budget mechanics while replacing the floating overlay and removing behavior that does not belong in the selected product.

No fork has been imported or implemented as part of this audit.

## Product contract used for the comparison

The accepted BTW behavior is recorded in [Work BTW UI reference](./work-btw-ui-reference.md). In concrete use:

1. The main Agent is still working and the user submits `/btw <question>`.
2. BTW sees the current parent conversation but receives no tools.
3. One independent model request produces one answer. There is no BTW composer for a follow-up turn.
4. The question and answer never enter the main transcript or main model context.
5. Earlier session-local exchanges can be reopened, browsed, and cleared as display history.
6. Cancelling BTW never cancels the main Agent.
7. Tool-requiring or continuing work is promoted to the Agent/session system.
8. Pi Stuff renders BTW through the shared full-width, divider-led, non-floating Command Dialog and restores the exact prior editor and Suite chrome afterward.

This follows Anthropic's current [`/btw` documentation](https://code.claude.com/docs/en/interactive-mode#side-questions-with-btw): the side call sees the current conversation, has no tools, runs independently during a main turn, produces one response, and keeps its question and answer out of the conversation history. The same documentation says continuing the thread requires forking it into a session; earlier exchanges remain available as overlay history.

## Selected source identity

| Fact | Verified value |
| --- | --- |
| Package | `@juicesharp/rpiv-btw` |
| Version | `2.3.1`, published 2026-07-31 |
| Exact source revision | `75823a68024a0a649cc28087976074be791ca554` |
| License | MIT, copyright 2026 juicesharp |
| npm downloads, 2026-07-02 through 2026-07-31 | 4,700 |
| npm archive | `https://registry.npmjs.org/@juicesharp/rpiv-btw/-/rpiv-btw-2.3.1.tgz` |
| npm integrity | `sha512-6gK0z43D90AVe/+Pu248VCRPFSBpnsXe0b9uGSDVRUmZGAvIsGhWIW+4fVo5aq4cQ+07MO5IdOlVE1ngkzZ82g==` |
| Locally observed archive SHA-256 | `5318bbf4256b83825cb56a314bdbfa605e495e68043d83a169a65dd35ceabf59` |
| Published size | 71,499 bytes unpacked |
| Production TypeScript | 1,267 lines across six files |
| Upstream tests | 1,811 TypeScript lines; 111 tests in six files |
| Runtime dependencies | None; only Pi peer dependencies |
| Upstream development Pi | 0.80.5 |

Sources: the exact [npm registry record](https://registry.npmjs.org/@juicesharp%2Frpiv-btw/2.3.1), fixed-window [npm download record](https://api.npmjs.org/downloads/point/2026-07-02:2026-07-31/%40juicesharp%2Frpiv-btw), exact [manifest](https://github.com/juicesharp/rpiv-mono/blob/75823a68024a0a649cc28087976074be791ca554/packages/rpiv-btw/package.json), and exact [MIT license](https://github.com/juicesharp/rpiv-mono/blob/75823a68024a0a649cc28087976074be791ca554/packages/rpiv-btw/LICENSE).

Every source, documentation, prompt, manifest, and license file in the npm archive matched the corresponding file at the recorded Git revision byte for byte. Version 2.3.1 changes only release metadata relative to 2.3.0; it is nevertheless the correct immutable npm/source identity to record.

## What is worth keeping from the selected base

The selected Package already implements most of the difficult non-UI boundary:

- one `/btw <question>` command rather than a second Agent or tool surface;
- a parent-branch clone produced through Pi's message conversion rather than a hand-built prose summary;
- explicit `tools: []` on the side request;
- the current main model and its normal Pi credential resolution;
- an independent `AbortController`, so BTW cancellation cannot signal the main turn;
- branch-snapshot invalidation on compaction and tree changes;
- bounded context accounting, history capping, branch trimming, and one context-overflow retry;
- no transcript entry and no durable write of the answer;
- a focused test suite for budgeting, context assembly, lifecycle, errors, cancellation, UI width, and Host API compatibility.

These mechanisms are visible in the exact [request implementation](https://github.com/juicesharp/rpiv-mono/blob/75823a68024a0a649cc28087976074be791ca554/packages/rpiv-btw/btw.ts), [context model](https://github.com/juicesharp/rpiv-mono/blob/75823a68024a0a649cc28087976074be791ca554/packages/rpiv-btw/docs/context-model.md), and [architecture record](https://github.com/juicesharp/rpiv-mono/blob/75823a68024a0a649cc28087976074be791ca554/packages/rpiv-btw/docs/architecture.md).

This is a substantially smaller ownership boundary than the previous candidate and has no additional runtime Package to fork or pin.

## Required owned-fork changes

The upstream Package is a base, not the finished Pi Stuff Capability. The fork must make these deliberate changes before entering the default Suite:

1. **Replace the overlay completely.** Upstream uses a bottom-centered floating overlay. Pi Stuff must route BTW through the shared non-overlay Command Dialog coordinator, hide the ordinary footer/statusline while it owns focus, and restore the exact editor draft, Todo, Agent roster, and prior Command Dialog state.
2. **Keep exactly one answer.** Do not add a BTW composer after completion. Bare `/btw` reopens the most recent exchange; history navigation and clearing remain display actions.
3. **Do not turn repeated invocations into a hidden multi-turn chat.** Upstream feeds prior BTW turns into later model requests. Pi Stuff should keep prior exchanges for browsing but build a new request from the parent conversation plus the current side question. Continuing an exchange belongs in a forked Agent/session.
4. **Remove cross-session question hints.** Upstream adds the last ten BTW question strings from other sessions to the system prompt. Pi Stuff's BTW history is session-local; unrelated sessions must not silently influence a side answer.
5. **Stream the answer in place.** Upstream waits on `completeSimple` and swaps the loader for the complete answer. Pi 0.83 exposes a provider-neutral `streamSimple` path; the fork should project incremental text through the Command Dialog while retaining the independent abort signal and `tools: []` contract.
6. **Keep the robust parent-context path.** Retain Pi message conversion, compaction/tree invalidation, context budgeting, and overflow retry. Add coverage for a main turn that is still streaming when BTW snapshots its context.
7. **Use the current main model by default.** Do not inherit a Package-specific model picker or thinking settings screen. A future Suite-wide model choice can be added only if it becomes a separately justified decision.
8. **Integrate with shared surface priority.** A destructive-safety prompt or genuinely human-required Agent question may suspend BTW; resolving it restores the exact BTW state. Completion, failure, and ordinary Agent status never steal BTW focus.
9. **Preserve provenance visibly.** Keep the MIT notice, exact upstream revision and archive identity, and a maintained local-change record. The Aggregate Package must depend on the owned Capability Package, never on the upstream npm Package.

Whether display history remains process-memory-only or is stored as invisible session state across a fresh Pi restart is still a later persistence decision. It does not change the selected source base.

## Why `@narumitw/pi-btw` is no longer the selected base

The current Package is [`@narumitw/pi-btw@0.43.0`](https://registry.npmjs.org/@narumitw%2Fpi-btw/0.43.0), source commit [`aceaf779b17655d9102d84a5352984408432b8e3`](https://github.com/narumiruna/pi-extensions/tree/aceaf779b17655d9102d84a5352984408432b8e3/extensions/pi-btw), MIT licensed. It reported 7,640 downloads in the same fixed window, develops directly against Pi 0.83.0, and has a serious test suite. It is a credible Package, not a rejected-quality Package.

Its product and ownership shape are now wrong for Pi Stuff:

- it intentionally opens an ephemeral multi-turn side workspace with its own composer;
- successful earlier side turns are fed into later turns;
- it includes detailed bring-to-main selection and preview flows;
- version 0.43.0 adds its own start/settings menu and persistent model-thinking controls;
- its 2,741 production TypeScript lines depend on `@narumitw/pi-tui-kit` through the floating range `^0.42.0`; the currently resolved 0.42.1 UI library has another 3,516 production TypeScript lines;
- most of that surface would be deleted or replaced to obtain the already-selected single-exchange Capability.

The exact 0.43.0 archive matched its Git revision. Against Pi 0.83.0, its Package typecheck passed, 119 Package tests passed, and the real Host loaded `/btw` without an Extension error. The decision therefore rests on product fit and fork size, not compatibility failure. Sources: exact [manifest](https://github.com/narumiruna/pi-extensions/blob/aceaf779b17655d9102d84a5352984408432b8e3/extensions/pi-btw/package.json), [README](https://github.com/narumiruna/pi-extensions/blob/aceaf779b17655d9102d84a5352984408432b8e3/extensions/pi-btw/README.md), [license](https://github.com/narumiruna/pi-extensions/blob/aceaf779b17655d9102d84a5352984408432b8e3/extensions/pi-btw/LICENSE), and fixed-window [downloads](https://api.npmjs.org/downloads/point/2026-07-02:2026-07-31/%40narumitw%2Fpi-btw).

## Other credible mature alternative

[`pi-btw@0.4.1`](https://registry.npmjs.org/pi-btw/0.4.1) had the largest fixed-window adoption signal at 8,391 downloads and is MIT licensed. Its exact source is commit [`4f858102706910ee9d520a9666832f3103631b61`](https://github.com/dbachelder/pi-btw/tree/4f858102706910ee9d520a9666832f3103631b61). The real Pi 0.83 Host loaded its eight commands without an Extension error.

It is not a credible base for the selected Capability because it creates a real, tool-enabled Pi sub-session with read, shell, edit, and write access; maintains a continuing side conversation; supplies injection and summarization commands; and uses a focused floating modal. Those are useful capabilities, but they duplicate the already-selected multi-Agent kernel and contradict BTW's no-tool, single-response boundary. Download count cannot repair that product mismatch. Sources: exact [README](https://github.com/dbachelder/pi-btw/blob/4f858102706910ee9d520a9666832f3103631b61/README.md), [manifest](https://github.com/dbachelder/pi-btw/blob/4f858102706910ee9d520a9666832f3103631b61/package.json), and fixed-window [downloads](https://api.npmjs.org/downloads/point/2026-07-02:2026-07-31/pi-btw).

Lower-adoption packages were screened but do not displace these three. Packages built around multiple slots, persistent sidecar Agents, answer injection, or tool-enabled panes fail the accepted product boundary. Smaller one-shot implementations have weaker adoption and test evidence than the selected rpiv base.

## Pi 0.83 verification performed

The exact `@juicesharp/rpiv-btw@2.3.1` production source is unchanged from the locally checked 2.3.0 source; 2.3.1 changes only Package release metadata. With exact Pi AI, coding-agent, and TUI 0.83.0 installed:

- all **111** rpiv BTW tests passed;
- strict TypeScript checking passed for production and test files;
- the exact published npm Package loaded through the real Pi 0.83.0 RPC Host;
- `/btw` registered and the Host emitted no Extension error.

The same compatibility lane established that current `@narumitw/pi-btw@0.43.0` typechecks, passes **119** Package tests, and loads `/btw` through the real Pi 0.83.0 Host. The unscoped `pi-btw@0.4.1` archive also loaded and registered its command family.

These checks made no model request and used no credentials. They prove source compatibility, tested logic, import/startup behavior, and command registration. They do not yet certify real provider streaming, concurrent main/BTW model calls, terminal focus arbitration, session switching during a late result, or the rewritten Command Dialog. Those are implementation acceptance gates.

## Fork acceptance gates

Before the owned fork becomes a default Capability, it must pass:

- real Pi 0.83 tests for one concurrent main turn and BTW call;
- an assertion that every BTW request carries `tools: []` and has its own abort signal;
- no main transcript/custom-entry mutation for routine BTW history;
- incremental answer, error, cancellation, and empty-answer states;
- branch switch, compaction, context overflow, and stale-late-result cases;
- exact suspension and restoration when a higher-priority Suite surface appears;
- terminal interaction at `100 × 32` and `64 × 28`, including scrolling and draft restoration;
- no floating overlay, no statusline entry, and zero BTW rows while closed;
- a packed-archive audit covering files, exact Pi peers, preserved MIT notice, bundled-dependency rules, and the local-change record.

## Final selection statement

Pi Stuff will use an owned fork of **`@juicesharp/rpiv-btw@2.3.1` at `75823a68024a0a649cc28087976074be791ca554`** as the BTW capability base. `@narumitw/pi-btw` remains useful comparison evidence but is not the fork base. `pi-btw` is excluded because it is another tool-capable Agent system rather than the accepted lightweight side question.
