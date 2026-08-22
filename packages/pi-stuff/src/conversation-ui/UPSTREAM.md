# Upstream provenance

The chart parser and Unicode rendering algorithms in `unicode-chart.ts` are adapted from the pinned
`@howaboua/pi-unicode-charts` 0.1.0 source snapshot.

| Field | Value |
| --- | --- |
| Repository | `https://github.com/IgorWarzocha/howaboua-pi-stuff` |
| Package directory | `packages/pi-unicode-charts` |
| npm version | `0.1.0` |
| Source commit (`gitHead`) | `8d63d300597488e6fa4c30ccd6a3eb0fed2d4304` |
| License | MIT |
| npm archive SHA-1 | `bac72747a97073534c42a6212e77795c58a56fd0` |
| npm archive SHA-256 | `98e490817cf62f14a5e3a88a5b7e7afc521210b34def32ed65ddce7716d70885` |
| npm integrity | `sha512-mu0/WoWSQohE3Zf2+gWpVYZSvhVxXf6ijlYH+Fk0E6dJtDkbp0Y1AE1cnoq/BoZUxAKqepY02sY94PFGJjDSvQ==` |

## Pi Stuff delta

- Absorbs the chart parser and bar, line, scatter, sparkline, heatmap, and Braille rendering algorithms into the
  existing Conversation UI Capability instead of loading an independently installed Extension.
- Removes the upstream Markdown transformer registration and keeps Pi Stuff’s single Host transformer authority.
- Uses a static `chart`/`tree` fence dispatcher; it does not add a plugin registry, configuration, or dependency.
- Rejects partial, unsupported, over-limit, unsafe, incomplete, or too-narrow input instead of truncating source data
  or silently dropping invalid rows.
- Caps chart source at 12,000 characters, ordinary series at 64 points, and heatmaps at 32 by 64 cells.
- Uses Pi TUI’s terminal-column measurement plus grapheme-aware truncation for CJK and emoji.
- Keeps Session messages and Provider context canonical; only the Conversation Markdown projection changes.

The upstream MIT notice is preserved in `LICENSES/Howaboua-MIT.txt`. The source is absorbed into Pi Stuff and has no
independent Package or release lifecycle.
