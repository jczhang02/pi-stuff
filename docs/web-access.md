# Web access design

[简体中文](i18n/zh-CN/web-access.md) · English is normative.

This document records the design interview in [#43](https://github.com/jczhang02/pi-stuff/issues/43). The scope sections are accepted; the final contract proposal is still awaiting confirmation. Implementation starts after the maintainer confirms shared understanding. See the [glossary](../CONTEXT.md) and [maintenance decision](adr/0003-web-access-fork.md).

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
- Exa's keyless MCP and `/answer` paths, separate web-specific OpenAI credentials, credential commands and custom gateways.
- Parallel provider searches, multi-stage routing, a dedicated recency parameter, secondary HTML parsers, RSC-specific extraction and browser rendering.

Removing GitHub-specific handling does not blacklist GitHub URLs from ordinary public text retrieval. Removing authenticated-page reading does not remove authentication required by the two retained search providers.

## Search providers and results

Reuse Pi's existing authentication for official OpenAI/Codex search. Do not add a second login system, web-specific OpenAI credential configuration, credential commands or custom gateways. Search may use a configured OpenAI/Codex model even when the conversation uses another provider; the concrete model-selection rule remains to be specified. Exa requires an API key and uses `/search` only. Without an Exa key, OpenAI/Codex remains usable.

Make the preferred provider globally configurable, defaulting to OpenAI/Codex. When both providers are available, allow at most one fallback to the other provider for network errors, timeouts, rate limits or server errors. Parameter errors, authentication failures and cancellation end the attempt; a valid empty result does not trigger another search. Record the actual provider and any fallback in the result. Initial availability checks and concrete status mappings remain to be specified.

The shared result contract contains titles, URLs, snippets and sources, with an optional provider-native answer. Preserve OpenAI's native answer and citations without making an additional summarization call. Exa returns search results without a separate answer request.

Keep single or batch queries, a result-count upper bound, and domain inclusion/exclusion. The count is a maximum, not a promise to produce that many sources. Domain filters must not silently become query hints; report unsupported filtering explicitly. Omit a dedicated time-filter parameter. Time requirements may appear in the query, but do not guarantee publication-date filtering.

## Public text extraction

Keep one HTML main-content extraction and Markdown-conversion path, plus raw-text retrieval. Omit a secondary parser, RSC-specific extraction and browser rendering. A page whose content requires JavaScript or cannot be identified by the parser may fail extraction; report that failure so the model can select another source. The concrete parser dependencies remain subject to review.

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

The feature scope, authentication routes, fallback policy, search output, filtering, extraction coverage, content lifetime and tool-switch scope above are accepted.

The remaining contract needs concrete configuration and model-selection rules, interaction with Pi's tool selection, tool schemas, dependency choices and bounded retrieval/storage behavior. Existing runtime capabilities and source evidence should resolve implementation facts; product choices belong in the interview. Final shared-understanding confirmation remains pending. This document does not yet approve a dependency list, configuration format or complete tool schema.

## Final contract proposal — pending confirmation

The following details are recommendations for the next interview round, not accepted decisions or implemented behavior.

### Configuration and host integration

Use `getAgentDir()/pi-stuff.json`, which follows Pi's agent-directory setting and defaults to `~/.pi/agent/pi-stuff.json` in the inspected Pi 0.85.1 SDK. This is Pi Stuff configuration, not a content cache. Do not read or migrate upstream `web-search.json` automatically.

```json
{
  "tools": {
    "web_search": true,
    "fetch_content": true,
    "get_search_content": true
  },
  "web": {
    "provider": "openai",
    "openaiModel": {
      "provider": "openai-codex",
      "id": "<an existing Pi model ID>"
    }
  }
}
```

The file and every field are optional. Known tools default to enabled and `web.provider` defaults to `openai`; its other value is `exa`. If supplied, `web.openaiModel` takes precedence and must exactly identify an existing official OpenAI/Codex model. Otherwise reuse a compatible current conversation model. Do not guess a model from names, pricing tiers or registry order. A conversation using another provider therefore needs an explicit OpenAI search model or an Exa key. Resolve OpenAI authentication through Pi; read Exa's key from `EXA_API_KEY` only.

Before sending a search, select a configured, compatible provider. If the preferred provider is unconfigured, use the other available provider and report the selection. An invalid explicit model or configuration is an error, not a reason to silently select something else. Once a request starts, only the accepted transient failures permit one fallback; use HTTP 408, 429 and 5xx, transport errors and timeouts. Do not retry the same provider. A malformed response or unsupported capability fails explicitly.

Route every query with domain filters to Exa, regardless of the preferred provider; without an Exa key, report that filtering is unavailable. Do not fall back from a filtered Exa search to OpenAI/Codex. The official standard Responses schema documents domain inclusion, but equivalent exclusion and Codex filtering contracts were not established by this inspection. Using one filtering route avoids pretending the two adapters have identical capabilities. Pass the filters to Exa and check returned source URLs as well. A domain matches its exact hostname and subdomains; exclusion wins over inclusion. Return fewer results when necessary, without promising exhaustive subdomain coverage.

Treat Pi Stuff's global switches as an additional restriction on Pi's own tool selection: a global disable cannot be re-enabled through Pi's tool selection, while a global enable does not override a tool disabled by Pi. Switches are independent; disabling fetch does not disable search or access to content already cached. Missing configuration uses defaults. Invalid configuration reports a useful error and leaves Pi Stuff tools unavailable until corrected and reloaded; it does not rewrite the file or alter other extensions' tools.

### Tool inputs and returned content

| Tool                 | Proposed input                                                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web_search`         | `queries: string[]`, optional `maxResults`, `includeDomains`, `excludeDomains`. One query is a one-element array; provider selection stays in global configuration.                                       |
| `fetch_content`      | `urls: string[]`, optional `mode: "readable" \| "raw"`, default `readable`. Raw mode reads textual responses, including plain text, Markdown, JSON and HTML; it does not turn binary responses into text. |
| `get_search_content` | `contentId` plus either optional `offset`/`limit` for paging, or a single `find` string. Reject a call that mixes find and paging options.                                                                |

Search and fetch batches return an independent result or error for each input, in input order. Successful entries carry a content reference, source metadata and a bounded preview; search also records the query, actual provider, result list and optional native answer. Store the complete retained content only in memory, not hidden in tool-result details or session custom entries.

Paging returns the actual next offset and total length. Offsets and lengths use JavaScript UTF-16 code units. Find uses case-insensitive literal matching and returns positions with short surrounding excerpts; omit regular expressions, fuzzy matching and multiple simultaneous find terms. An unavailable reference gives a clear instruction to search or fetch again.

### Fixed initial limits

Keep these as implementation defaults rather than adding user configuration for every value. They are proposed limits, not measured performance claims.

| Boundary                    | Proposed rule                                                                                                                                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Batch size and concurrency  | At most 5 queries or URLs per call; at most 3 items in flight per call. A query uses providers sequentially.                                                                                                                                          |
| Search results              | Default 5, maximum 20 per query; fewer results are valid.                                                                                                                                                                                             |
| Input size                  | Query at most 2,000 UTF-16 code units; URL at most 8,192; at most 20 domains per include/exclude list. Domains are hostnames, not URLs or wildcard expressions.                                                                                       |
| Network timeout             | 30 seconds per provider attempt or page fetch. One fallback permits at most two attempts for a query. Cancellation stops active and queued work and never starts fallback.                                                                            |
| Public-page retrieval       | HTTP(S) public destinations only, including redirect targets; at most 5 redirects. No localhost/private-network access, caller-supplied credentials, cookies or headers. HTTP errors are returned as errors.                                          |
| Response and stored content | At most 5 MiB per network response body and 1 MiB of retained text per item, measured as UTF-8. Exceeding either limit fails that item explicitly.                                                                                                    |
| Memory cache                | At most 64 entries and 32 MiB of UTF-8 content, evicting the oldest stored entry first. This is a content budget, not a guarantee about total process heap. No TTL, disk writes or request deduplication. Clear on restart, reload or session switch. |
| Tool output and paging      | At most 32 KiB of model-visible text per tool result. Default page/preview length 8,000 UTF-16 code units; requested page limit at most 20,000, also subject to the byte budget. Return truncation and continuation metadata.                         |
| Find                        | One nonempty term of at most 200 UTF-16 code units; return at most 10 matches, each with up to 200 code units of context on either side. Report when further matches exist.                                                                           |

Use Pi's default tool rendering. No separate activity panel, custom renderer, progress command or browser UI is part of this proposal. Verification must cover the owned filtering, fallback, cancellation, public-network boundary, output limits, cache eviction and reload behavior. Real-host and live-provider acceptance remain future implementation work.

### Dependency proposal

Keep the existing Effect v4 dependency. The proposed new runtime pins are `@mozilla/readability@0.6.0` (Apache-2.0), `linkedom@0.18.13` (ISC), `turndown@7.2.4` (MIT) and `typebox@1.3.7` (MIT). The first three provide the single extraction path; TypeBox matches the inspected Pi 0.85.1 SDK's dependency. Preserve all applicable notices. These are dependency candidates, not an installation or a runtime compatibility claim.

Add `@types/turndown@5.0.6` (MIT) as a development-only type dependency. TypeBox declares the host tool inputs; keep configuration and provider-response decoding under the existing Effect rule rather than introducing another application-wide validation framework.

Use Pi Coding Agent and, if directly imported, Pi AI as host peer dependencies, with 0.85.1 as the inspected development baseline; do not claim support for other host versions without evidence. Use the host's default rendering without a Pi TUI dependency. No OpenAI/Exa SDK, `p-limit`, `undici`, `defuddle`, `unpdf` or compatibility polyfill is proposed.

Pi's ordinary model-completion interface does not expose a native hosted `web_search` tool in the inspected 0.85.1 declarations. Reuse its model/authentication services, but keep a dedicated official OpenAI Responses/Codex search adapter. This SDK inspection does not establish compatibility with the running Bun-compiled host; that requires actual extension acceptance.

## Source evidence

- [Tool registration and orchestration](https://github.com/nicobailon/pi-web-access/blob/e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5/index.ts).
- [OpenAI/Codex search](https://github.com/nicobailon/pi-web-access/blob/e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5/openai-search.ts) and [Exa search](https://github.com/nicobailon/pi-web-access/blob/e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5/exa.ts).
- [Content extraction](https://github.com/nicobailon/pi-web-access/blob/e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5/extract.ts), [storage](https://github.com/nicobailon/pi-web-access/blob/e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5/storage.ts) and [text lookup](https://github.com/nicobailon/pi-web-access/blob/e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5/content-find.ts).
- [OpenAI Responses API reference](https://platform.openai.com/docs/api-reference/responses-streaming?lang=python) and [Exa search API reference](https://exa.ai/docs/reference/search), inspected for filter capabilities on 2026-09-11.
- Published [Pi Coding Agent 0.85.1](https://registry.npmjs.org/@earendil-works/pi-coding-agent/0.85.1) and [Pi AI 0.85.1](https://registry.npmjs.org/@earendil-works/pi-ai/0.85.1): inspected the cached package declarations, agent-directory implementation and extension lifecycle documentation, without starting Pi or reading user credentials.
- Dependency metadata: [Readability](https://registry.npmjs.org/@mozilla/readability/0.6.0), [linkedom](https://registry.npmjs.org/linkedom/0.18.13), [Turndown](https://registry.npmjs.org/turndown/7.2.4), [TypeBox](https://registry.npmjs.org/typebox/1.3.7) and [Turndown types](https://registry.npmjs.org/@types/turndown/5.0.6).
