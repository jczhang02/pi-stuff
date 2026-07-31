# Compatibility

## Certified host

| Contract | Certified version |
| --- | --- |
| Pi standalone host | 0.83.0, Linux x64 |
| Bun toolchain | 1.3.14 |
| TypeScript checker | 5.9.3 |

Pi core imports remain wildcard peer dependencies because the Host supplies them. Development dependencies and certification assets are pinned exactly to the certified version.

A Pi upgrade requires a dedicated change that reviews relevant Extension and Package interfaces, updates the pinned development dependency and binary checksum together, and passes the no-model standalone-host certification. Compatibility with other Pi versions is not claimed until that work is complete.
