# Ponytail upstream baseline

Pi Stuff contains a feature-complete, host-adapted fork of Ponytail.

- Upstream package: `@dietrichgebert/ponytail@4.9.0`
- Repository: <https://github.com/DietrichGebert/ponytail>
- Tag: `v4.9.0`
- Commit: `0a4dd63ad4541f4f655c4108a295916f3c1d8fda`
- npm integrity: `sha512-OSdybtBZ3uDd5m/+zyz4h8/+BVBR9nGFhqTDmQkQb1v7k4Vfc1qql78naY64UjocdBPqR94htZEkKu2wpKTJaw==`
- License: MIT; the upstream notice is retained in `LICENSE.upstream` and summarized in `THIRD_PARTY_NOTICES.md`.
- Copied resource manifest: `UPSTREAM.sha256`.

The six Skill resources under `skills/` retain that baseline with one Pi-specific frontmatter field:
`disable-model-invocation: true`. Removing that one line from each adapted Skill reproduces the hashes in
`UPSTREAM.sha256`; the Skill bodies and all upstream fields remain unchanged. Runtime behavior is reimplemented in
TypeScript so Ponytail uses Pi Stuff's merged settings, shared prompt composition, child-Agent launch path, Command
Dialog, and Statusline.

Upstream updates require manual review. Run `bun run ponytail:upstream:review` for the current npm candidate or
`bun run ponytail:upstream:review --version <version>` for a named release. The command verifies registry integrity,
rechecks the local adapted Skills and retained license against the pinned tarball, safely unpacks the candidate, and
prints a path-sanitized full-package diff. A changed candidate intentionally exits nonzero; review runtime, Skill,
license, and metadata changes before updating copied resources, adaptation tests, hashes, and this record in one commit.
