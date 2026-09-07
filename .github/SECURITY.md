# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub's vulnerability reporting form](https://github.com/jczhang02/pi-stuff/security/advisories/new). Include the affected commit or version, reproduction steps, likely impact, and a minimal example when safe to share.

Do not post exploitable vulnerabilities, credentials, or personal information in public issues. If the private form is unavailable, wait for a private channel rather than publishing exploit details in an issue.

This project has one maintainer and no guaranteed response time. The maintainer will assess the report and coordinate any fix and disclosure through the private advisory.

## Supported versions

There are no published releases or supported version ranges yet. Security reports about code on the default branch are welcome. A support policy will accompany the first release.

## Development safeguards

Review extension and dependency code before running it. Keep secrets out of source files, Beads records, public comments, logs, and screenshots. Secret scanning and push protection help detect supported secret types; they do not replace review.

Public PR checks run on GitHub-hosted runners with read-only repository access and no configured application secrets. Do not execute untrusted PR code in a privileged workflow or on the maintainer's development host.
