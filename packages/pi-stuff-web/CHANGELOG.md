# Changelog

## 0.2.0

### Minor Changes

- 14396c9: Add bounded Web reading/search and a lazy proxy-only MCP gateway to the default Suite, including shared Tool rendering, non-floating status UI, owned immutable forks, and real Pi 0.83 transport verification.

### Patch Changes

- Updated dependencies [14396c9]
- Updated dependencies [dcc49da]
- Updated dependencies [60ba544]
  - @jczhang02/pi-stuff-tools@0.1.1

## 0.1.0 - 2026-08-04

- Added owned, bounded Web search, HTTP(S) page reading, PDF extraction, and
  continuation retrieval on top of the pinned Pi Web Access fork.
- Removed browser-curator commands, shortcuts, widgets, video/local-file
  inputs, repository cloning, and the separate source-check Tool surface.
- Enabled the fork's API/HTTP-only embedding mode so force-clone and
  YouTube-specific browser or model paths cannot leak through hidden fields.
- Routed every exposed Tool through the shared Pi Stuff Tool presentation.
