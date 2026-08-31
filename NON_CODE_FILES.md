# Non-code file review checklist

[Simplified Chinese](docs/i18n/zh-CN/NON_CODE_FILES.md)

## What this file is for

After setting aside code and screenshots, which repository files still need review? This file is the checklist. Use it
when reviewing or reorganizing documentation, configuration, metadata, licenses, and test data so no file gets missed.

Images are not listed here. Source files, scripts, and native executables stay in code review.

The paths below are a snapshot taken on 2026-08-31 from the `docs/readme-rewrite` worktree. They are relative to the
repository root and sorted lexicographically within each group.

## Scope

- Source of truth: the final tracked file set reported by `git ls-files`, including this checklist and its Chinese mirror.
- Included: prose and documentation, structured configuration and data, text captures, locks, patches, checksums,
  upstream metadata, repository metadata, ownership metadata, and license text.
- Excluded as code: TypeScript, JavaScript, shell scripts, and native executables.
- Excluded as images: PNG files.
- Machine state, caches, ignored files, and untracked files are outside this inventory.

## Summary

| Kind | Files |
| --- | ---: |
| Markdown (`.md`) | 265 |
| JSON (`.json`) | 39 |
| JSON Lines (`.jsonl`) | 5 |
| YAML (`.yml`) | 6 |
| Text (`.txt`) | 7 |
| ANSI text captures (`.ansi`) | 2 |
| Lockfile (`.lock`) | 1 |
| Patch (`.patch`) | 1 |
| Checksum metadata (`.sha256`) | 1 |
| Upstream metadata (`.upstream`) | 1 |
| Hidden repository metadata | 4 |
| Ownership metadata | 1 |
| Extensionless license files | 19 |
| **Included non-code files** | **352** |
| Excluded code or executable files | 936 |
| Excluded image files | 35 |
| **Final tracked files** | **1323** |

## Markdown (`.md`)

