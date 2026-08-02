#!/bin/sh
set -eu

stty rows "$PI_STUFF_PTY_ROWS" columns "$PI_STUFF_PTY_COLUMNS"

exec "$PI_STUFF_PTY_BIN" \
	--offline \
	--approve \
	--no-extensions \
	--no-skills \
	--no-context-files \
	--extension "$PI_STUFF_PTY_PACKAGE" \
	--extension "$PI_STUFF_PTY_PROVIDER_EXTENSION" \
	--extension "$PI_STUFF_PTY_TRIGGER_EXTENSION" \
	--provider pi-stuff-pty \
	--model fixture-model \
	--session-dir "$PI_STUFF_PTY_SESSIONS" \
	--session-id "$PI_STUFF_PTY_SESSION_ID"
