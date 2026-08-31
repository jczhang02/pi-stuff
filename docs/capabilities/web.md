# Web

[Simplified Chinese](../i18n/zh-CN/docs/capabilities/web.md)

Web searches configured providers, fetches public HTTP content, and retrieves bounded slices from stored results.

## Quick start

Search:

```json
{ "query": "Pi coding agent extension API" }
```

Fetch a result:

```json
{ "url": "https://example.com", "mode": "readable" }
```

Use the returned `responseId` with `get_search_content` when more content or a matching passage is needed.

## Tools

### `web_search`

| Field | Contract |
| --- | --- |
| `query` or `queries` | One query or up to four queries |
| `numResults` | 1–20 results |
| `recency` | `day`, `week`, `month`, or `year` |
| `domainFilter` | Up to 20 included or excluded domains |
| `provider` | One provider, up to eight providers, `auto`, or `all` |

Queries in one call run sequentially. Results include cited URLs, a synthesized answer, and stored content for
continuation.

### `fetch_content`

Fetch one `url` or up to ten `urls` in `readable` or `raw` mode. Web supports:

- readable extraction from HTML;
- bounded raw text;
- images;
- PDF extraction through Gemini when available or local `unpdf` otherwise;
- bounded GitHub API reads.

Initial readable content is capped to 30,000 characters. PDFs are converted to temporary Markdown and return a path for
Pi's Read Tool.

### `get_search_content`

Retrieve stored content by `responseId` and URL or query selector. Use `offset` and `limit` for a bounded slice, or
`findText` with exact, case-insensitive, or fuzzy matching. A returned slice is capped to 30,000 characters.

## Provider routing

Automatic routing tries configured providers by priority and can fall back on selected transient, quota, or network
errors. An explicit provider or provider list bypasses automatic choice.

Supported provider IDs are `openai`, `brave`, `parallel`, `tinyfish`, `search1api`, `searchinfinity`, `querit`,
`tavily`, `searxng`, `perplexity`, `gemini`, `exa`, `serpdive`, `kagi`, `ollama`, `anysearch`, `xai`,
`brightdata`, and `serpbase`.

`brightdata` and `serpbase` are explicit-only and are excluded from `auto` and `all`.

## Configuration

Web reads the `web` object in `<agentDir>/pi-stuff.json`. Provider-specific fields belong to their providers. Shared
routing recognizes:

- `provider` or `searchProvider`;
- `searchRouting.providers`;
- `searchRouting.fallbackOn` with `transient`, `quota`, or `network` values.

Each Tool call uses one immutable configuration snapshot.

## Security

Fetch accepts only HTTP and HTTPS URLs. It rejects embedded credentials, literal IPs, local or private hosts,
single-label domains, and URLs longer than 8,192 characters. Redirects are disabled at direct and remote extraction
boundaries.

Domain filters normalize URL-shaped input, reject IP-like values, and match only an exact host or its subdomains.

Credentials may come from environment values, settings, bounded `!command` resolution, or `op://` references. They are
not persisted by Web and are redacted from errors and Activity. Provider requests receive the query or URL required for
their operation.

See [Web runtime security](../../packages/pi-stuff/src/web/runtime/SECURITY.md) for credential, remote-extraction, and
paid-provider boundaries.

## Stored results

Search and fetch results live in process memory and are appended as Session custom entries. A resumed Session restores
valid entries younger than one hour. Older content requires a new search or fetch.

## See also

- [Web Module README](../../packages/pi-stuff/src/web/README.md)
- [Settings reference](../reference/settings.md#web)
- [Troubleshooting](../troubleshooting.md#web)
- [Runtime contract](../../packages/pi-stuff/src/web/runtime/README.md)

