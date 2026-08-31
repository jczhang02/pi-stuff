# Web

[Simplified Chinese](../../../../docs/i18n/zh-CN/packages/pi-stuff/src/web/README.md)

Search, public HTTP extraction, and bounded continuation through three model-facing Tools.

## Quick start

```json
{ "query": "Pi coding agent extension API" }
```

Call `web_search` with the query, `fetch_content` with a selected public URL, and `get_search_content` with the returned
`responseId` when more content is needed.

## Highlights

- Searches one to four queries with explicit or automatic provider routing.
- Fetches readable or raw HTTP content, images, PDFs, and bounded GitHub data.
- Continues stored results by slice or matching passage.
- Applies URL, domain, redirect, credential, and SSRF protections.
- Restores valid Session result entries for up to one hour.
- Keeps explicit paid providers out of automatic and `all` routing.

## Documentation

- [Web guide](../../../../docs/capabilities/web.md)
- [Settings reference](../../../../docs/reference/settings.md#web)
- [Runtime security](runtime/SECURITY.md)
- [Runtime contract](runtime/README.md)
- [Upstream references](UPSTREAM.md)

