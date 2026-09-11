# Web access specification

[简体中文](i18n/zh-CN/web-access.md) · English is normative.

Terminology follows the [glossary](../CONTEXT.md) and [independent maintenance decision](adr/0003-web-access-fork.md).

## Problem Statement

During development in Pi, the maintainer needs to find current documentation and other source material, read useful public pages, and revisit retrieved content without leaving the conversation. The upstream pi-web-access package covers many unrelated workflows and providers, creating more code and maintenance work than this project needs. Pi Stuff also needs a consistent way to disable any individual tool, including tools outside web access.

## Solution

Independently maintain a reduced rewrite based on pi-web-access 0.28.0. Provide web_search, fetch_content and get_search_content, with OpenAI/Codex and Exa as the only search providers. The model searches, chooses links and reads them automatically within Pi. Retain one public-text extraction path, bounded current-session content storage and global independent tool switches applied through /reload. Remove the agreed upstream features and preserve the accepted limits, source provenance and license notices. Use the repository's TypeScript, Bun and Effect v4 rules.

## User Stories

1. As a developer using Pi, I want to search the web within the conversation, so that I can consult current information while coding.
2. As a developer, I want the model to select useful result links and fetch them, so that I do not need to curate results in another interface.
3. As a developer, I want search and page fetching to be separate tool calls, so that search does not start hidden background body downloads.
4. As a developer, I want single and batch searches through one input format, so that related questions use the same workflow.
5. As a developer, I want result titles, URLs, snippets and sources, so that I can judge relevance and inspect evidence.
6. As a developer, I want OpenAI's native answer and citations retained, so that useful search output is available without a second summarization request.
7. As a developer, I want Exa to return search results directly, so that a separate answer request does not add work or latency.
8. As a developer, I want to set a maximum result count, so that searches fit the task without promising unavailable sources.
9. As a developer, I want to include domains, so that I can restrict returned sources to relevant sites.
10. As a developer, I want to exclude domains and their subdomains, so that unwanted sources do not appear in the results.
11. As a developer, I want exclusion to take precedence over inclusion, so that overlapping filters have a predictable result.
12. As a developer, I want all filtered searches to use Exa and validate returned URLs, so that provider differences do not silently weaken filtering.
13. As a developer, I want a clear error when domain filtering lacks an Exa key, so that I know which configuration is required.
14. As a developer, I want ordinary searches to use a globally preferred provider, so that I do not specify a backend in every tool call.
15. As a developer, I want an available provider selected before a request when the preferred one is unconfigured, so that an optional backend does not prevent searching.
16. As a developer, I want at most one fallback for temporary provider failures, so that an occasional outage can be handled without a long retry chain.
17. As a developer, I want authentication errors, invalid requests and valid empty results reported directly, so that fallback does not hide the underlying outcome.
18. As a developer, I want the actual provider and fallback recorded, so that I can understand how a result was obtained.
19. As a developer, I want to reuse Pi's official OpenAI/Codex authentication, so that I do not maintain another login or credential system.
20. As a developer, I want an explicit search model to override the conversation model, so that search remains predictable when I switch chat models.
21. As a developer, I want a compatible current model reused when no search model is configured, so that the common case needs less configuration.
22. As a developer, I want an invalid explicit model reported instead of guessed around, so that configuration mistakes remain visible.
23. As a developer, I want Exa authentication read from EXA_API_KEY, so that the extension has one clear Exa credential source.
24. As a developer, I want readable public HTML converted to Markdown, so that the model can inspect page content in a useful form.
25. As a developer, I want raw textual responses, including Markdown and JSON, so that I can read sources that do not need article extraction.
26. As a developer, I want ordinary public GitHub URLs treated like other public text URLs, so that removing special GitHub handling does not blacklist the site.
27. As a developer, I want extraction, HTTP and unsupported-content failures reported, so that the model can choose another source.
28. As a developer, I want each batch input to retain its own ordered success or error, so that one failed page or query does not discard other results.
29. As a developer, I want content references and bounded previews, so that large pages do not flood the conversation.
30. As a developer, I want to page through retained content using continuation information, so that output truncation does not skip material.
31. As a developer, I want literal case-insensitive text lookup with nearby context, so that I can locate a term without reading the entire page.
32. As a developer, I want expired or evicted references to explain that I must search or fetch again, so that I can recover without guessing.
33. As a developer, I want the content cache limited to the current session's memory, so that the extension does not create a disk-content archive.
34. As a developer, I want content references cleared on restart, reload and session switch, so that their lifetime is explicit.
35. As a developer, I want the oldest stored content evicted when the cache is full, so that a long session stays within the content budget.
36. As a developer, I want cancellation to stop active and queued work, so that cancelled searches do not trigger further provider requests.
37. As a developer, I want bounded inputs, responses, attempts and output, so that one request cannot grow without limit.
38. As a developer, I want page retrieval restricted to public HTTP(S) destinations throughout redirects, so that this web tool does not become a private-network or authenticated-page reader.
39. As a developer, I want each Pi Stuff tool independently disabled through global configuration, so that I can expose only the tools I want.
40. As a developer, I want the same switch mechanism available to future Pi Stuff tools, so that web access does not define a special configuration system.
41. As a developer, I want switch changes applied through /reload, so that the extension has one clear configuration lifecycle.
42. As a developer, I want Pi Stuff switches and Pi's own tool selection both respected, so that enabling one does not override a disable in the other.
43. As a developer, I want disabling fetching to leave search and existing cached-content lookup independent, so that tool switches do not introduce hidden cascades.
44. As a developer, I want missing configuration to use defaults and invalid configuration to report an error, so that setup remains simple and mistakes remain visible.
45. As a developer, I want Pi's default tool presentation, so that web access does not add a panel, browser flow or custom interaction model.
46. As a maintainer, I want a rewrite that follows the repository's module and I/O rules, so that future Pi Stuff development uses a consistent codebase.
47. As a maintainer, I want imported notices and fixed upstream provenance retained, so that the independently maintained fork remains traceable.
48. As a maintainer, I want comparable runtime source counts and separate test, documentation and dependency reporting, so that feature reduction can be assessed without code compression.
49. As a maintainer, I want tests through the public tool contract and actual Pi-host acceptance, so that the evidence describes behavior I rely on.
50. As a maintainer, I want selective upstream fixes and no compatibility promise for upstream internals, so that removed features do not return through routine upstream merges.

