# Absorbed Web implementation

This directory is the private implementation behind Pi Stuff's `web` module. It is source code absorbed from a pinned,
locally adapted `pi-web-access` snapshot; it is not a Package, dependency, or independently installed extension.

Pi Stuff owns the user-visible Tool surface in the parent directory. The implementation here supplies search,
HTTP/image/PDF extraction, bounded GitHub API reads, storage, and SSRF enforcement. Dormant upstream curator,
command, source-check, page-answer, cloning, and video surfaces have been removed. See [`UPSTREAM.md`](./UPSTREAM.md) for exact provenance,
integrity records, license, and the maintained delta. [`UPSTREAM_README.md`](./UPSTREAM_README.md) preserves the
source project's documentation for maintenance reference; its installation instructions do not apply to Pi Stuff.

`implementation.ts` keeps installation as a short ordered lifecycle and delegates each Tool to its search, fetch,
or stored-content handler. The parent `tool-contracts.ts` owns the shared bounded schemas; this private runtime owns
execution, storage, and Session restoration only.

`rsc-extract.ts` separates flight-chunk parsing from the cycle-safe node traversal that renders referenced content and
Markdown tables.

`gemini-search.ts` owns one typed provider registry and the routing policy built from it. Each provider is declared
once with its dispatch, availability, label, and automatic-routing metadata. Gemini API and browser transports remain
inside `gemini-api.ts` and `gemini-web.ts`; extraction providers keep their separate content contract. Every provider
reads the already-parsed Web namespace from the parent settings module rather than reparsing credential-bearing JSON.