- `.github/CONTRIBUTING.md`
- `.github/SECURITY.md`
- `AGENTS.md`
- `CONTEXT.md`
- `DESIGN.md`
- `NON_CODE_FILES.md`
- `README.md`
- `docs/README.md`
- `docs/adr/0001-keep-pi-as-the-host.md`
- `docs/adr/0004-route-suite-diagnostics-through-owned-ui.md`
- `docs/adr/0006-cache-unchanged-suite-modules-across-host-reload.md`
- `docs/adr/0007-initialize-configured-context-before-editor-readiness.md`
- `docs/adr/0008-own-the-context-command-surface.md`
- `docs/adr/0009-align-code-mode-with-openai-and-cloudflare.md`
- `docs/adr/0012-merge-pi-stuff-settings-file.md`
- `docs/adr/0015-certify-the-upstream-release-binary.md`
- `docs/adr/0017-project-chart-and-tree-fences-inside-conversation-markdown.md`
- `docs/adr/0018-end-live-v1-agent-governor-coexistence.md`
- `docs/adr/0019-isolate-context-engine-work-from-the-host-ui-thread.md`
- `docs/adr/0020-add-automatic-session-naming.md`
- `docs/adr/0021-fork-ponytail-as-a-suite-capability.md`
- `docs/adr/0022-restrict-folding-to-native-retrieval.md`
- `docs/adr/0023-use-a-closed-operation-block-family.md`
- `docs/agents/domain.md`
- `docs/agents/issue-tracker.md`
- `docs/agents/triage-labels.md`
- `docs/architecture.md`
- `docs/capabilities/background-work.md`
- `docs/capabilities/btw.md`
- `docs/capabilities/code-mode.md`
- `docs/capabilities/codex.md`
- `docs/capabilities/context-management.md`
- `docs/capabilities/conversation-ui.md`
- `docs/capabilities/goal.md`
- `docs/capabilities/mcp.md`
- `docs/capabilities/notification.md`
- `docs/capabilities/ponytail.md`
- `docs/capabilities/rtk.md`
- `docs/capabilities/session-naming.md`
- `docs/capabilities/subagents.md`
- `docs/capabilities/todo.md`
- `docs/capabilities/tool-display.md`
- `docs/capabilities/web.md`
- `docs/code-quality.md`
- `docs/compatibility.md`
- `docs/getting-started.md`
- `docs/i18n/zh-CN/.github/CONTRIBUTING.md`
- `docs/i18n/zh-CN/.github/SECURITY.md`
- `docs/i18n/zh-CN/AGENTS.md`
- `docs/i18n/zh-CN/CONTEXT.md`
- `docs/i18n/zh-CN/DESIGN.md`
- `docs/i18n/zh-CN/NON_CODE_FILES.md`
- `docs/i18n/zh-CN/README.md`
- `docs/i18n/zh-CN/docs/README.md`
- `docs/i18n/zh-CN/docs/adr/0001-keep-pi-as-the-host.md`
- `docs/i18n/zh-CN/docs/adr/0004-route-suite-diagnostics-through-owned-ui.md`
- `docs/i18n/zh-CN/docs/adr/0006-cache-unchanged-suite-modules-across-host-reload.md`
- `docs/i18n/zh-CN/docs/adr/0007-initialize-configured-context-before-editor-readiness.md`
- `docs/i18n/zh-CN/docs/adr/0008-own-the-context-command-surface.md`
- `docs/i18n/zh-CN/docs/adr/0009-align-code-mode-with-openai-and-cloudflare.md`
- `docs/i18n/zh-CN/docs/adr/0012-merge-pi-stuff-settings-file.md`
- `docs/i18n/zh-CN/docs/adr/0015-certify-the-upstream-release-binary.md`
- `docs/i18n/zh-CN/docs/adr/0017-project-chart-and-tree-fences-inside-conversation-markdown.md`
- `docs/i18n/zh-CN/docs/adr/0018-end-live-v1-agent-governor-coexistence.md`
- `docs/i18n/zh-CN/docs/adr/0019-isolate-context-engine-work-from-the-host-ui-thread.md`
- `docs/i18n/zh-CN/docs/adr/0020-add-automatic-session-naming.md`
- `docs/i18n/zh-CN/docs/adr/0021-fork-ponytail-as-a-suite-capability.md`
- `docs/i18n/zh-CN/docs/adr/0022-restrict-folding-to-native-retrieval.md`
- `docs/i18n/zh-CN/docs/adr/0023-use-a-closed-operation-block-family.md`
- `docs/i18n/zh-CN/docs/agents/domain.md`
- `docs/i18n/zh-CN/docs/agents/issue-tracker.md`
- `docs/i18n/zh-CN/docs/agents/triage-labels.md`
- `docs/i18n/zh-CN/docs/architecture.md`
- `docs/i18n/zh-CN/docs/capabilities/background-work.md`
- `docs/i18n/zh-CN/docs/capabilities/btw.md`
- `docs/i18n/zh-CN/docs/capabilities/code-mode.md`
- `docs/i18n/zh-CN/docs/capabilities/codex.md`
- `docs/i18n/zh-CN/docs/capabilities/context-management.md`
- `docs/i18n/zh-CN/docs/capabilities/conversation-ui.md`
- `docs/i18n/zh-CN/docs/capabilities/goal.md`
- `docs/i18n/zh-CN/docs/capabilities/mcp.md`
- `docs/i18n/zh-CN/docs/capabilities/notification.md`
- `docs/i18n/zh-CN/docs/capabilities/ponytail.md`
- `docs/i18n/zh-CN/docs/capabilities/rtk.md`
- `docs/i18n/zh-CN/docs/capabilities/session-naming.md`
- `docs/i18n/zh-CN/docs/capabilities/subagents.md`
- `docs/i18n/zh-CN/docs/capabilities/todo.md`
- `docs/i18n/zh-CN/docs/capabilities/tool-display.md`
- `docs/i18n/zh-CN/docs/capabilities/web.md`
- `docs/i18n/zh-CN/docs/code-quality.md`
- `docs/i18n/zh-CN/docs/compatibility.md`
- `docs/i18n/zh-CN/docs/getting-started.md`
- `docs/i18n/zh-CN/docs/readme-style.md`
- `docs/i18n/zh-CN/docs/reference/commands.md`
- `docs/i18n/zh-CN/docs/reference/settings.md`
- `docs/i18n/zh-CN/docs/reference/themes.md`
- `docs/i18n/zh-CN/docs/releases/0.1.0.md`
- `docs/i18n/zh-CN/docs/releases/0.2.1.md`
- `docs/i18n/zh-CN/docs/releases/0.2.2.md`
- `docs/i18n/zh-CN/docs/reports/README.md`
- `docs/i18n/zh-CN/docs/reports/context-submit-concurrency-research-2026-08-14.md`
- `docs/i18n/zh-CN/docs/reports/dialog-readability-20260817/image-handoff.md`
- `docs/i18n/zh-CN/docs/reports/pi-stuff-0.3.0-final-acceptance.md`
- `docs/i18n/zh-CN/docs/reports/pi-stuff-lifecycle-performance.md`
- `docs/i18n/zh-CN/docs/reports/pi-stuff-ui-review-2026-08-05.md`
- `docs/i18n/zh-CN/docs/reports/ps-8z1-final-acceptance-2026-08-29.md`
- `docs/i18n/zh-CN/docs/reports/single-package-migration.md`
- `docs/i18n/zh-CN/docs/reports/terminal-bench-2.1-pi-stuff-latency-2026-08-30.md`
- `docs/i18n/zh-CN/docs/reports/tool-folding-comparison-20260806/design_rationale.md`
- `docs/i18n/zh-CN/docs/research/README.md`
- `docs/i18n/zh-CN/docs/research/agent-activity-ui-reference.md`
- `docs/i18n/zh-CN/docs/research/claude-code-tool-grouping-narrative-boundary-20260826.md`
- `docs/i18n/zh-CN/docs/research/claude-code-transcript-source-decisions.md`
- `docs/i18n/zh-CN/docs/research/code-mode-cloudflare-openai-design-20260815.md`
- `docs/i18n/zh-CN/docs/research/code-mode-image-benchmark-20260827.md`
- `docs/i18n/zh-CN/docs/research/code-volume-reduction-20260823.md`
- `docs/i18n/zh-CN/docs/research/live-only-thoughts-feasibility-20260813.md`
- `docs/i18n/zh-CN/docs/research/notification-capability-reference.md`
- `docs/i18n/zh-CN/docs/research/pi-latest-markdown-transform-20260820.md`
- `docs/i18n/zh-CN/docs/research/pi-stuff-operation-block-dialog-study-20260829.md`
- `docs/i18n/zh-CN/docs/research/pi-stuff-tool-activity-taxonomy-20260806.md`
- `docs/i18n/zh-CN/docs/research/pi-tmux-kitty-images-feasibility-20260815.md`
- `docs/i18n/zh-CN/docs/research/pi-xdg-base-directory-20260811.md`
- `docs/i18n/zh-CN/docs/research/skill-discovery-benchmark-20260830.md`
- `docs/i18n/zh-CN/docs/research/skill-discovery-confirmation-20260830.md`
- `docs/i18n/zh-CN/docs/research/skill-discovery-direct-read-20260830.md`
- `docs/i18n/zh-CN/docs/research/skill-discovery-isolated-confirmation-20260830.md`
- `docs/i18n/zh-CN/docs/research/skill-discovery-startup-bounded-confirmation-20260830.md`
- `docs/i18n/zh-CN/docs/research/work-background-notification-ui-reference.md`
- `docs/i18n/zh-CN/docs/research/work-background-package-reference.md`
- `docs/i18n/zh-CN/docs/research/work-btw-package-reference.md`
- `docs/i18n/zh-CN/docs/research/work-btw-ui-reference.md`
- `docs/i18n/zh-CN/docs/research/work-todo-ui-reference.md`
- `docs/i18n/zh-CN/docs/troubleshooting.md`
- `docs/i18n/zh-CN/packages/pi-stuff/CHANGELOG.md`
- `docs/i18n/zh-CN/packages/pi-stuff/README.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/background-work/README.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/background-work/UPSTREAM.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/btw/README.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/btw/UPSTREAM.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/code-mode/README.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/code-mode/UPSTREAM.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/codex/README.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/codex/UPSTREAM.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/context-management/README.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/context-management/UPSTREAM.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/conversation-ui/README.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/conversation-ui/UPSTREAM.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/goal/README.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/goal/UPSTREAM.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/mcp/README.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/mcp/UPSTREAM.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/mcp/runtime/README.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/mcp/runtime/UPSTREAM.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/notification/README.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/ponytail/README.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/ponytail/UPSTREAM.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/rtk/README.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/rtk/UPSTREAM.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/session-naming/README.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/session-naming/UPSTREAM.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/subagents/README.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/subagents/UPSTREAM.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/todo/README.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/todo/UPSTREAM.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/tool-display/README.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/tool-display/UPSTREAM.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/web/README.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/web/UPSTREAM.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/web/runtime/README.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/web/runtime/SECURITY.md`
- `docs/i18n/zh-CN/packages/pi-stuff/src/web/runtime/UPSTREAM.md`
- `docs/i18n/zh-CN/packages/pi-stuff/themes/README.md`
- `docs/readme-style.md`
- `docs/reference/commands.md`
- `docs/reference/settings.md`
- `docs/reference/themes.md`
- `docs/releases/0.1.0.md`
- `docs/releases/0.2.1.md`
- `docs/releases/0.2.2.md`
- `docs/reports/README.md`
- `docs/reports/context-submit-concurrency-research-2026-08-14.md`
- `docs/reports/dialog-readability-20260817/image-handoff.md`
- `docs/reports/pi-stuff-0.3.0-execution-checklist.zh-CN.md`
- `docs/reports/pi-stuff-0.3.0-final-acceptance.md`
- `docs/reports/pi-stuff-lifecycle-performance.md`
- `docs/reports/pi-stuff-ui-review-2026-08-05.md`
- `docs/reports/ps-8z1-final-acceptance-2026-08-29.md`
- `docs/reports/single-package-migration.md`
- `docs/reports/terminal-bench-2.1-pi-stuff-latency-2026-08-30.md`
- `docs/reports/tool-folding-comparison-20260806/design_rationale.md`
- `docs/research/README.md`
- `docs/research/agent-activity-ui-reference.md`
- `docs/research/claude-code-tool-grouping-narrative-boundary-20260826.md`
- `docs/research/claude-code-transcript-source-decisions.md`
- `docs/research/code-mode-cloudflare-openai-design-20260815.md`
- `docs/research/code-mode-image-benchmark-20260827.md`
- `docs/research/code-volume-reduction-20260823.md`
- `docs/research/live-only-thoughts-feasibility-20260813.md`
- `docs/research/notification-capability-reference.md`
- `docs/research/pi-latest-markdown-transform-20260820.md`
- `docs/research/pi-stuff-operation-block-dialog-study-20260829.md`
- `docs/research/pi-stuff-tool-activity-taxonomy-20260806.md`
- `docs/research/pi-tmux-kitty-images-feasibility-20260815.md`
- `docs/research/pi-xdg-base-directory-20260811.md`
- `docs/research/skill-discovery-benchmark-20260830.md`
- `docs/research/skill-discovery-confirmation-20260830.md`
- `docs/research/skill-discovery-direct-read-20260830.md`
- `docs/research/skill-discovery-isolated-confirmation-20260830.md`
- `docs/research/skill-discovery-startup-bounded-confirmation-20260830.md`
- `docs/research/work-background-notification-ui-reference.md`
- `docs/research/work-background-package-reference.md`
- `docs/research/work-btw-package-reference.md`
- `docs/research/work-btw-ui-reference.md`
- `docs/research/work-todo-ui-reference.md`
- `docs/troubleshooting.md`
- `packages/pi-stuff/CHANGELOG.md`
- `packages/pi-stuff/README.md`
- `packages/pi-stuff/src/background-work/README.md`
- `packages/pi-stuff/src/background-work/UPSTREAM.md`
- `packages/pi-stuff/src/btw/README.md`
- `packages/pi-stuff/src/btw/UPSTREAM.md`
- `packages/pi-stuff/src/code-mode/README.md`
- `packages/pi-stuff/src/code-mode/THIRD_PARTY_NOTICES.md`
- `packages/pi-stuff/src/code-mode/UPSTREAM.md`
- `packages/pi-stuff/src/codex/README.md`
- `packages/pi-stuff/src/codex/THIRD_PARTY_NOTICES.md`
- `packages/pi-stuff/src/codex/UPSTREAM.md`
- `packages/pi-stuff/src/context-management/README.md`
- `packages/pi-stuff/src/context-management/UPSTREAM.md`
- `packages/pi-stuff/src/conversation-ui/README.md`
- `packages/pi-stuff/src/conversation-ui/THIRD_PARTY_NOTICES.md`
- `packages/pi-stuff/src/conversation-ui/UPSTREAM.md`
- `packages/pi-stuff/src/goal/README.md`
- `packages/pi-stuff/src/goal/UPSTREAM.md`
- `packages/pi-stuff/src/mcp/README.md`
- `packages/pi-stuff/src/mcp/UPSTREAM.md`
- `packages/pi-stuff/src/mcp/runtime/README.md`
- `packages/pi-stuff/src/mcp/runtime/UPSTREAM.md`
- `packages/pi-stuff/src/notification/README.md`
- `packages/pi-stuff/src/ponytail/README.md`
- `packages/pi-stuff/src/ponytail/THIRD_PARTY_NOTICES.md`
- `packages/pi-stuff/src/ponytail/UPSTREAM.md`
- `packages/pi-stuff/src/ponytail/skills/ponytail-audit/SKILL.md`
- `packages/pi-stuff/src/ponytail/skills/ponytail-debt/SKILL.md`
- `packages/pi-stuff/src/ponytail/skills/ponytail-gain/SKILL.md`
- `packages/pi-stuff/src/ponytail/skills/ponytail-help/SKILL.md`
- `packages/pi-stuff/src/ponytail/skills/ponytail-review/SKILL.md`
- `packages/pi-stuff/src/ponytail/skills/ponytail/SKILL.md`
- `packages/pi-stuff/src/rtk/README.md`
- `packages/pi-stuff/src/rtk/UPSTREAM.md`
- `packages/pi-stuff/src/session-naming/README.md`
- `packages/pi-stuff/src/session-naming/UPSTREAM.md`
- `packages/pi-stuff/src/subagents/README.md`
- `packages/pi-stuff/src/subagents/UPSTREAM.md`
- `packages/pi-stuff/src/todo/README.md`
- `packages/pi-stuff/src/todo/UPSTREAM.md`
- `packages/pi-stuff/src/tool-display/README.md`
- `packages/pi-stuff/src/tool-display/UPSTREAM.md`
- `packages/pi-stuff/src/web/README.md`
- `packages/pi-stuff/src/web/UPSTREAM.md`
- `packages/pi-stuff/src/web/runtime/README.md`
- `packages/pi-stuff/src/web/runtime/SECURITY.md`
- `packages/pi-stuff/src/web/runtime/UPSTREAM.md`
- `packages/pi-stuff/themes/README.md`