## Implementation Decisions

- **Ownership and modules:** The web-access capability owns search, public-text retrieval, retained content and their rules. A small shared tool-switch capability owns global tool availability for all Pi Stuff tools. The Pi integration composes these capabilities with host model/authentication and lifecycle services; the network boundary handles provider and page I/O. Prefer these existing host boundaries to additional frameworks or pass-through layers. Compare any new abstraction with an inline or simpler alternative under the repository rules.
- **Tool contracts:** web_search accepts a nonempty queries array and optional maxResults, includeDomains and excludeDomains. fetch_content accepts a nonempty urls array and optional mode, readable or raw, defaulting to readable. get_search_content accepts contentId with either optional offset/limit or one find string; mixing find with paging options is invalid. A single search or URL is a one-element array. Provider choice is global, not a per-call argument.
- **Search/fetch separation:** web_search never downloads result-page bodies, starts background content tasks or emits completion notifications for them. The model calls fetch_content separately after selecting sources. Search responses contain a query, actual provider, ordered source results, optional native answer, content reference and bounded preview. Every batch input has its own ordered success or error.
- **Authentication and model selection:** Reuse Pi's authentication for official OpenAI/Codex models only. An explicit search-model provider/ID must exactly match an existing compatible Pi model and takes precedence. Otherwise reuse a compatible current model; never guess from names, price tiers or registry order. A different chat provider therefore requires explicit OpenAI search-model configuration or Exa. Read Exa authentication only from EXA_API_KEY. Exa uses its search endpoint, without an answer endpoint or keyless MCP route.
- **Configuration:** Use one global Pi Stuff configuration named pi-stuff.json in the host-resolved agent directory. The file and fields are optional: known tools default to enabled, and the preferred search provider defaults to openai, with exa as the alternative. The tools map holds per-tool booleans; web.provider selects the preferred provider, and optional web.openaiModel holds the explicit OpenAI/Codex model provider/ID. No upstream configuration migration, project override or temporary-session switch command is included. Invalid explicit configuration fails visibly rather than choosing another model. Invalid configuration leaves Pi Stuff tools unavailable until corrected and reloaded; it does not rewrite configuration or change other extensions.
- **Tool switches:** Changes apply through /reload. A switch controls direct model access to one tool, not every internal use of its underlying capability. Globally disabled tools cannot be re-enabled through Pi's tool selection; globally enabled tools still respect a disable from Pi. Switching one tool off does not cascade to another.
- **Ordinary search routing:** Before requesting, choose a configured compatible provider; if the preferred provider is unconfigured, use the other available provider and report the selection. After a request starts, permit at most one attempt on the other provider for transport errors, timeout, HTTP 408, 429 or 5xx. Never retry the same provider. Authentication/configuration/request errors, malformed responses, unsupported capabilities, cancellation and valid empty results do not trigger fallback.
- **Domain filtering:** Any nonempty include/exclude filter selects Exa regardless of the preferred provider. Require an Exa key and never fall back to OpenAI/Codex for that query. Pass the filters to Exa and validate returned source URL hosts. A domain matches itself and its subdomains; exclusion wins. Return fewer valid results when needed, without promising exhaustive subdomain coverage. Domains are hostnames, not URL or wildcard expressions. Do not replace constraints with query hints.
- **Native answers and time:** Preserve OpenAI's native answer and citations without a separate summarization call. Exa supplies search results only. Result count is an upper bound. There is no dedicated recency parameter; dates in query text express intent, not guaranteed publication-date filtering.
- **Extraction and network scope:** Use one main-content HTML extraction and Markdown-conversion path. Raw mode handles textual responses such as plain text, Markdown, JSON and HTML, not binary conversion. HTTP errors and extraction failures remain errors. Only public HTTP(S) destinations are allowed, including every redirect target; allow at most five redirects. Reject localhost/private-network destinations and caller-supplied credentials, cookies and headers. Removing GitHub-specific handling does not block ordinary public GitHub URLs.
- **Stored content:** Keep retained search content and fetched text only in current-session memory. Successful references support later paging/find; full retained bodies must not be hidden in tool-result details or session custom entries. Normal visible tool output remains subject to Pi's conversation-history behavior. Clear on restart, reload or session switch. No disk cache, recovery, TTL or request deduplication. Evict oldest-stored content first at either cache limit; unavailable references instruct the caller to search or fetch again.
- **Paging and find:** Offsets and lengths use JavaScript UTF-16 code units. Return actual continuation offsets and total length under the output byte budget. Find is one nonempty, case-insensitive literal term, with match positions and nearby excerpts; omit regex, fuzzy matching and multi-term search. Report whether more matches exist.
- **Fixed limits:** Use the following defaults instead of a configuration option for every value. These are accepted boundaries, not benchmark results.

