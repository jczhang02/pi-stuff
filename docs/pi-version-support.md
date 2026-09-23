# Pi version support

[简体中文](i18n/zh-CN/pi-version-support.md) · English is normative.

The maintained range is Pi `0.85.1` through `0.87.1` on Linux, using Bun-compiled hosts. Newer stable releases may be tried without an upper-version block; they remain compatibility targets until accepted. [#113](https://github.com/jczhang02/pi-stuff/issues/113) records the agreed policy and implementation requirements.

## Current evidence

Product revision `8c474dc` was checked on 2026-09-23 against the official Linux x64 binaries below. Each passed the full offline suite, including Web access, RTK and themes, using an isolated production copy without development dependencies or installed host peers. The host itself reported its Pi and embedded Bun versions. Bun `1.4.0` ran the tests and development tooling; it does not replace the runtime embedded in a compiled Pi binary.

| Directly verified Pi | Embedded Bun | Selected API typecheck | Full offline suite |
| -------------------- | ------------ | ---------------------- | ------------------ |
| `0.85.1`             | `1.3.14`     | Passed                 | Passed             |
| `0.86.1`             | `1.3.14`     | Passed                 | Passed             |
| `0.87.1`             | `1.3.14`     | Passed                 | Passed             |

The maintainer's Pi `0.87.1` compiled with Bun `1.4.0` also passed the host-identity and final-result tests; this was a targeted check, not another full-suite run. The older `bb03c4e` record covered the maintainer's Pi `0.85.1`/Bun `1.4.0` profile. Neither record certifies Node-host Pi, macOS, Windows or other architectures.

The first full runs exposed a runtime difference: the official binaries' `node:util` ANSI stripper consumed an isolated ESC followed by ordinary text. Final tool results now use the fixed Node-compatible ANSI pattern in `src/rtk/register.ts`, retaining its upstream MIT notice. The same regression assertions then passed, preserving text, image blocks, errors, metadata and usage. No Pi API compatibility branch or minimum increase was needed.

Native RTK `0.45.0` was checked separately in all three selected hosts. A temporary repository, explicit executable path and private RTK database were used to run `git status`, observe compact model-bound output, open all six Usage views, and resize to 56x26 and 45x20. These checks passed. They do not rerun mise discovery or certify other RTK versions; deterministic fixtures cover discovery and failure paths separately.

## Maintenance decisions

Every intermediate version within the declared support range remains a maintenance responsibility. Testing samples does not turn the range into support for only those samples. A failure on an intermediate version needs a fix or an explicit documented exception; upgrading the reporter is not by itself a resolution. There are no known version-specific exceptions in this accepted interval.

The minimum may be raised. Before doing so, explain the concrete API or feature need, the cost of preserving compatibility and the affected versions, then obtain the maintainer's confirmation. Compatibility need not be proven impossible. Age alone is not a sufficient reason to retire a version.

The [glossary](../CONTEXT.md#language) distinguishes compatibility targets, the maintained support range and directly verified versions. A new stable release enters the target set; formal support expands after acceptance in the declared environment.

## Packaging

Following [Pi's package guidance](https://pi.dev/docs/latest/packages#declare-dependencies), imported host-provided packages use wildcard peers: `pi-ai`, `pi-coding-agent`, `pi-tui` and `typebox`. The development Pi packages are pinned to `0.87.1`, with TypeBox `1.3.27` and a committed Bun lockfile. `pi-agent-core` is a development dependency for test fixtures. Runtime libraries remain normal dependencies.

Wildcard peers allow trying newer hosts; they are not acceptance evidence. The normal development install remains `bun install --frozen-lockfile --ignore-scripts`. The clean-package acceptance profile copies the unmodified entrypoint, source, themes, manifest and lockfile to a temporary directory, then installs with `--frozen-lockfile --production --omit peer --ignore-scripts`.

## Acceptance samples and CI

Select the exact minimum plus the latest patch within the proposed interval for every covered minor line, removing duplicate samples. For the current interval these are `0.85.1`, `0.86.1` and `0.87.1`. Historical patches are maintained without claiming an individual test run for every release.

[CI](../.github/workflows/ci.yml) names each sample and pins the SHA-256 digest of its official release archive. Each job installs the selected Pi API packages and matching TypeBox for typechecking, then runs the full suite with the selected compiled host and clean package. The `quality` job checks the frozen development graph. The existing required `checks` job succeeds only when quality and every compatibility sample succeed; failures, missing hosts and cancelled or skipped dependencies cannot produce a passing gate. No scheduled upgrade or new permission is introduced.

For a local selected-host run, use the same Bun version and dependencies as CI:

```bash
PI_TEST_HOST=/absolute/path/to/pi \
PI_TEST_VERSION=0.86.1 \
PI_TEST_PACKAGE=/absolute/path/to/production-copy \
bun run test
```

`PI_TEST_VERSION` checks the executing host, not just the installed development package. A mismatched version or missing executable fails. Without these overrides, tests load the checkout using the pinned Pi CLI under the test runner. See [QA](quality-assurance.md#terminal-e2e) for isolation and coverage.

Before expanding the range, update the sample selection, inspect relevant API changes, run the required checks, record product revision and actual runtimes, and complete review. Keep the previous claim if a sample fails. Live-account provider authentication remains outside offline acceptance. Separate feature evidence, including [#106](https://github.com/jczhang02/pi-stuff/issues/106), must match revision, environment and behavior before reuse.
