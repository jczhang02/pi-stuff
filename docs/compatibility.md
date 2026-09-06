# Compatibility

## Certified host

| Contract | Certified version |
| --- | --- |
| Pi standalone host | `0.85.0`, upstream `107d79f11072bbc8a3a757ed7fd69596bee7d68c`, Linux x64 |
| Pi release archive | SHA-256 `a7e7c65f1dc528d2e17e7d946ad2b61df0e2b0f9952faee77807c2484b464d6e` |
| Pi release executable | SHA-256 `0cfd1bf3e9468f1052d172502fa388e8e8e53dcdeb9fa97f1ef828fdd7757072`, 105,764,992 bytes |
| Pi Host embedded Bun runtime | 1.3.14 |
| Repository Bun toolchain | 1.4.0 |
| Pi Stuff Package | 0.3.3 |
| Repository development package | 0.0.0 |
| System-utility baseline | Ubuntu 24.04 with Bash, curl, tar, gzip, and standard Unix utilities; no `pwsh` |
| PTY verification tools | Ubuntu 24.04 packages for Expect and tmux |
| TypeScript checker | 5.9.3 |
| Code Mode host | OpenAI Codex `rust-v0.145.0`, Linux x64 |
| Code Mode host release archive | SHA-256 `ac23177956c30cc1f9f180c27bd80f5bb5b76780db55fb94dcc22644d490852e` |
| Optional RTK runtime | Official `0.45.0`, source `b34be37caf3796b69a50952a28e60e32b5daad43`, Linux x64 |
| RTK release archive | SHA-256 `c4c036fbf181fc55ef329786c8c17e0d427972b053b825944d968a6aafef1ba4` |
| RTK release executable | SHA-256 `99e0cff729d52297a23eb832f809d9773ba7c32de818dfe76b2cdd900a951535` |

The certified upstream Host is the `v0.85.0` Linux x64 release built from the commit above and reports `0.85.0`. Every
acceptance path hashes the executable and rejects anything outside the audited allowlist before exercising the complete
Suite contract, including public `registerMarkdownTransformer()`, regular and fullscreen UI behavior, and
space-preserving native settings search. The exact binary hash, rather than a reusable version string, is the executable
identity. Pi Stuff does not rebuild or distribute Pi Host.

CI exposes two stable checks. `Fast` always validates the frozen dependency graph, repository formatting, anti-slop
lint, type surfaces, unused-code analysis, generated composition, and public-release safety. For pull requests, the scope classifier starts
`Acceptance` when executable behavior or executable documentation changed; a direct push to `main` runs `Fast` only,
and manual dispatch runs both checks. `Acceptance` downloads and verifies the certified Host release, Code Mode host,
and RTK runtime
before running every test
file in a fresh Bun process, real TUI verification, the Tool Activity benchmark, and package verification in a
network-isolated namespace. Per-file process isolation prevents one process- or PTY-heavy test from contaminating the
native resources used by a later test. Only Beads metadata and recorded PNG, GIF, HTML, or ANSI evidence may skip
`Acceptance`; executable documentation remains fully certified. A separate weekly upstream watch reports when the npm
`latest` tag moves beyond the certified Host, but never changes certification automatically.

PTY verifiers probe optional tmux server settings before using them; Goal verification must work without
`extended-keys-format` on the Ubuntu baseline. CI checks the Suite observer's user/network/PID namespace setup before
running the acceptance suite. A failed setup stops acceptance and prints relevant kernel audit messages; it never
disables isolation or substitutes a skipped test. Ubuntu's AppArmor policy requires explicit user-namespace permission:
the ephemeral CI runner loads a profile for its dedicated copy of `unshare` in `SYSTEM_TOOL_BIN`. The copy retains
ordinary host-user permissions; root mapping applies only inside the new user namespace. AppArmor stays enabled and
its system-wide user-namespace restriction, per-scenario network/PID isolation and descendant reaping remain unchanged.
Context activation fixtures select their
native-compaction policy explicitly instead of inheriting the runner's personal settings.

The packed Goal Code Mode scenario resolves the already-prepared helper through the same binary-path contract as
other native Code Mode verifiers and passes that path into its isolated child environment. It must not rely on a
download into the child's empty private cache. Other Goal scenarios do not require the helper; runtime first-use
installation and the existing verification timeout remain unchanged.

The certified execution profile has two Bun versions with separate scopes. The audited standalone Host embeds Bun 1.3.14;
provenance checks its exact runtime banner at the reviewed byte offset before hashing the complete executable. Repository
scripts, CI tests, and Suite subprocess helpers that resolve Bun from PATH use 1.4.0. A repository toolchain upgrade never
relabels the Host artifact's embedded runtime.
Bun dependency upgrades are deliberate maintainer changes because the frozen Bun lockfile, exact repository toolchain,
`@types/bun`, CI, and executable documentation must move coherently. The Host Bun version moves only with a new exact
release artifact and recertification. Dependabot is limited to pinned GitHub Actions; it does not produce npm pull
requests that omit or bypass the repository-owned Bun lockfile.