## JSON (`.json`)

- `.oxlintrc.json`
- `biome.json`
- `config/typescript/agents-tests.json`
- `config/typescript/agents.json`
- `config/typescript/base.json`
- `config/typescript/goal-upstream-run.json`
- `config/typescript/rtk.json`
- `docs/reports/code-mode-image-20260827/benchmark-v1.json`
- `docs/reports/code-mode-image-20260827/benchmark-v2.json`
- `docs/reports/code-mode-image-20260827/benchmark-v3-luna.json`
- `docs/reports/code-mode-image-20260827/benchmark-v4-luna.json`
- `docs/reports/code-mode-image-20260827/ui/metadata.json`
- `docs/reports/dialog-readability-20260817/content.json`
- `docs/reports/magic-context-real-acceptance.json`
- `docs/reports/skill-discovery-benchmark-20260830.json`
- `docs/reports/skill-discovery-confirmation-20260830.json`
- `docs/reports/skill-discovery-direct-read-20260830.json`
- `docs/reports/skill-discovery-isolated-confirmation-20260830.json`
- `docs/reports/skill-discovery-startup-bounded-confirmation-20260830.json`
- `docs/reports/terminal-bench-2.1-pi-stuff-latency-protocol-2026-08-30.json`
- `docs/reports/terminal-bench-2.1-pi-stuff-latency-results-2026-08-30.json`
- `docs/reports/terminal-bench-2.1-pi-stuff-source-manifest-snapshot-2026-08-30.json`
- `docs/reports/tool-folding-comparison-20260806/content.json`
- `package.json`
- `packages/pi-stuff/package.json`
- `packages/pi-stuff/suite.json`
- `packages/pi-stuff/themes/catppuccin-frappe.json`
- `packages/pi-stuff/themes/catppuccin-latte.json`
- `packages/pi-stuff/themes/catppuccin-macchiato.json`
- `packages/pi-stuff/themes/catppuccin-mocha.json`
- `packages/pi-stuff/tsconfig.json`
- `schemas/suite.schema.json`
- `test/fixtures/skill-discovery-benchmark-run-lock.json`
- `test/fixtures/skill-discovery-confirmation-run-lock.json`
- `test/fixtures/skill-discovery-direct-read-run-lock.json`
- `test/fixtures/skill-discovery-isolated-confirmation-run-lock.json`
- `test/fixtures/skill-discovery-startup-bounded-confirmation-run-lock.json`
- `test/fixtures/smoke-package/package.json`
- `tsconfig.json`