| Boundary          | Contract                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Batch/concurrency | At most 5 queries or URLs per call; at most 3 items in flight per call; a query attempts providers sequentially.        |
| Results           | Default 5, maximum 20 per query; fewer is valid.                                                                        |
| Input             | Query at most 2,000 UTF-16 code units; URL at most 8,192; each domain list at most 20 entries.                          |
| Time              | 30 seconds per provider attempt or page fetch; one fallback allows at most two attempts per ordinary query.             |
| Response/content  | At most 5 MiB per network response body and 1 MiB of retained text per item, measured as UTF-8; excess fails that item. |
| Cache             | At most 64 entries and 32 MiB of UTF-8 content; this is a content budget, not total process heap.                       |
| Visible output    | At most 32 KiB of model-visible text per tool result, with truncation and continuation metadata.                        |
| Paging            | Default page/preview 8,000 UTF-16 code units; requested page limit at most 20,000, also subject to the byte budget.     |
| Find              | One term of at most 200 UTF-16 code units; at most 10 matches, with up to 200 code units on each side.                  |

- **Cancellation and presentation:** Cancellation stops active and queued work and starts no fallback. Use Pi's default tool rendering, with no separate activity panel, progress command, browser server or custom renderer.
- **Toolchain and dependencies:** Keep strict TypeScript, Bun 1.4.0 and Effect 4.0.0-rc.112. Pure algorithms stay ordinary functions; Effect handles application boundaries, typed failures and necessary I/O. Approved runtime additions are @mozilla/readability 0.6.0 (Apache-2.0), linkedom 0.18.13 (ISC), turndown 7.2.4 (MIT) and typebox 1.3.7 (MIT); add @types/turndown 5.0.6 (MIT) for development. TypeBox supplies the host-required tool parameter schema, while Effect handles configuration and provider-response decoding. Pi Coding Agent and directly imported Pi AI are host peer dependencies, using the inspected 0.85.1 baseline; actual Bun-host compatibility must be verified. No direct Pi TUI dependency is needed for default rendering.
- **Provider adapters:** Reuse Pi model/authentication services, but retain dedicated official OpenAI Responses/Codex search requests because the inspected ordinary Pi model interface does not expose hosted web_search. Use direct Exa search requests. No OpenAI/Exa SDK, p-limit, undici, defuddle, unpdf or compatibility polyfill is included in the approved dependency plan.
- **Maintenance and size:** Base the rewrite on pi-web-access 0.28.0 at commit e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5, preserve imported source/license notices and record provenance in implementation evidence. Selectively port upstream fixes without promising upstream layout, configuration or tool-interface compatibility. Compare runtime source against the inspected 25,795 code lines across 66 files using the same cloc scope: exclude blanks, comments, tests, docs, declarations, standalone assets and dependency internals; include UI embedded in TypeScript. Report tests, documentation and dependencies separately. Reduce through agreed feature removal, without a hard cap, same-function quota, compressed formatting or deleted necessary verification.

