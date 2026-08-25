# Ponytail upstream baseline

Pi Stuff contains a feature-complete, host-adapted fork of Ponytail.

- Upstream package: `@dietrichgebert/ponytail@4.9.0`
- Repository: <https://github.com/DietrichGebert/ponytail>
- Tag: `v4.9.0`
- Commit: `0a4dd63ad4541f4f655c4108a295916f3c1d8fda`
- npm integrity: `sha512-ziSmEnhiKGigSzi1v8w9uNt/5oMJWbyQGTgIlYKUkLTZNJY3vkz2V2IBLYMXG7IdAkge/Ocv+eo0vyshgCtF+Q==`
- License: MIT; the upstream notice is retained in `LICENSE.upstream` and summarized in `THIRD_PARTY_NOTICES.md`.
- Copied resource manifest: `UPSTREAM.sha256`.

The six Skill resources under `skills/` retain that baseline with one Pi-specific frontmatter field:
`disable-model-invocation: true`. Removing that one line from each adapted Skill reproduces the hashes in
`UPSTREAM.sha256`; the Skill bodies and all upstream fields remain unchanged. Runtime behavior is reimplemented in
TypeScript so Ponytail uses Pi Stuff's merged settings, shared prompt composition, child-Agent launch path, Command
Dialog, and Statusline.

Upstream updates are manual: compare the pinned tag with the candidate release, review runtime and Skill changes, update the copied resources and adaptation tests, then change this file in the same commit.
