#!/bin/sh
set -eu

stty rows "$PI_STUFF_GOAL_PTY_ROWS" columns "$PI_STUFF_GOAL_PTY_COLUMNS"

exec "$PI_STUFF_GOAL_PTY_BIN" \
	--offline \
	--approve \
	--ui-mode fullscreen \
	--no-extensions \
	--no-skills \
	--no-prompt-templates \
	--no-context-files \
	--no-themes \
	--no-tools \
	--extension "$PI_STUFF_GOAL_PTY_PACKAGE" \
	--extension "$PI_STUFF_GOAL_PTY_PROVIDER_EXTENSION" \
	--provider pi-stuff-ui-pty \
	--model ui-pty-model \
	--session-dir "$PI_STUFF_GOAL_PTY_SESSIONS" \
	--session-id "$PI_STUFF_GOAL_PTY_SESSION_ID"
