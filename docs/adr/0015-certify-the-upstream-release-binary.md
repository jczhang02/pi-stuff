---
status: accepted
---

# Certify the upstream release binary

## Context

Pi Stuff is a Pi Package, not a Pi Host distribution. Rebuilding Pi from a pinned checkout required repository-owned
model data, source hydration, build records, and crash-safe binary publication that did not contribute Package behavior.

## Decision

Pin the supported Pi version, reviewed upstream source commit, and Linux x64 release-binary SHA-256. CI downloads that
upstream release while network access is available, rejects any binary outside the allowlist, and then runs the existing
real-Host acceptance suite without external network access. Exact development dependencies continue to provide the
released type surface.

Pi Stuff does not rebuild, publish, or retain generated model data for Pi Host.

## Consequences

- Host identity depends on the reviewed release binary hash rather than its reusable version string.
- A Pi upgrade updates the source commit, binary hash, development dependencies, and acceptance evidence together.
- Acceptance depends on availability of the pinned upstream GitHub Release during its installation phase.
- The repository no longer claims that it can reproduce the upstream binary from source.
