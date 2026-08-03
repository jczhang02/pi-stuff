# Compatibility

## Certified host

| Contract | Certified version |
| --- | --- |
| Pi standalone host | upstream `bf4a90d81985bd45052eeeae59d84fe13e0bd2c8`, Linux x64 |
| Bun toolchain | 1.3.14 |
| Node.js toolchain | 24.16.0 |
| npm toolchain | 11.13.0 |
| Model-data snapshot | SHA-256 `676b91ad13829f58c8e92e391f116ce91a45ec878362a41ce7104e916de86e3a` |
| System-utility baseline | Ubuntu 24.04 with Git, Bash, tar, gzip, and standard Unix utilities |
| PTY verification tools | Ubuntu 24.04 packages for Expect and tmux |
| TypeScript checker | 5.9.3 |

The certified upstream Host reports `0.83.0` but is intentionally newer than the `v0.83.0` tag. It is the earliest
upstream source state verified against the complete Suite contract: public `registerMarkdownTransformer()`, fullscreen
UI behavior, and space-preserving native settings search. The tagged `v0.83.0` binary is not compatible with the
complete Aggregate. The pinned CI workflow builds the pinned commit and binds its binary hash to a build record; the
local installed Host must match the audited executable SHA-256 allowlist and embedded source-map fingerprints, so a
reused version string or swapped executable cannot produce a false certification. The CI record is accepted only with
that workflow's markers and fixed artifact path. This is an operational trust convention that prevents accidental Host
mismatch, not cryptographic proof against a process that forges the workflow environment; the exact pinned CI workflow
is the trust root.

The certified profile identifies the source commit, the repository-owned model-data content address, and exact Node.js,
npm, and Bun versions. The default build copies all 38 snapshot files from
`vendor/pi-host-model-data/676b91ad13829f58c8e92e391f116ce91a45ec878362a41ce7104e916de86e3a` and verifies every
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
to the released `0.83.0` type surface; the one post-tag rendering seam is capability-checked at runtime and represented
locally until Pi publishes it in a tagged release.

A Pi upgrade requires a dedicated change that reviews relevant Extension and Package interfaces, updates the pinned
development dependency and Host source profile together, and passes the no-model standalone-host certification.
Compatibility with other Pi builds is not claimed until that work is complete.