The certified Host profile identifies the released version, reviewed upstream source commit, Linux x64 release-binary
hash, and embedded Bun version. The repository toolchain row separately identifies the Bun executable used for repository
commands and CI. CI downloads the fixed GitHub Releases while network access is available, verifies them, and then runs
the acceptance suite without external network access. Release archive hashes are checked before extraction; the Pi
executable hash is checked again before use. Pi upgrades review and update these constants together; the repository does not claim to
reproduce the upstream compilation process.

Pi core imports remain wildcard peer dependencies because the Host supplies them. Development dependencies stay pinned
to the released `0.85.0` type surface. The published `pi-coding-agent` SDK imports `pi-server` through its main entrypoint
but omits that dependency from its manifest. The repository supplies exact `@earendil-works/pi-server@0.85.0` as a
development dependency; its narrow Knip entry accounts for this SDK-owned runtime import. Neither the SDK source nor
the standalone Host is patched, and the dependency is not added to the installed Suite. Remove this workaround when a
later certified SDK declares its dependency correctly.

Pi 0.85.0 wraps Thinking content in a native clickable `MouseRegion`. The version-checked Thinking adapter projects
only that region's child, retaining the Host's visibility callback and click routing. Real-Host PTY acceptance covers
both mouse and keyboard collapse/expand, latest-row rendering, and unchanged canonical Session content.

Version-sensitive verification scripts read the shared certified Host contract
instead of maintaining independent Pi version constants. PowerShell is recognized as a Pi built-in for Tool lifecycle,
MCP name-conflict, and child-Agent availability policy, but the certified Linux baseline does not contain `pwsh` and
does not claim PowerShell execution or Windows behavior.
Real RPC Provider fixtures populate each Tool call in `toolcall_start.partial`, as required by Pi 0.85.0's RPC
serialization contract.
Pi 0.85.0 also owns live compaction replay and the post-Tool threshold check before the next Assistant request: it
validates the persisted boundary, rebuilds through `buildContextEntries()`, and renders the summary once. The Suite
does not intercept either Host path. Packed acceptance proves a large Tool result triggers one native threshold
compaction while an active Goal schedules exactly one continuation.

Pi 0.85.0 owns RPC `clear_queue`, terminal settings, non-triggering custom-message ordering, Sessions, and Providers.
Pi Stuff does not wrap or shadow those contracts. `clear_queue` returns the removed queues but exposes no Extension
event, so Conversation UI cannot synchronously prune its observational attribution mirror. The next ambiguous mixed
user/automatic delivery clears that mirror and fails closed to automatic attribution; real RPC acceptance covers this
gap. The Host also defers `sendMessage({ triggerTurn: false })` content queued during Tool execution until every Tool
result in that turn is persisted.

Codex generated-image inlining uses Pi 0.85.0's public `detectSupportedImageMimeTypeFromFile()` seam for JPEG, PNG,
GIF, WebP, and BMP. The existing four-image, 25 MiB, regular-file, and best-effort text fallback limits remain intact.
An inline image result certifies model-visible media and Host rendering behavior, not image display through tmux;
actual terminal display still depends on the Host, terminal protocol, and multiplexer passthrough. Pi Stuff neither
changes terminal settings nor claims that tmux itself renders these images.

Pi 0.84 gives independently loaded extensions distinct `ExtensionAPI.events` facade objects over one Host event bus.
Suite-wide registries therefore use a synchronous event-bus discovery handoff and retain facade-keyed WeakMaps only as
local caches. Object identity of an individual facade is never treated as Host identity. Real PTY and cross-facade unit
tests cover Command Dialog restoration, Tool Activity metadata, Context ownership, `/ui` settings, status channels,
Current Work sources, and duplicate lifecycle suppression.

A Pi upgrade requires a dedicated change that reviews relevant Extension and Package interfaces, updates the pinned
development dependency, source commit, and release-binary hash together, and passes standalone-host certification.
Compatibility with other Pi builds is not claimed until that work is complete.

Older version strings in changelogs, archived acceptance reports, research notes, and captured prototypes describe the
Host that produced that historical evidence. They are not executable compatibility declarations and must not be
rewritten to imply that old evidence was captured on the current Host. Current source, package manifests, CI, fixtures,
and verification scripts follow the applicable Host or repository toolchain row above. `CERTIFIED_PI_BUN_VERSION`
describes the audited Host artifact, not the repository toolchain.

The Codex Capability bundles its retained native helpers only for the certified Linux x64 profile. On another target,
the command and ordinary Pi turns remain available while the unavailable Tool returns a bounded recovery error.
