# Permission Capability package reference

**Audit date:** 2026-08-01  
**Product context:** Pi Stuff, with Pi 0.83.0 as the certified Host  
**Decision:** Selected — ship the permission engine, default to unrestricted work, and interrupt only for destructive safety tripwires

## Selected product direction

Pi Stuff includes a permission engine but does **not** use Claude Code's ordinary manual-approval mode by default. Reads, edits, normal shell commands, tests, and ordinary project work proceed without confirmation. The first release recognizes only a small, explicitly tested family of destructive shell and Git command shapes. It is a common-accident circuit breaker, not a general detector for “obviously wrong” behavior and not a security boundary.

The best available base is an owned, pinned fork of [`@gotgenes/pi-permission-system@24.0.0`](https://registry.npmjs.org/@gotgenes%2Fpi-permission-system/24.0.0), based on tag commit [`776ebcc764ca6c720b1f7eb430007de06f145b5f`](https://github.com/gotgenes/pi-packages/tree/776ebcc764ca6c720b1f7eb430007de06f145b5f/packages/pi-permission-system). It has by far the strongest adoption signal and the deepest policy, path, Bash, subagent-forwarding, and test infrastructure among the packages reviewed. It is nevertheless a young, rapidly changing, single-maintainer-heavy codebase, not a stable dependency Pi Stuff should follow automatically.

Adoption therefore means:

- fork the exact tag and keep the fork owned and version-pinned;
- certify it against Pi 0.83.0 and the selected `nicobailon/pi-subagents` fork;
- replace its conflicting UI and unsafe defaults before enabling it in the Aggregate Package;
- never load upstream `latest` or inherit upstream updates automatically.

The owned fork still must not enter the default Suite until the acceptance gates at the end of this report pass.

## Concrete A/B choice for the maintainer

**Maintainer decision:** B, amended to retain the complete permission infrastructure and a small set of safety tripwires that project content cannot relax. A remains available as an optional stricter mode in Settings; it is not the fresh-install behavior.

### A — Permissions are part of normal Pi Stuff use (research alternative)

Daily-use example:

1. You ask, “Fix the failing authentication tests.”
2. The Agent reads and searches the project without interrupting you.
3. Before the first edit or non-read-only shell action, a full-width, non-floating panel says exactly what the Agent wants to do.
4. You choose **allow once**, **allow for this session**, **deny**, or **deny with a reason**.
5. A configured hard deny, such as pushing to `main` or reading a protected secret, is blocked without asking.
6. If a direct child Agent needs approval, the same panel names that Agent. A session approval can apply only to that child or to the whole current session.

This is the mature-agent behavior the user recognizes from Claude Code: reading is quiet, consequential actions have a visible decision point, and repeated safe work can continue after one scoped approval. It also gives main-Agent and child-Agent permission requests one blocking decision path. Ordinary child questions remain a separate supervisor/reply lifecycle.

### B — Unrestricted normal work with destructive safety tripwires (selected)

The same task reads, edits, and runs shell tools without a Pi Stuff confirmation panel. The permission engine is still present. It stays silent unless a registered shell tool issues one of the explicitly recognized high-risk deletion or Git-discard command shapes.

When an outside-directory deletion or Git-discard target is explicit, the common full-width prompt asks about that exact call once. When the target cannot be resolved safely because of substitutions, unresolved variables, broad globs, parse failure, or unsupported nested forwarding, the operation is denied with a reason so the Agent can rewrite it as a concrete request. Deleting `/`, the resolved user home, the session working directory, the Git worktree root, or an equivalent “clear all contents” target is denied rather than offered for approval.

The earlier research recommendation was A because it most closely matched Claude Code's normal permission mode. The maintainer instead selected this B variant to preserve uninterrupted daily work while retaining protection against commands that are obviously too broad or destructive. This selected product preference overrides the research recommendation.

## Selected default policy

The first implementation uses three outcomes over a deliberately narrow command set:

- **Run silently:** ordinary reads, searches, edits, writes, builds, tests, normal shell commands, and explicitly named `rm`, `rmdir`, or `unlink` targets inside the session working directory that do not erase the directory as a whole.
- **Ask once:** statically resolved `rm`, `rmdir`, `unlink`, or `find -delete` targets outside the session working directory, plus tested Git forms that discard uncommitted work such as `reset --hard`, destructive `clean`, and discard forms of `restore` or `checkout`. Approval is bound to the exact tool, arguments, working directory, Agent, and request ID; it creates no session or persistent allow rule.
- **Deny and ask the Agent to rewrite:** `/`, the resolved user home, the session working directory, the Git worktree root, or an equivalent command that clears all of their contents; a destructive target containing unresolved variables, command/process substitution, unsafe glob expansion, an unrecognized wrapper, or a parse failure; and unsupported nested-Agent forwarding. Explicit user deny rules also remain hard denies.

The first guarantee covers Pi's registered shell tools and shell-like aliases explicitly enrolled in the fork. Direct child Agents receive the same guarantee only after end-to-end certification. It does not claim to detect equivalent deletion hidden inside Python/Node code, a generated script, arbitrary MCP tools, third-party Extension side effects, shell functions/aliases, or every wrapper, and it does not prevent symlink or time-of-check/time-of-use races. Unregistered shell-like Suite tools fail certification rather than silently bypassing the circuit breaker.

The circuit breaker runs before unrestricted mode, session allows, project rules, Agent definitions, skills, MCP content, child-Agent policy, and external authorizers. The stricter A behavior may be enabled deliberately through the native Settings surface. Neither mode adds a statusline indicator.

## Package identity and adoption evidence

The scoped package is not the old unscoped `pi-permission-system`:

| Fact, verified 2026-08-01 | `@gotgenes/pi-permission-system` |
| --- | --- |
| Latest npm version | `24.0.0`, published 2026-07-26 |
| Exact source base | tag commit `776ebcc764ca6c720b1f7eb430007de06f145b5f` |
| License | MIT |
| npm downloads, 2026-07-02 through 2026-07-31 | 31,300 |
| Published tarball | 377,037 bytes packed; 1,131,645 bytes unpacked; 145 files |
| Tarball SHA-256 observed locally | `0698d8b61ef1bcb197fae5987709e46a12290fb7bb07b4f35db369efcfcf0d32` |
| Runtime dependencies | `tree-sitter-bash`, `web-tree-sitter`, `zod` |
| Declared Pi peer range | coding-agent and TUI `>=0.79.0` |
| Upstream development Pi version | `0.79.1`, not `0.83.0` |

Sources: the [npm 24.0.0 registry record](https://registry.npmjs.org/@gotgenes%2Fpi-permission-system/24.0.0), the fixed-window [npm downloads API result](https://api.npmjs.org/downloads/point/2026-07-02:2026-07-31/%40gotgenes%2Fpi-permission-system), the [tagged package manifest](https://github.com/gotgenes/pi-packages/blob/776ebcc764ca6c720b1f7eb430007de06f145b5f/packages/pi-permission-system/package.json), and the [tagged MIT license](https://github.com/gotgenes/pi-packages/blob/776ebcc764ca6c720b1f7eb430007de06f145b5f/packages/pi-permission-system/LICENSE).

The adoption signal is unusually strong for a Pi permission package, but it must not be mistaken for long-term stability:

- npm lists 170 published versions between 2026-05-03 and 2026-07-26;
- versions 21, 22, 23, and 24 each introduced a breaking change within three days;
- the audited package path has 1,419 commits since May, with 1,354 authored by the primary maintainer and only three one-commit outside human contributors in the local shortlog;
- the source at the tag contains 124 TypeScript source files and approximately 16.1 K source lines; the repository carries 139 TypeScript test/helper files and approximately 37.9 K test lines.

The correct reading is **active, serious, and well tested, but high-churn and maintainer-concentrated**. An owned fork is required both by product policy and by engineering risk.

## What the package actually provides

### Policy surfaces

The package enforces `allow`, `ask`, and `deny` over registered tools, Bash commands, MCP operations, skills, paths, and outside-working-directory access. It filters denied tools before an Agent starts and enforces the decision again on `tool_call`. Bash is parsed with tree-sitter; path gates evaluate referenced and canonicalized paths; parse failures and internal gate failures fail closed. See the [tagged README](https://github.com/gotgenes/pi-packages/blob/776ebcc764ca6c720b1f7eb430007de06f145b5f/packages/pi-permission-system/README.md) and [configuration reference](https://github.com/gotgenes/pi-packages/blob/776ebcc764ca6c720b1f7eb430007de06f145b5f/packages/pi-permission-system/docs/configuration.md).

`allow` runs silently. `deny` blocks the tool and returns a reason to the Agent. `ask` opens a decision surface before the tool runs.

### Current prompt experience

In TUI mode, the current prompt is already structurally close to Pi Stuff's selected UI:

```text
Permission Required
Agent requested edit of src/auth.ts (one replacement ...)

▶ (y) Yes
  (s) Yes, for this session
  (n) No
  (r) No, provide reason
```

Arrow keys or `j`/`k` move, Enter confirms, and Escape denies. Letter shortcuts require a second identical press by default. The implementation uses non-overlay `ctx.ui.custom(..., { overlay: false })`, not a floating prompt. See the [inline prompt implementation](https://github.com/gotgenes/pi-packages/blob/776ebcc764ca6c720b1f7eb430007de06f145b5f/packages/pi-permission-system/src/authority/permission-prompt-component.ts#L26-L117) and [documented controls](https://github.com/gotgenes/pi-packages/blob/776ebcc764ca6c720b1f7eb430007de06f145b5f/packages/pi-permission-system/docs/configuration.md#inline-permission-dialog-tui).

The prompt summarizes built-in edits, writes, paths, Bash commands, and matched rules instead of showing an unbounded JSON object. Unknown Extension tools receive a bounded input preview.

“For this session” creates an in-memory wildcard rule. It survives ordinary work and resource reloads but is never written to disk and is cleared at `session_shutdown`; it does not survive a new Pi process or resumed session. See [`SessionRules`](https://github.com/gotgenes/pi-packages/blob/776ebcc764ca6c720b1f7eb430007de06f145b5f/packages/pi-permission-system/src/session-rules.ts#L7-L49) and the [session-approval reference](https://github.com/gotgenes/pi-packages/blob/776ebcc764ca6c720b1f7eb430007de06f145b5f/packages/pi-permission-system/docs/session-approvals.md).

### Direct child Agents

The selected `nicobailon/pi-subagents` candidate at audited commit [`f9aa1d22580657a267b946bd54b358c0a6440bf8`](https://github.com/nicobailon/pi-subagents/tree/f9aa1d22580657a267b946bd54b358c0a6440bf8) passes `PI_SUBAGENT_PARENT_SESSION` into child processes. `@gotgenes/pi-permission-system` recognizes that convention and writes a request into the parent session's forwarding inbox. The interactive parent polls the inbox and displays:

```text
Permission Required (Subagent)
Reviewer requested bash "npm test" ...
```

If the user chooses a session grant, a second step defaults to the least-privilege choice, **this named subagent only**, with **the whole session** as the alternative. The selected subagent's [integration documentation](https://github.com/nicobailon/pi-subagents/blob/f9aa1d22580657a267b946bd54b358c0a6440bf8/README.md#L403-L474) and [environment propagation](https://github.com/nicobailon/pi-subagents/blob/f9aa1d22580657a267b946bd54b358c0a6440bf8/src/runs/shared/pi-args.ts#L375-L385) establish the child side; the permission package's [forwarding protocol](https://github.com/gotgenes/pi-packages/blob/776ebcc764ca6c720b1f7eb430007de06f145b5f/packages/pi-permission-system/src/authority/permission-forwarding.ts#L6-L31) establishes the other side.

This path is technically plausible and source-complete, but it has not yet passed an end-to-end selected-fork + real Pi 0.83 interactive test. It must not be claimed as certified until that test exists.

### Nested child Agents

Nested prompts do **not** work acceptably as currently composed.

The selected subagent package deliberately passes the launching session as `PI_SUBAGENT_PARENT_SESSION`. For a grandchild, that target is the headless child, not the root TUI. The permission package starts its inbox poller only for a context that has UI and is not itself a subagent. Therefore the intermediate child never serves the grandchild's request. The grandchild waits for the fixed ten-minute forwarding timeout and is then denied. See the selected package's explicit [direct-child-only warning](https://github.com/nicobailon/pi-subagents/blob/f9aa1d22580657a267b946bd54b358c0a6440bf8/README.md#L461-L474), the permission package's [root-only poller guard](https://github.com/gotgenes/pi-packages/blob/776ebcc764ca6c720b1f7eb430007de06f145b5f/packages/pi-permission-system/src/authority/forwarding-manager.ts#L33-L56), and its [timeout and denial path](https://github.com/gotgenes/pi-packages/blob/776ebcc764ca6c720b1f7eb430007de06f145b5f/packages/pi-permission-system/src/authority/approval-escalator.ts#L260-L313).

Pi Stuff must choose one honest interim rule: nested `ask` is denied immediately with a clear explanation. A ten-minute invisible wait is unacceptable. Root-routed nested approval may be designed later, with depth, identity, scope, stale-request, and loop tests; it is not part of the current adoption claim.

## Default behavior and persistence

The upstream defaults are unsuitable for a default Suite Capability:

- with no policy file, the universal fallback is `ask`, so effectively every ordinary tool requests approval;
- `permissionReviewLog` defaults to `true` and writes a `config.resolved` record on session start;
- the review log records full Bash command strings, including secrets embedded directly in a command;
- global and project JSON plus per-Agent frontmatter are durable, but session approvals are memory-only;
- a trusted project's policy and runtime settings can override global values, including loosening a global deny or changing `yoloMode`;
- invalid higher-precedence configuration correctly fails closed to at least `ask`.

The defaults and precedence are documented in the [configuration reference](https://github.com/gotgenes/pi-packages/blob/776ebcc764ca6c720b1f7eb430007de06f145b5f/packages/pi-permission-system/docs/configuration.md#merge-precedence). The default `ask` is explicit in [`permission-manager.ts`](https://github.com/gotgenes/pi-packages/blob/776ebcc764ca6c720b1f7eb430007de06f145b5f/packages/pi-permission-system/src/permission-manager.ts#L40-L46). Log sensitivity is explicit in the package's [threat model](https://github.com/gotgenes/pi-packages/blob/776ebcc764ca6c720b1f7eb430007de06f145b5f/packages/pi-permission-system/docs/troubleshooting.md#threat-model).

For the owned fork:

- default review/debug logging must be off, preserving pure startup and avoiding surprise credential capture;
- circuit-breaker denies and global user denies must run before every lower-trust rule or unrestricted mode and cannot be relaxed by a project or Agent file;
- project files may tighten policy only after Host project trust;
- the selected unrestricted-with-tripwires mode and external authorizer activation must be user-owned settings, never project-controlled;
- the Capability must ship a useful baseline rather than depend on a handwritten JSON file for first use;
- persistent rules must be manageable from a user-facing settings surface, with their source visible.

## Claude Code comparison

Claude Code's current default mode allows reads and asks before edits and shell actions. It has `allow`, `ask`, and `deny` rules, evaluates deny before ask before allow, offers permission modes, and treats protected paths specially. See Anthropic's [permissions documentation](https://code.claude.com/docs/en/permissions) and [permission-mode documentation](https://code.claude.com/docs/en/permission-modes).

| Behavior | Claude Code | Upstream package | Pi Stuff direction |
| --- | --- | --- | --- |
| Fresh default | Reads quiet; edits/Bash ask | Everything falls back to ask | Ordinary work allowed; destructive safety tripwires ask or deny |
| Rule precedence | Deny → ask → allow | Higher config scope can replace lower rule after trust | Global deny is a non-relaxable floor |
| Session approval | Scope depends on tool; Bash can become project-persistent | All suggestions are session-memory rules | A tripwire approval applies to one exact call only; no remembered grant from the prompt |
| Main prompt | Native inline permission UI | Non-floating inline UI | Common full-width Command Dialog managed by Suite coordinator |
| Background child | Since 2.1.186, the prompt surfaces in the main session and names the child | Direct child forwards and pauses | Preserve named forwarding through the common Suite coordinator |
| Nested child | Claude subagents cannot spawn subagents | Ten-minute wait, then deny | Immediate clear deny until root routing is certified |
| Sandbox | Separate Claude sandbox layer exists | Explicitly not a sandbox | Safety tripwires now; sandbox remains a separate future Capability |

Direct-child forwarding conceptually matches current Claude behavior, but its transport is specific to the two selected Pi packages. Anthropic's current [subagent documentation](https://code.claude.com/docs/en/sub-agents) says foreground prompts pass through and, since 2.1.186, background prompts also surface in the main session, name the requesting subagent, and deny only the current tool call on `Esc`. Pi Stuff must certify that same user-visible contract through its own forwarding and recovery tests rather than assume package composition makes it reliable.

## Pi 0.83 compatibility audit

The package declares Pi peers `>=0.79.0` but develops against `0.79.1`; upstream does not certify 0.83.0. A local audit of the exact npm tarball performed the following without an LLM or credentials:

1. extracted `@gotgenes/pi-permission-system@24.0.0` and verified its npm integrity metadata and tarball SHA-256;
2. replaced its Pi development packages with exact coding-agent and TUI `0.83.0`;
3. copied the tag's excluded test directory beside the extracted package and ran its Vitest suite: 130 test files and 2,672 tests passed;
4. loaded the exact published Extension entry through Pi 0.83's real RPC Host in an isolated environment; `/permission-system` registered and no Extension error was emitted.

This proves source-level unit compatibility and Host startup/command registration. It does **not** prove interactive prompt rendering, actual allow/deny enforcement through a model turn, direct-child forwarding, nested behavior, session reload, or cross-platform Bash/path behavior in Pi 0.83. Those remain required real-Host acceptance tests.

## Security boundary

The package is a decision layer, not isolation. Its own [threat model](https://github.com/gotgenes/pi-packages/blob/776ebcc764ca6c720b1f7eb430007de06f145b5f/packages/pi-permission-system/docs/troubleshooting.md#threat-model) states that anything possible through an allowed tool remains possible and that the package is not a sandbox.

The exact boundary is:

- it can gate registered Pi tool calls and skill input;
- it cannot constrain arbitrary side effects performed directly by another Extension's import, startup, lifecycle handler, or background process;
- it cannot make an over-broad approval safe;
- a custom shell-like tool receives full Bash/path analysis only when registered through `shellTools`; otherwise it is merely a generic tool call;
- logs are owner-only, but owner-only files still expose verbatim command secrets to any process running as the same user;
- file-based forwarding needs stale-request cleanup, owner-only permissions, session identity checks, and interruption tests in the owned fork.

Permission and OS sandboxing should remain separate Capabilities. `pi-permission-modes` is interesting sandbox evidence, but combining both now would enlarge the initial fork and obscure which boundary actually protected an action.

## UI fit

The actual permission prompt is non-floating and worth keeping semantically. Two other upstream surfaces conflict with already selected Pi Stuff rules:

- `/permission-system` opens a centered overlay settings modal using `SettingsList`; see [`config-modal.ts`](https://github.com/gotgenes/pi-packages/blob/776ebcc764ca6c720b1f7eb430007de06f145b5f/packages/pi-permission-system/src/config-modal.ts#L177-L208);
- YOLO mode writes `yolo` into the Host statusline; see [`status.ts`](https://github.com/gotgenes/pi-packages/blob/776ebcc764ca6c720b1f7eb430007de06f145b5f/packages/pi-permission-system/src/status.ts#L19-L34).

The owned fork should:

- route every permission request through the shared Suite UI coordinator so it can preempt and resume Suite-owned BTW/Agent surfaces safely;
- retain a full-width, divider-led, non-floating prompt;
- use Pi's native `SettingsList` component inside the selected non-floating Command Dialog, not a centered overlay;
- remove statusline output;
- show the requesting Agent, exact operation summary, matched tripwire, and that approval applies to this call only; remembered grants belong only to the optional stricter mode's separate rule management;
- never depend on global `Ctrl+O` expansion as the only way to inspect one pending operation;
- queue simultaneous child requests and show their count rather than opening competing dialogs.

Completion or failure should never steal focus. A permission request may preempt only because it blocks work and requires a human decision.

## Alternative packages

The comparison uses npm's fixed download window from 2026-07-02 through 2026-07-31 and package manifests current on 2026-08-01.

| Package | Latest | Downloads | What it does | Why it is not a better base |
| --- | ---: | ---: | --- | --- |
| [`@gotgenes/pi-permission-system`](https://www.npmjs.com/package/@gotgenes/pi-permission-system) | 24.0.0 | [31,300](https://api.npmjs.org/downloads/point/2026-07-02:2026-07-31/%40gotgenes%2Fpi-permission-system) | Declarative full policy engine, Bash AST/path gates, child forwarding | Selected base; strongest infrastructure, but high churn |
| [`pi-permission-system`](https://pi.dev/packages/pi-permission-system) | 0.8.0 | [2,069](https://api.npmjs.org/downloads/point/2026-07-02:2026-07-31/pi-permission-system) | Original upstream lineage | Pi peers stop at 0.80; much less adopted and less developed |
| [`@thurstonsand/pi-permissions`](https://pi.dev/packages/%40thurstonsand/pi-permissions) | 0.9.0 | [2,018](https://api.npmjs.org/downloads/point/2026-07-02:2026-07-31/%40thurstonsand%2Fpi-permissions) | Programmable TypeScript permission hooks with polished request editing | Requires users/packages to author code; no selected child forwarding or complete default policy |
| [`pi-perm`](https://pi.dev/packages/pi-perm) | 0.1.8 | [1,636](https://api.npmjs.org/downloads/point/2026-07-02:2026-07-31/pi-perm) | Permission config plus optional Anthropic sandbox runtime | Very early, much less adopted, no selected child bridge |
| [`pi-permission-modes`](https://pi.dev/packages/pi-permission-modes) | 2.2.0 | [902](https://api.npmjs.org/downloads/point/2026-07-02:2026-07-31/pi-permission-modes) | Mode switching plus real OS sandboxing | Different and larger scope, footer/status UI conflicts, platform dependencies, no selected child bridge |
| [`@pi-lab/permissions`](https://pi.dev/packages/%40pi-lab/permissions) | 1.0.2 | [372](https://api.npmjs.org/downloads/point/2026-07-02:2026-07-31/%40pi-lab%2Fpermissions) | Small allow/ask/deny JSON rules | Defaults unmatched calls to allow; narrow and lightly adopted |
| [`pi-permission-layers`](https://pi.dev/packages/pi-permission-layers) | 1.3.0 | [220](https://api.npmjs.org/downloads/point/2026-07-02:2026-07-31/pi-permission-layers) | Five classified command levels with ask/block modes | Classification-centric, settings/status behavior conflicts, no child forwarding |

No alternative is both more mature and closer to the selected Agent architecture. `@gotgenes/pi-permission-system` is the defensible fork base; `pi-permission-modes` should be revisited only if Pi Stuff later chooses OS sandboxing as a separate Capability.

## Required fork delta

Before adoption, the owned fork must at minimum:

1. pin base commit `776ebcc764ca6c720b1f7eb430007de06f145b5f` and record the npm tarball integrity;
2. use wildcard Pi peers and exact `0.83.0` development dependencies, with exact runtime dependencies and no lifecycle scripts, matching repository policy;
3. make import/startup free of network, file writes, subprocesses, and Host-setting mutation;
4. disable review/debug logging by default and never log raw command secrets without explicit opt-in;
5. provide the selected unrestricted-with-tripwires default instead of universal `ask`, while retaining an optional stricter manual mode;
6. run the circuit breaker before unrestricted mode, session allows, project/Agent rules, and external authorizers; make its deny rules and dangerous-mode controls user-owned, non-relaxable boundaries;
7. integrate prompts and settings with the shared non-floating UI coordinator; remove overlay and statusline UI;
8. preserve direct-child requester identity and least-privilege grant scope;
9. deny nested `ask` immediately until root-routed nested forwarding is implemented and certified;
10. expose effective rules and their source in a user-facing management surface;
11. require every Suite-owned shell-like tool to register for the same Bash/path gate and fail package certification if one is omitted;
12. keep permissions distinct from sandboxing and from the subagent tool-visibility allowlist.

## Acceptance gates

The fork may become a default Capability only after all of these pass:

- exact Pi 0.83 real-Host tests for silent allow, one-call tripwire approval, hard deny, denial reason, optional manual mode, reload, resume, and invalid config;
- real TUI captures at normal and narrow widths for main and direct-child prompts, including simultaneous requests and preemption of a Suite-owned Command Dialog;
- selected `nicobailon/pi-subagents` direct foreground and background child end-to-end tests;
- an explicit nested-child test proving immediate denial, not a ten-minute wait;
- trusted/untrusted project tests proving project policy cannot loosen a global deny or enable unrestricted mode;
- custom shell-tool tests proving Pi Stuff's actual shell tools receive Bash/path gating;
- adversarial command-shape tests covering absolute executable paths, reordered flags, `--`, chains, variables, globs, command/process substitution, wrappers, `find -delete`, `rm -rf .`, `rm -rf *`, symlinks, generated scripts, interpreters, and time-of-check/time-of-use limitations;
- a Suite inventory test that fails when a shell-like tool is not enrolled in the gate;
- owner-only forwarding artifacts, stale request recovery, interruption, shutdown, and duplicate-response tests;
- an audit demonstrating that default startup performs no writes and that logs remain absent until explicitly enabled;
- `bun run check` in the Pi Stuff repository and extracted-tarball Host certification.

The product record is now: **unrestricted normal work with a narrowly tested destructive-command circuit breaker is selected; `@gotgenes/pi-permission-system@24.0.0` is the owned-fork base; implementation is not yet adopted and remains conditional on the acceptance gates above.**
