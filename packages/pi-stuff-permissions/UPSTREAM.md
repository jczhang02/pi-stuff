# Upstream provenance

Pi Stuff vendors and owns a full fork of:

- Package: `@gotgenes/pi-permission-system@24.0.0`
- Source repository: `https://github.com/gotgenes/pi-packages`
- Source commit/tag: `776ebcc764ca6c720b1f7eb430007de06f145b5f`
- License: MIT; the upstream license is preserved as `LICENSE`
- npm archive SHA-1: `ebfe84ad3ac0946577a665473966f5c6385c362b`
- npm archive SHA-256:
  `0698d8b61ef1bcb197fae5987709e46a12290fb7bb07b4f35db369efcfcf0d32`
- npm SRI:
  `sha512-4WncumJPPDDs8Ulrjk7qvU3kHjQSjGyZnpLx1Nu9EkxWQZQi+qvVOpGpPGbHwlXt6rg8AjvI8zSl2Aj2bo5lfA==`
- License SHA-256:
  `220a81ab89687aa207c1b9257a7f3636c8c78b5c1092b7563ad662950d21dd00`

The baseline import is preserved as a separate repository commit. Pi Stuff
keeps the mature parsing, policy, forwarding, persistence, and recovery engine,
but owns its package identity, defaults, UI, release integration, and safety
contract.

Major product changes in this fork:

- unrestricted-by-default normal work;
- a non-relaxable destructive-command circuit breaker;
- exact-call-only approvals with no remembered grant;
- shared, full-width, non-floating Command Dialog UI;
- no statusline output and no default logs;
- user-owned runtime controls and shell-tool enrollment;
- user-owned global denies that project, Agent, and session rules cannot relax;
- custom shell aliases bound to their declared working directory;
- all-depth Agent forwarding directly to the root session, with a short broker
  acknowledgement deadline and a separate visible human-decision window;
- Pi Stuff aggregate, release, and verification integration.

The upstream range `web-tree-sitter@^0.26.9` resolved to `0.26.11` in the
captured npm installation. Pi Stuff pins that resolved artifact exactly, in
line with the repository dependency policy.

The separate `jczhang02/pi-agent` repository was used only as a capability and
product-reference inventory. No source code was copied from it.
