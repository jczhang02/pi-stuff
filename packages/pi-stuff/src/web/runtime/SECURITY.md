# Security Policy

Please report suspected vulnerabilities through GitHub private vulnerability reporting for this repository. Do not
post exploit details, secrets, or proof-of-concept payloads in public issues or pull requests.

If private vulnerability reporting is unavailable for your account or this repository, open a minimal public issue
asking for a private contact path without including technical details.

## Credential sources

Credential commands are trusted local configuration, not a process-isolation boundary. A `!command` source runs only
when a provider request needs it, with a five-second deadline, 16 KiB output limit, cancellation, and a minimal
environment. Output must be non-empty and contain no control characters. An `op://` reference uses `op read` with an
argument vector, a 60-second deadline, and the same output bound. Resolved values are not persisted or retained beyond
the provider operation.

Diagnostics may name the provider, configuration path, and sanitized failure category. They must not repeat
credential-bearing configuration text, the source command or reference, stderr, or any part of the resolved value.

## Remote extraction

Local URL validation protects the request sent to a configured extraction service; it cannot control that service's
own DNS resolution, redirects, or egress. Enabling a remote extractor discloses the target URL and returned content to
that provider. Firecrawl fresh scraping should be enabled only for isolated or allowlisted deployments, and Bright
Data Web Unlocker should remain unconfigured for URLs that must not be disclosed.

## Paid providers

Bright Data SERP and Web Unlocker are explicit paid services and are never automatic fallbacks. A request can be
billable even when its body is unusable. A billed HTTP 200 response that cannot be interpreted is reported as an error
and is not reclassified as retryable; a non-empty Web Unlocker body is returned even when it is only a consent or
paywall stub. Provider tokens are redacted from quoted bodies, errors, and activity output.