## JSON Lines (`.jsonl`)

- `test/fixtures/skill-discovery-benchmark-manifest.jsonl`
- `test/fixtures/skill-discovery-confirmation-manifest.jsonl`
- `test/fixtures/skill-discovery-direct-read-manifest.jsonl`
- `test/fixtures/skill-discovery-isolated-confirmation-manifest.jsonl`
- `test/fixtures/skill-discovery-startup-bounded-confirmation-manifest.jsonl`

## YAML (`.yml`)

- `.github/ISSUE_TEMPLATE/bug.yml`
- `.github/ISSUE_TEMPLATE/config.yml`
- `.github/ISSUE_TEMPLATE/feature.yml`
- `.github/dependabot.yml`
- `.github/workflows/ci.yml`
- `.github/workflows/pi-upstream-watch.yml`

## Text (`.txt`)

- `docs/reports/code-mode-image-20260827/ui/pi-code-mode.txt`
- `docs/reports/code-mode-image-20260827/ui/pi-direct.txt`
- `packages/pi-stuff/src/btw/prompts/btw-system.txt`
- `packages/pi-stuff/src/code-mode/LICENSES/Apache-2.0.txt`
- `packages/pi-stuff/src/code-mode/LICENSES/Cloudflare-MIT.txt`
- `packages/pi-stuff/src/codex/LICENSES/Apache-2.0.txt`
- `packages/pi-stuff/src/conversation-ui/LICENSES/Howaboua-MIT.txt`

