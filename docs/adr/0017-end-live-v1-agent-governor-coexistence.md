---
status: accepted
---

# End live v1 Agent governor coexistence

Current Pi Stuff releases do not hold the pre-v2 Agent governor's `mkdir` directory lock for the lifetime of a Pi
session. They may read an unlocked v1 ledger once and import proven historical records into the v2 ledger. If a v1
lock is present during that read, Agent launches fail closed and tell the user to close the older Pi process.

The old protocol cannot provide both live old/new process exclusion and automatic recovery when the new process is
killed: old writers do not participate in the v2 kernel lock, while a directory created for them survives process
death. PID-based deletion would add a check/remove replacement race. Keeping the lifetime barrier therefore makes an
ordinary crash permanently disable delegation for that Session.

## Consequences

- The v2 governor remains the only current execution authority and keeps its process-death-safe stable-inode kernel
  claim.
- An existing locked v1 ledger remains fail-closed and is never reclaimed automatically.
- Running pre-v2 and current Pi Stuff processes against the same Pi Session is unsupported; finish the old process
  before launching Agents with the current release.
- Compatibility startup does not create directories or locks when no v1 ledger exists, so killing the current Pi
  process cannot leave a new pre-upgrade barrier behind.
