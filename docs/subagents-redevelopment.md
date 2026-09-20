# Subagent redevelopment decisions

[简体中文](i18n/zh-CN/subagents-redevelopment.md). English is authoritative.

Status: decision interview opened on 2026-09-20. Tracked in [#97](https://github.com/jczhang02/pi-stuff/issues/97), under [#64](https://github.com/jczhang02/pi-stuff/issues/64). This record supersedes the previous specification as the direction for the next implementation. It is not a completed specification or authorization to begin implementation before the interview is confirmed.

## Confirmed direction

1. Redevelop the subagent capability around arhen's `pi-core-subagent`, preserving upstream behavior and fixing its problems. The previous independent implementation is not the new baseline.
2. Other packages and harnesses in the existing research may supply proposals for useful features or implementation techniques. A proposal is not accepted scope. Previous additions do not carry over automatically.
3. Use the current UI design as the starting point, then discuss the complete UI again against the selected runtime capabilities. Existing screens and shortcuts are not automatically final.

The previous code, tests, research, decisions and session records remain available as evidence. This decision does not authorize deleting them, migrating stored sessions, changing dependencies or waiving repository engineering rules. The previous F/B/U checklist and its passing tests do not establish acceptance for the redevelopment.

## Verified reference

The inspected upstream reference is [`@arhen/pi-core-subagent` 1.3.54 at `de1c8783`](https://github.com/arhen/pi-extensions/tree/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent). The exact revision to import will be recorded after checking upstream changes.

Upstream starts read-only agents in their selected current directory. Tasks with write-capable tools receive a Git worktree when available. Worktrees start from HEAD or an upstream task branch and share `node_modules` through a symlink. Upstream exposes several model-facing tools. These are source facts, not new design choices. See [manager.ts](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/manager.ts) and [worktree.ts](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/worktree.ts).

The previous implementation instead captures a baseline before default read-only work. Its full ignored-file status scan produced 1,749,620 bytes in the real development checkout, exceeding its 1 MiB Git output limit. Of that output, 1,748,388 bytes came from 28,085 `node_modules` entries. Calling the actual Git wrapper reproduced the reported error twice before model execution. This defect belongs to the previous implementation; upstream does not use that scan. Prior small-project acceptance did not cover this condition.

## Decision tree

The first round resolves the redevelopment boundary:

- How closely the source structure must remain tied to upstream, beyond matching behavior.
- Whether the earlier single-tool preference survives the return to upstream's multiple tools.
- How to distinguish a demonstrated defect repair from a deliberate change in upstream behavior.
- Whether the new implementation must continue sessions created by the previous implementation.

Those answers govern later decisions about engineering adaptation, selected repairs and optional additions. Once the runtime scope is settled, revisit the UI through concrete launch, progress, inspection, communication, cancellation and recovery scenarios. Acceptance must then cover the real project with installed dependencies as well as controlled fixtures.

Questions and recommendations remain proposals until answered. Record each accepted answer here as the interview proceeds. Add glossary entries only when domain terms are resolved, and ADRs only when a consequential trade-off needs a durable explanation. Do not put implementation notes in the glossary.

## Current phase

The current work is source/research verification and the decision interview. Preserve the existing task owner, implementation branch and other worktrees. [PR #98](https://github.com/jczhang02/pi-stuff/pull/98) represents the previous implementation and is not a redevelopment acceptance candidate. No new runtime code, UI prototype, merge or release is authorized by this interview phase.
