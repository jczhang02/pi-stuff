# Security policy

## Supported versions

Pi Stuff is currently unreleased. Security fixes apply to the latest commit on `main` until the first npm release defines a supported-version policy.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting for this repository:

<https://github.com/jczhang02/pi-stuff/security/advisories/new>

Include the affected Package or Runtime Resource, reproduction steps, impact, and any suggested mitigation. Do not include credentials or unrelated private data.

## Trust model

Pi Extensions execute with the user's operating-system permissions. The Suite therefore treats import and startup purity, explicit Package allowlists, exact development dependencies, and user-triggered side effects as security contracts.
