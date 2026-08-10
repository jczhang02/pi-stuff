# Pi Stuff Work

Current-session Background Shell, one-shot Monitor, and `/tasks` management for Pi Stuff.

- Bash accepts `run_in_background: true` and can hand a running foreground command to the background with `Ctrl+B`.
- `Monitor` waits for one explicit command, log, file, or HTTP condition without polling in the main conversation.
- `/tasks` is a full-width, non-floating live manager for Background Shell, Monitor, and read-only running Agent projections.
- Explicit output and stop queries remain idempotent for the 64 most recently finished owned activities in the current Pi
  process; terminal receipts are bounded memory, not durable task history.
- Output and notification size are bounded. Runtime limits and shutdown are enforced by an authenticated process-group
  supervisor, and uncertain process ownership is retained for recovery until absence is positively proven.

Todo, Goal, Beads, and Agent details retain their existing authorities and are not duplicated here.