## Testing Decisions

- **Primary seam:** Exercise the registered tools through the complete web-access capability. Keep real routing, parsing, filtering, storage and output behavior in these tests. Substitute only host/environment and network boundaries with deterministic supplied adapters; do not mock modules, test private helpers by default or build a generic test framework. This follows the public tool contracts and verification scope confirmed in the design interview.
- **What a good test proves:** Observable inputs produce the promised output, failure, state transition or resource cleanup. Assert returned sources and metadata, continuation correctness, tool availability and externally visible request behavior; avoid assertions about helper names, internal call structure or incidental serialization.
- **Search cases:** Cover single/batch ordering and partial failure; exact model selection and authentication reuse; configured-provider selection; every fallback and non-fallback class; one-fallback maximum; cancellation before/during requests and while queued; native answer/citations; valid empty results; result caps; and malformed provider data. Distinguish an unconfigured provider from failed authentication.
- **Filtering cases:** Verify Exa-only selection even when OpenAI is preferred, missing-key failure, inclusion and exclusion together, exclusion precedence, exact/subdomain host matching, invalid host input, post-validation of returned URLs, fewer valid results and no fallback that relaxes filters. Provider request fixtures should verify the external request contract, not private adapter structure.
- **Fetch cases:** Use representative public HTML, plain text, Markdown and JSON fixtures through the real extraction path. Cover empty/unextractable pages, binary content, HTTP failures, redirect limits, public-address checks on initial and redirected targets, cancellation, timeouts and byte/text limits. Controlled local fixtures must not weaken the production public-destination policy.
- **Storage/output cases:** Verify exact paging continuation across byte truncation, UTF-16 positions, bounded previews, literal case-insensitive find and context, mixed-parameter rejection, count and byte-budget eviction, unavailable-reference recovery instructions, and cache clearing on restart/reload/session switch. Verify that full retained content is not persisted through hidden result details or custom entries.
- **Switch/configuration cases:** Verify defaults, invalid configuration, independent switches, unchanged unrelated tools, /reload application, and intersection with Pi's own tool selection. Cover a disabled fetch tool while search and existing-content lookup remain independently available.
- **Actual host acceptance:** Load the extension in the maintainer's supported Bun-compiled Pi using isolated settings, sessions and unrelated resources. Run search-to-fetch-to-page/find, cancellation, reload and tool-switch scenarios. Record actual Pi/Bun versions and environment; cached SDK declarations alone are not acceptance. Separate deterministic/offline evidence from live OpenAI/Codex and Exa checks using explicitly selected accounts/models, and report unavailable required checks.
- **Prior art and runners:** The repository has no owned product suite or test script to reuse. Use Bun's test runner and the existing QA policy when adding the first real suite and its CI entry, including the policy's pinned actionlint requirement. Existing tuistory 0.11.0 and the Pi 0.85.1/Bun 1.4.0 experiment in #29 provide terminal-driver prior art, not proof of web behavior. Use tuistory only where real terminal interaction needs verification; deterministic fixtures and RPC can cover other host behavior.
- **Review and evidence:** Run the repository's required static checks and focused behavior tests. Obtain the mandatory independent full-diff standards/requirements review under the strict code-quality skill for substantive implementation, and the required high-risk review for dependencies, interfaces, network/cancellation and state boundaries. Fix or independently refute structural findings; tests alone are not a rebuttal. No coverage quota, placeholder suite, retired governance tests or TDD claim without an observed failing test.

