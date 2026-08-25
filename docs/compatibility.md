# Compatibility

## Certified host

| Contract | Certified version |
| --- | --- |
| Pi standalone host | `0.84.3`, upstream `4e58f324fae8ebfa98a3d45181fb248072a2afac`, Linux x64 |
| Pi release archive | SHA-256 `6f8bb67c21bc6b8a8a106d354f56d7fd4a190a3cd8ad3a32db45f6d281a5d008` |
| Pi release executable | SHA-256 `ca858fde375ab91531353b22fac6ebdf29c0a153efe754f5f9b8a72a7423ed08`, 104,487,040 bytes |
| Pi Host embedded Bun runtime | 1.3.14 |
| Repository Bun toolchain | 1.4.0 |
| System-utility baseline | Ubuntu 24.04 with Bash, curl, tar, gzip, and standard Unix utilities; no `pwsh` |
| PTY verification tools | Ubuntu 24.04 packages for Expect and tmux |
| TypeScript checker | 5.9.3 |

The certified upstream Host is the `v0.84.3` Linux x64 release built from the commit above and reports `0.84.3`. Every
acceptance path hashes the executable and rejects anything outside the audited allowlist before exercising the complete
Suite contract, including public `registerMarkdownTransformer()`, regular and fullscreen UI behavior, and
space-preserving native settings search. The exact binary hash, rather than a reusable version string, is the executable
identity. Pi Stuff does not rebuild or distribute Pi Host.

CI exposes two stable checks. `Fast` always validates the frozen dependency graph, repository formatting, anti-slop
lint, type surfaces, unused-code analysis, generated composition, and public-release safety. For pull requests, the scope classifier starts
`Acceptance` when executable behavior or executable documentation changed; a direct push to `main` runs `Fast` only,
and manual dispatch runs both checks. `Acceptance` downloads and verifies the certified Host release and RTK runtime
before running every test
file in a fresh Bun process, real TUI verification, the Tool Activity benchmark, and package verification in a
network-isolated namespace. Per-file process isolation prevents one process- or PTY-heavy test from contaminating the
native resources used by a later test. Only Beads metadata and recorded PNG, GIF, HTML, or ANSI evidence may skip
`Acceptance`; executable documentation remains fully certified. A separate weekly upstream watch reports when the npm
`latest` tag moves beyond the certified Host, but never changes certification automatically.
The certified execution profile has two Bun versions with separate scopes. The audited standalone Host embeds Bun 1.3.14 and keeps that
identity with its exact binary hash. Repository scripts, CI tests, and Suite subprocess helpers that resolve Bun from PATH
use 1.4.0. A repository toolchain upgrade never relabels the Host artifact's embedded runtime.
Bun dependency upgrades are deliberate maintainer changes because the frozen Bun lockfile, exact repository toolchain,
`@types/bun`, CI, and executable documentation must move coherently. The Host Bun version moves only with a new exact
release artifact and recertification. Dependabot is limited to pinned GitHub Actions; it does not produce npm pull
requests that omit or bypass the repository-owned Bun lockfile.

The certified Host profile identifies the released version, reviewed upstream source commit, Linux x64 release-binary
hash, and embedded Bun version. The repository toolchain row separately identifies the Bun executable used for repository
commands and CI. CI downloads the fixed GitHub Release while network access is available, verifies it, and then runs the
acceptance suite without external network access. The archive hash is checked before extraction; the executable hash is
checked again before use. Pi upgrades review and update these constants together; the repository does not claim to
reproduce the upstream compilation process.

Pi core imports remain wildcard peer dependencies because the Host supplies them. Development dependencies stay pinned
to the released `0.84.3` type surface. Version-sensitive verification scripts read the shared certified Host contract
instead of maintaining independent Pi version constants. PowerShell is recognized as a Pi built-in for Tool lifecycle,
MCP name-conflict, and child-Agent availability policy, but the certified Linux baseline does not contain `pwsh` and
does not claim PowerShell execution or Windows behavior.
Real RPC Provider fixtures populate each Tool call in `toolcall_start.partial`, as required by Pi 0.84.3's RPC
serialization contract.
Pi 0.84.3 also owns live compaction replay: it validates the persisted boundary, rebuilds through
`buildContextEntries()`, and renders the summary once. The Suite does not intercept that SessionManager call.

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
