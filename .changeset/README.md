# Changesets

Add a Changeset for publishable behavior or interface changes. Documentation, tests, and internal engineering changes do not require one.

Changesets owns version calculation and changelog updates only. Do not run `changeset publish`: Changesets 2.31.1 delegates a Bun workspace to npm's directory packer, which does not preserve the Aggregate Package's bundled workspace topology. The supported order is `bun run release:version`, `bun run release:pack`, then `bun run release:publish -- --confirm-publish`. Packing refuses pending Changesets and `0.0.0` versions, certifies the exact final Bun tarballs, and writes a hash-bound verification record. Publication accepts only that certified artifact set and passes each tarball directly to the repository-pinned Bun publisher.