## Out of Scope

- Curator, browser curation, its local server, manual result selection and any alternate search-result UI.
- All search providers except official OpenAI/Codex and Exa; provider fan-out, complex routing and retries beyond the accepted single fallback.
- Keyless Exa MCP, Exa answer requests, separate OpenAI credentials/login, credential commands, custom gateways and upstream configuration compatibility.
- Search-triggered page-body downloads, includeContent, background fetching state and associated completion notifications.
- GitHub-specific repository/tree/blob/issue/PR reading; PDF, image, video and YouTube handling; authenticated-page/browser-cookie reading; private-network fetches.
- source_check, additional automatic summaries, page-answer generation and hosted content-extraction fallbacks.
- A second HTML parser, RSC-specific extraction, JavaScript/browser rendering and arbitrary binary-to-text conversion.
- Dedicated recency filtering, regex/fuzzy/multi-term content find, disk content caches, restart recovery, TTL and request deduplication.
- Temporary-session switch commands, project configuration overrides, custom tool rendering, activity panels, progress commands and automatic upstream migration.
- Subagent functionality and the separately owned research in #41.
- Hard source-line targets, equal-function shrink quotas, new test frameworks, coverage mandates, speculative performance work, merge/release authorization or claims of untested runtime support.

## Further Notes

The maintainer confirmed the complete contract and ended the design interview on 2026-09-11, then requested publication through to-spec. The design record is [#43](https://github.com/jczhang02/pi-stuff/issues/43), with documentation in [PR #44](https://github.com/jczhang02/pi-stuff/pull/44). The implementation specification is published in [#45](https://github.com/jczhang02/pi-stuff/issues/45), ready for an agent to claim under the repository workflow; publishing this spec does not start implementation or authorize merging either PR.

Implementation acceptance requires:

- [ ] All three tools and the shared switches implement the contracts, defaults, limits and exclusions above.
- [ ] Provider/model/authentication selection and domain filtering preserve their stated semantics, including failure paths.
- [ ] Search, fetch, paging/find, partial failures, cancellation, cache eviction and lifecycle behavior pass applicable tests.
- [ ] Actual supported-host acceptance and required provider evidence are recorded; unavailable required checks remain explicit.
- [ ] Runtime source counts use the stated upstream comparison scope, and imported notices/provenance are retained.
- [ ] English/Chinese usage and configuration documentation describe the delivered behavior and known limits.
- [ ] Repository checks and required independent reviews pass, and unresolved structural or high-risk findings are cleared.
- [ ] Implementation is delivered through its own focused PR with actual evidence; merge and release retain separate authorization.

The inspected upstream source is [pi-web-access 0.28.0](https://github.com/nicobailon/pi-web-access/tree/e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5). Official [OpenAI Responses](https://platform.openai.com/docs/api-reference/responses-streaming?lang=python) and [Exa search](https://exa.ai/docs/reference/search) references informed the accepted filtering boundary. Pi 0.85.1 package declarations and lifecycle documentation informed host integration; they were inspected without starting Pi or reading credentials. Product behavior, dependency integration and live providers have not been validated by this specification work.
