# Formatting source

Google GTS: https://github.com/google/gts/tree/bd623c03dc9f319b64564cac7478162734739599

The pinned `.prettierrc.json` specifies `bracketSpacing: false`, `singleQuote: true`, `trailingComma: all`, and `arrowParens: avoid`. The corresponding Apache-2.0 license is retained here as `LICENSE`. This repository runs those preferences through Oxfmt, with explicit two-space indentation, 80-column print width, semicolons, and LF line endings.

GTS, ESLint, and Prettier are not installed. This is a formatting-policy adoption, not a claim of byte-identical output or adoption of GTS compiler/lint settings. Formatter and source-policy updates require a PR.
