# Absorbed Web implementation

This directory is the private implementation behind Pi Stuff's `web` module. It is source code absorbed from a pinned,
locally adapted `pi-web-access` snapshot; it is not a Package, dependency, or independently installed extension.

Pi Stuff owns the user-visible Tool surface in the parent directory. The implementation here supplies search,
HTTP/image/PDF extraction, bounded GitHub API reads, storage, and SSRF enforcement. Dormant upstream curator,
command, source-check, page-answer, cloning, and video surfaces have been removed. See [`UPSTREAM.md`](./UPSTREAM.md) for exact provenance,
integrity records, license, and the maintained delta. [`SECURITY.md`](./SECURITY.md) records the retained credential,
remote-extraction, and paid-provider boundaries.

`implementation.ts` keeps installation as a short ordered lifecycle and delegates each Tool to its search, fetch,
or stored-content handler. The parent `tool-contracts.ts` owns the shared bounded schemas; this private runtime owns
execution, storage, and Session restoration only.

`rsc-extract.ts` separates flight-chunk parsing from the cycle-safe node traversal that renders referenced content and
Markdown tables.

`extract.ts` owns the Effect content-retrieval program: remote validation, redirect-safe native fetches, timeout and
interruption, bounded response-reader finalization, ordered provider fallback, and stable three-way URL concurrency.
It delegates raw, image, PDF, text, HTML, and RSC interpretation to focused handlers while keeping deterministic
parsing as ordinary TypeScript. `github-api.ts` is the interruptible native `gh` adapter, and `pdf-extract.ts` is the
native PDF parser/filesystem adapter; returned temporary Markdown files intentionally outlive the operation so Pi can
read them afterward. The parent adapter is the only Effect runner and fences storage/publication to the current
Session. Model-backed extraction providers join this same Effect path directly rather than creating a second runtime.

`gemini-search.ts` owns one typed Effect provider registry and the routing policy built from it. Standard stateless API
providers and model-backed or stateful providers all return Effects without starting runners. Direct fetches,
credential resolution, cookie-database subprocesses, sequential uploads, and redirect handling stay in provider-owned
native adapters. Effect owns their timeout and interruption plus sequential pagination, routing, and fallback, while
request shaping, decoding, ranking, filtering, and result presentation remain ordinary TypeScript. Selected-provider
fan-out preserves input order, partial successes, provider diagnostics, and safe automatic fallback. Gemini API and
browser transports remain inside `gemini-api.ts` and `gemini-web.ts`; extraction providers keep their separate content
contract. Every operation reads the already-parsed Web namespace from the installation-owned Effect settings store
rather than reparsing credential-bearing JSON.
