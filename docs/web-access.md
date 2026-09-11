# Web access design

[简体中文](i18n/zh-CN/web-access.md) · English is normative.

This document records the design interview in [#43](https://github.com/jczhang02/pi-stuff/issues/43). The decisions below are accepted; the full contract remains under discussion. Implementation starts after the maintainer confirms shared understanding. See the [glossary](../CONTEXT.md) and [maintenance decision](adr/0003-web-access-fork.md).

## Accepted first-release scope

The purpose is to let Pi find current information and read source material during development without leaving the Pi conversation.

| Tool                 | Retained capability                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| `web_search`         | Single or batch searches, with titles, URLs, snippets and sources. Only OpenAI/Codex and Exa providers. |
| `fetch_content`      | Read public webpage text or raw text.                                                                   |
| `get_search_content` | Retrieve stored search or fetched content, including paging and text lookup.                            |

Search and fetching are separate calls. `web_search` does not fetch result-page bodies; remove upstream `includeContent` and its background-fetch state and notifications. The model selects useful links and calls `fetch_content` within the Pi conversation, without a manual result-selection step.

The following upstream features are excluded from the first release:

- Curator, its browser page, local server and result-selection workflow.
- All search providers except OpenAI/Codex and Exa.
- GitHub-specific repository, tree/blob, issue and pull-request reading.
- PDF, image, video and YouTube handling.
- Authenticated-page and browser-cookie reading.
- `source_check`, separate automatic summarization and page-answer generation.
- Hosted content-extraction fallbacks.

Removing GitHub-specific handling does not blacklist GitHub URLs from ordinary public text retrieval. Removing authenticated-page reading does not remove authentication required by the two retained search providers. A search provider's native answer is distinct from an additional summarization call; its output contract remains to be settled.

## Shared tool switches

Pi Stuff must support independent tool switches beyond web access. A switch governs direct model access to one tool entry. Disabling `fetch_content`, for example, removes that direct model entry; it does not by itself prohibit every internal HTTP request or parser call.

Use one global configuration for these switches and apply changes through `/reload`. The first release has no temporary session-switch command or project-level override. The configuration schema and interaction with Pi's own tool selection remain to be specified.

## Content lifetime

Keep stored search results and fetched bodies in bounded, current-session memory only. Do not write a separate content cache to disk or restore content references after Pi restarts or `/reload`. When a reference is no longer available, the model must repeat the search or fetch before paging or searching that content. Exact capacity limits and eviction behavior remain to be specified.

This decision concerns Pi Stuff's content cache. Tool output already included in the conversation remains subject to Pi's normal session-history behavior.

## Rewrite and source size

The source baseline is npm `pi-web-access@0.28.0`, commit `e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5`. The fork will use the repository's strict TypeScript, Bun and Effect v4 rules. Pure algorithms remain ordinary functions; boundary decoding, typed errors and necessary I/O follow [ADR 0002](adr/0002-effect-quality.md).

Keep source and license notices for imported code, record the version and commit in implementation/PR evidence, and selectively port later upstream fixes. There is no promise to preserve upstream layout, configuration or tool-interface compatibility. Dependencies and final interfaces require concrete review before implementation.

The inspected baseline contains **25,795 source lines across 66 runtime files**. This is the `cloc` code column, excluding comments, blank lines, tests, documentation, declaration files and standalone assets; page code embedded in TypeScript is included. Third-party dependency internals are excluded.

Report the rewritten runtime source using the same counting scope, and list tests, documentation and dependencies separately. Explain size changes through retained and removed functionality. Do not impose a hard total, demand an extra percentage reduction at equal functionality, compress readable code to improve a count, or remove needed verification to meet a target. The final count requires an implemented diff; static deletion estimates are not measurements of the rewrite.

## Unresolved contracts

Search/fetch separation, current-session memory storage and global tool-switch configuration applied through `/reload` are accepted.

The remaining design also needs to settle provider authentication and fallback, native search answers, public-page extraction coverage, and bounded retrieval/storage behavior. Existing runtime capabilities and source evidence should resolve implementation facts; product choices belong in the interview. This document does not approve a dependency list, disk format or complete tool schema.

## Source evidence

- [Tool registration and orchestration](https://github.com/nicobailon/pi-web-access/blob/e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5/index.ts).
- [OpenAI/Codex search](https://github.com/nicobailon/pi-web-access/blob/e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5/openai-search.ts) and [Exa search](https://github.com/nicobailon/pi-web-access/blob/e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5/exa.ts).
- [Content extraction](https://github.com/nicobailon/pi-web-access/blob/e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5/extract.ts), [storage](https://github.com/nicobailon/pi-web-access/blob/e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5/storage.ts) and [text lookup](https://github.com/nicobailon/pi-web-access/blob/e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5/content-find.ts).
