# Absorbed Web implementation

This directory is the private implementation behind Pi Stuff's `web` module. It is source code absorbed from a pinned,
locally adapted `pi-web-access` snapshot; it is not a Package, dependency, or independently installed extension.

Pi Stuff owns the user-visible Tool surface in the parent directory. The implementation here supplies search,
extraction, PDF handling, storage, and SSRF enforcement. See [`UPSTREAM.md`](./UPSTREAM.md) for exact provenance,
integrity records, license, and the maintained delta. [`UPSTREAM_README.md`](./UPSTREAM_README.md) preserves the
source project's documentation for maintenance reference; its installation instructions do not apply to Pi Stuff.
