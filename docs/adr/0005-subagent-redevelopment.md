# Rewrite subagent internals while keeping upstream behavior as the baseline

[简体中文](../i18n/zh-CN/adr/0005-subagent-redevelopment.md). English is authoritative.

The previous independent implementation added workspace and lifecycle machinery beyond arhen's `pi-core-subagent`; a default snapshot scan then prevented even read-only tasks from starting in a real checkout with installed dependencies. The maintainer chose to restart from upstream behavior, while rewriting its source to satisfy all repository standards, including [Effect v4](0002-effect-quality.md), without an upstream-code exemption. Internal modernization must not silently broaden product scope: approved differences currently include one model-facing `subagent` tool, failing worktree initialization without automatic source-directory writes, and no compatibility requirement for the previous implementation's records; later additions require an explicit decision in the [redevelopment record](../subagents-redevelopment.md).
