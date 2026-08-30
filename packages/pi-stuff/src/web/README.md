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
Direct provider API and gateway requests reject redirects before credentials
or request bodies can be forwarded to another origin.

Each `web_search` and `fetch_content` call runs as one Session-owned Effect
operation from the parent adapter. Every retained search and extraction
provider returns an Effect without starting a runner; credentials, browser
cookies, uploads, redirect handling, and wire protocols stay in narrow
provider-owned native adapters. Effect owns their lifetime, timeout,
interruption, sequential pagination, provider routing, partial-success
aggregation, and fallback.
Content retrieval additionally includes lazy fake-IP preparation, remote-target
validation, redirect-safe fetching, bounded response reads, extraction, and at
most three concurrent URLs in input order. Interruption cancels active native
work, and the adapter commits storage and publication only after confirming
that the Session is still current. Request shaping, codecs, URL policy,
parsing, rendering, ranking, and deterministic extraction remain ordinary
TypeScript.

Provider include/exclude values share one Suite-owned domain normalizer. It
accepts URL-shaped host input, rejects literal IPs and single-label hosts, and
matches only exact hosts or their subdomains.

The Pi-facing adapter loads the shared `web` Settings Namespace once through
the Effect settings store. A missing namespace leaves the built-in defaults
dormant, while invalid JSON or an invalid namespace produces one bounded
Diagnostic Record and activates the complete defaults. Filesystem and
unexpected read failures abort Suite initialization instead of silently
loading a partial Web configuration. Each search or fetch receives one
in-memory read-only snapshot, so an update through that store takes effect on
the next Tool call without changing an operation already in flight.

On systems whose TUN resolver maps public domains into `198.18.0.0/15`, page
fetching detects the condition lazily with both the requested host and a public
canary. Compatibility is process-local, explicit SSRF settings still win, and
no settings file is created. Literal-IP URLs remain rejected at the Suite
boundary.

Named third-party providers receive the query or URL needed for their operation. Paid Bright Data providers are
explicit-only and excluded from both zero-configuration fallback and `provider: "all"`; merely configuring a token
does not make a request. See the private runtime [`SECURITY.md`](runtime/SECURITY.md) for credential, downstream-egress,
and billed-response boundaries.
