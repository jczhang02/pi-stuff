# anti-slop source

Source: https://github.com/dmmulroy/anti-slop/tree/e8c4880471b23ab7f216fba7b27d173a6ef07d4c

Copied the production plugin from `skills/install-anti-slop/assets/anti-slop/`, which upstream generates from its canonical `src/`. The 23 TypeScript files are unmodified. The upstream MIT license is retained as `LICENSE`.

The repository owns this pinned copy. Updates require a reviewed PR; no floating download runs during lint or CI. All 15 generic rules and the Effect rule are errors for owned source and tests. Third-party plugin files are excluded from repository style checks rather than reformatted or made to lint themselves. Upstream tests are not included in this production bundle. Local positive/negative probes verified rule activation during baseline setup; the maintainer retired those tests with the governance programs in [#21](https://github.com/jczhang02/pi-stuff/issues/21).

The plugin uses lexical AST analysis, not a TypeScript type checker. Its module-mocking rule recognizes Jest/Vitest APIs, and its Effect constructor rule covers relative imports rather than path aliases. These are detector limits, not permission to bypass the standards.
