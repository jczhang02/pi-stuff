# Compatibility

## Certified host

| Contract | Certified version |
| --- | --- |
| Pi standalone host | `0.84.1`, upstream `53fa77ccd8a279eb87e92294ef3687b03ff80112`, Linux x64 |
| Bun toolchain | 1.3.14 |
| Node.js toolchain | 24.16.0 |
| npm toolchain | 11.13.0 |
| Model-data snapshot | SHA-256 `299c882258d4714113aab6531eb1d00ec4c7d2e95a303951715bd182799475ef` |
| System-utility baseline | Ubuntu 24.04 with Git, Bash, tar, gzip, and standard Unix utilities |
| PTY verification tools | Ubuntu 24.04 packages for Expect and tmux |
| TypeScript checker | 5.9.3 |

The certified upstream Host is the released `v0.84.1` source and reports `0.84.1`. It is verified against the complete
Suite contract, including public `registerMarkdownTransformer()`, regular and fullscreen UI behavior, and
space-preserving native settings search. The pinned CI workflow builds the release commit and binds its binary hash to a build record; the
local installed Host must match the audited executable SHA-256 allowlist and embedded source-map fingerprints, so a
reused version string or swapped executable cannot produce a false certification. The CI record is accepted only with
that workflow's markers and fixed artifact path. This is an operational trust convention that prevents accidental Host
mismatch, not cryptographic proof against a process that forges the workflow environment; the exact pinned CI workflow
is the trust root.

CI exposes two stable checks. `Fast` always validates the frozen dependency graph, repository formatting, type surfaces,
unused-code analysis, generated composition, and public-release safety. `Acceptance` then builds the certified Host and
RTK runtime before running every test file in a fresh Bun process, real TUI verification, the Tool Activity benchmark,
and package verification in a network-isolated namespace. Per-file process isolation prevents one process- or PTY-heavy
test from contaminating the native resources used by a later test. Only Beads metadata and recorded PNG, GIF, HTML, or ANSI evidence may skip `Acceptance`;
executable documentation remains fully certified. Manual dispatch always runs both checks. A separate weekly upstream
watch reports when the npm `latest` tag moves beyond the certified Host, but never changes certification automatically.

Bun dependency upgrades are deliberate maintainer changes because the frozen Bun lockfile, exact toolchain, and certified
Pi profile must move coherently. Dependabot is limited to pinned GitHub Actions; it does not produce npm pull requests
that omit or bypass the repository-owned Bun lockfile.

The certified profile identifies the source commit, the repository-owned model-data content address, and exact Node.js,
npm, and Bun versions. The default build copies all 40 snapshot files from
`vendor/pi-host-model-data/299c882258d4714113aab6531eb1d00ec4c7d2e95a303951715bd182799475ef` and verifies every
filename and byte before compilation; it never reads the live model catalog. `bun run host:model-data:refresh` is the
only live-catalog seam. It canonicalizes the non-input `generatedAt` timestamp, writes a new content-addressed candidate,
and leaves profile selection to an explicit reviewed constant change. Git, Bash, tar, gzip, and other Unix utilities
follow the Ubuntu 24.04 CI baseline rather than an asserted cross-distribution byte-reproducibility contract.

For a fresh Linux x64 checkout, `bun run host:build` performs the pinned fetch, checked hydration and offline-model-data
build under `.artifacts/`. Local verification requires the recorded binary instance, fixed source checkout and
hash-bound record together, then rechecks the checkout commit, clean tracked state, model snapshot, changelog, and the
complete copied source-map set. Each verified Host and embedded record is fsynced into an immutable generation. A stable
binary facade and external record symlink both traverse one relative `pi-host/current` pointer; one same-directory atomic
symlink rename is the only activation step. Verification reads that pointer once and pins both files from the same
generation. An exclusive publisher lock prevents competing switches, and old generations remain available to already
pinned readers. The first migration copies the legacy Host and record bytes before progressively replacing the two
facade files with equivalent symlinks, so every crash point exposes either a complete old pair or a complete new pair.
This local record has the same deliberately operational threat model: it detects accidental substitution but cannot
prove integrity against a user who controls and forges the entire local environment.

Pi core imports remain wildcard peer dependencies because the Host supplies them. Development dependencies stay pinned
to the released `0.84.1` type surface. Version-sensitive verification scripts read the shared certified Host contract
instead of maintaining independent Pi version constants.

Pi 0.84 gives independently loaded extensions distinct `ExtensionAPI.events` facade objects over one Host event bus.
Suite-wide registries therefore use a synchronous event-bus discovery handoff and retain facade-keyed WeakMaps only as
local caches. Object identity of an individual facade is never treated as Host identity. Real PTY and cross-facade unit
tests cover Command Dialog restoration, Tool Activity metadata, Context ownership, `/ui` settings, status channels,
Current Work sources, and duplicate lifecycle suppression.

A Pi upgrade requires a dedicated change that reviews relevant Extension and Package interfaces, updates the pinned
development dependency and Host source profile together, and passes the no-model standalone-host certification.
Compatibility with other Pi builds is not claimed until that work is complete.

Older version strings in changelogs, archived acceptance reports, research notes, and captured prototypes describe the
Host that produced that historical evidence. They are not executable compatibility declarations and must not be
rewritten to imply that old evidence was captured on the current Host. Current source, package manifests, CI, fixtures,
and verification scripts follow the certified profile above.

The Codex Capability bundles its retained native helpers only for the certified Linux x64 profile. On another target,
the command and ordinary Pi turns remain available while the unavailable Tool returns a bounded recovery error.
