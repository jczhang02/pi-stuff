# Pi Stuff Web

Pi Stuff Web exposes three model-facing Tools:

- `web_search` searches one to four bounded queries and returns cited sources.
- `fetch_content` reads HTTP(S) pages in readable or raw mode. PDFs are
  converted to a temporary Markdown artifact and return its path for Pi's
  `read` Tool.
- `get_search_content` retrieves bounded slices or matching passages from a
  previous search/fetch result.

The package deliberately has no interactive browser, floating window, activity
widget, local-file/video reader, repository cloner, or separate research
workflow. Search always uses the non-curator path. Provider selection remains
explicit through the Tool call or the owned upstream configuration.

All three Tools use Pi Stuff's shared one-row lifecycle renderer. Model-visible
results, citations, cancellation, SSRF protection, redirects, extraction, and
PDF handling remain owned by the pinned fork. `tool-contracts.ts` is the single
owner of their bounded model-facing schemas across the parent adapter and private runtime.

Provider include/exclude values share one Suite-owned domain normalizer. It
accepts URL-shaped host input, rejects literal IPs and single-label hosts, and
matches only exact hosts or their subdomains.

Web reads the shared `web` settings namespace through one parser. A missing
namespace leaves the built-in defaults dormant, while invalid JSON or an
invalid namespace produces one bounded Diagnostic Record and activates the
complete defaults. Filesystem and unexpected read failures abort Suite
initialization instead of silently loading a partial Web configuration.

On systems whose TUN resolver maps public domains into `198.18.0.0/15`, page
fetching detects the condition lazily with both the requested host and a public
canary. Compatibility is process-local, explicit SSRF settings still win, and
no settings file is created. Literal-IP URLs remain rejected at the Suite
boundary.