## ANSI text captures (`.ansi`)

- `docs/reports/code-mode-image-20260827/ui/pi-code-mode.ansi`
- `docs/reports/code-mode-image-20260827/ui/pi-direct.ansi`

## Lockfile (`.lock`)

- `bun.lock`

## Patch (`.patch`)

- `patches/@cortexkit%2Fpi-magic-context@0.40.0.patch`

## Checksum metadata (`.sha256`)

- `packages/pi-stuff/src/ponytail/UPSTREAM.sha256`

## Upstream metadata (`.upstream`)

- `packages/pi-stuff/src/ponytail/LICENSE.upstream`

## Hidden repository metadata

- `.bun-version`
- `.editorconfig`
- `.gitattributes`
- `.gitignore`

## Ownership metadata

- `.github/CODEOWNERS`

## Extensionless license files

- `LICENSE`
- `packages/pi-stuff/LICENSE`
- `packages/pi-stuff/src/background-work/LICENSE`
- `packages/pi-stuff/src/btw/LICENSE`
- `packages/pi-stuff/src/code-mode/LICENSE`
- `packages/pi-stuff/src/codex/LICENSE`
- `packages/pi-stuff/src/context-management/LICENSE`
- `packages/pi-stuff/src/conversation-ui/LICENSE`
- `packages/pi-stuff/src/goal/LICENSE`
- `packages/pi-stuff/src/mcp/LICENSE`
- `packages/pi-stuff/src/mcp/runtime/LICENSE`
- `packages/pi-stuff/src/rtk/LICENSE`
- `packages/pi-stuff/src/session-naming/LICENSE`
- `packages/pi-stuff/src/subagents/LICENSE`
- `packages/pi-stuff/src/todo/LICENSE`
- `packages/pi-stuff/src/tool-display/LICENSE`
- `packages/pi-stuff/src/web/LICENSE`
- `packages/pi-stuff/src/web/runtime/LICENSE`
- `packages/pi-stuff/themes/LICENSE`
