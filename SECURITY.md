# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| `0.3.x` | Yes |
| `< 0.3.0` | No |

Security fixes are provided for the current private local `0.3.x` Package line.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting for this repository:

<https://github.com/jczhang02/pi-stuff/security/advisories/new>

Include the affected Package or Runtime Resource, reproduction steps, impact, and any suggested mitigation. Do not include credentials or unrelated private data.

## Trust model

Pi Extensions execute with the user's operating-system permissions. The Suite does not add a permission or command-interception layer. It therefore treats import and startup purity, explicit Package allowlists, exact development dependencies, and user-triggered side effects as security contracts.
