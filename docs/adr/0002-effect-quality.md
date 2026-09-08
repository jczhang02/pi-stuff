# Use Effect v4 and a strict quality baseline

[简体中文](../zh-CN/adr/0002-effect-quality.md) · English is normative.

The maintainer chose Effect `4.0.0-rc.112` for boundary decoding, typed errors, and necessary I/O orchestration, including existing repository scripts, while keeping pure algorithms as ordinary functions. This extends [ADR 0001](0001-typescript-bun.md), retaining TypeScript and Bun `1.4.0`; it accepts an RC dependency to use the chosen v4 framework rather than maintain ad hoc boundary/error handling or adopt v3.

RC status alone must **never** justify rejecting v4, downgrading to v3, or choosing another framework. Specific incompatibilities require an actual reproduction, version/API evidence, and a maintainer decision; use v4 documentation rather than assumed v3 APIs. No product extension or Pi host compatibility is implied.

The quality baseline combines all 15 generic anti-slop rules plus its Effect rule and Oxlint correctness rules as errors on owned source and tests, strict TypeScript/unused-code checks, and Oxfmt using pinned Google GTS formatting preferences without adding GTS, ESLint, or Prettier. The [engineering rules](../agents/engineering.md) define the settings and no-bypass policy; existing observable script behavior and regression scenarios remain required, without a fixed test count, hard coverage target, Knip, or a full mutation framework.

Substantive code changes, including the quality-baseline PR, require a separate read-only full-diff review under the mandatory upstream `.pi/skills/thermo-nuclear-code-quality-review/SKILL.md` standard. The task owner implements fixes; concrete structural findings are presumptive blockers until fixed or refuted with evidence and independently rechecked, with unresolved disagreement referred to the maintainer. Documentation/mechanical changes do not automatically need this specific review; existing high-risk review rules still apply. This adds review and refactoring cost in exchange for explicit type boundaries and simpler structure that passing tests alone cannot establish.
