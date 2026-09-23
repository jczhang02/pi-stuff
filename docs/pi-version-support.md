# Pi version support

[简体中文](i18n/zh-CN/pi-version-support.md) · English is normative.

Status: the maintainer confirmed the complete policy on 2026-09-23. [#113](https://github.com/jczhang02/pi-stuff/issues/113) holds the implementation specification. Policy acceptance does not expand the current verified runtime claim.

## Current evidence

Main revision `bb03c4e` declares and records Linux Bun-compiled Pi `0.85.1` with Bun `1.4.0`. Development tests also launch the installed Pi CLI through Bun. Other host versions and runtime environments remain unverified for this revision. See the [README](../README.md#project-status) and [QA record](quality-assurance.md#terminal-e2e).

## Confirmed decisions

Start with `0.85.1` as the minimum compatibility target and follow later stable Pi releases. A new release is allowed to be tried and enters the compatibility target set; it becomes formally supported only after host acceptance. A broad peer-dependency declaration is not acceptance evidence. The [glossary](../CONTEXT.md#language) distinguishes targets, the support range and verified versions.

Every intermediate version within the declared support range remains a maintenance responsibility. Testing the endpoints does not turn the range into support for only those endpoints. A failure on an intermediate version needs a fix or an explicit documented exception; upgrading the reporter is not by itself a resolution of that commitment.

The minimum may be raised. Before doing so, explain the concrete API or feature need, the cost of preserving compatibility and the affected versions, then obtain the maintainer's confirmation. Compatibility need not be proven impossible. Age alone is not a sufficient reason to retire a version. This trades a permanent old-version promise for an explicit decision when maintenance costs or host capabilities change.

## Packaging direction

The implementation follows [Pi's package guidance](https://pi.dev/docs/latest/packages#declare-dependencies): imported host-provided Pi packages use wildcard peers, while development dependencies stay pinned to exact versions for reproducibility. The support policy and host evidence define the maintained range separately from the install declaration. Dependency and CI changes are specified in #113 and have not been implemented by this documentation task.

## Acceptance samples

Use the exact minimum plus the latest patch within the proposed interval for every covered minor line, without duplicate samples. For a target ending at `0.87.1`, the initial samples are `0.85.1`, `0.86.1` and `0.87.1`. This sampling policy is accepted; these additional host runs have not been performed by this documentation task. Historical patches remain within the maintenance commitment without requiring an individual rerun of every release.

Before expanding the supported upper bound, accept the selected samples for the expanded interval in the declared runtime environment. Record the directly verified versions separately from the interval; sampling must not be presented as direct testing of every historical patch.

## Evidence boundaries

Pi [0.86.0](https://github.com/earendil-works/pi/releases/tag/v0.86.0) and [0.87.0](https://github.com/earendil-works/pi/releases/tag/v0.87.0) document breaking API changes. Their existence justifies checking the interfaces Pi Stuff uses; it does not prove that Pi Stuff fails on those releases. Separate feature-task evidence, including [#106](https://github.com/jczhang02/pi-stuff/issues/106), must be checked for revision, environment and behavior before reuse.
