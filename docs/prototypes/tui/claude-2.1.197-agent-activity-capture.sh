#!/usr/bin/env bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
freeze_bin=${FREEZE_BIN:-freeze}
artifact_dir="$repo_root/docs/prototypes/tui/artifacts"
capture_root=$(mktemp -d)
mock_pid=""
tmux_session=""

cleanup() {
	if [[ -n $tmux_session ]] && tmux has-session -t "$tmux_session" 2>/dev/null; then
		tmux kill-session -t "$tmux_session"
	fi
	if [[ -n $mock_pid ]]; then
		kill "$mock_pid" 2>/dev/null || true
		wait "$mock_pid" 2>/dev/null || true
	fi
	local cleanup_attempts=0
	while [[ -e $capture_root && $cleanup_attempts -lt 120 ]]; do
		rm -rf -- "$capture_root" 2>/dev/null || true
		((cleanup_attempts += 1))
		[[ ! -e $capture_root ]] || sleep 0.1
	done
}
trap cleanup EXIT

for executable in bun rg tmux sha256sum "$freeze_bin"; do
	if ! command -v "$executable" >/dev/null 2>&1; then
		echo "Required executable not found: $executable" >&2
		exit 1
	fi
done

claude_bin=${CLAUDE_2197_BIN:-}
if [[ -z $claude_bin ]] && command -v claude >/dev/null 2>&1; then
	claude_bin=$(command -v claude)
fi
if [[ -z $claude_bin || ! -x $claude_bin ]]; then
	echo "Set CLAUDE_2197_BIN to an executable Claude Code 2.1.197 binary" >&2
	exit 1
fi
if [[ $($claude_bin --version) != "2.1.197 (Claude Code)" ]]; then
	echo "Agent activity reference capture requires Claude Code 2.1.197" >&2
	exit 1
fi

expected_sha256=f54e69cbc89b2da61a415700af7ff52a147e862517d4f1b0eecf768448cf7f83
actual_sha256=$(sha256sum "$claude_bin" | cut -d " " -f 1)
if [[ $actual_sha256 != "$expected_sha256" ]]; then
	echo "Unexpected Claude Code 2.1.197 binary checksum: $actual_sha256" >&2
	exit 1
fi

config_dir="$capture_root/config"
home_dir="$capture_root/home"
project_dir="$capture_root/project"
ready_file="$capture_root/mock-ready"
event_log="$capture_root/mock-events.jsonl"
mkdir -p "$config_dir" "$home_dir" "$project_dir" "$artifact_dir"

printf '%s\n' '{"theme":"dark"}' > "$config_dir/settings.json"
printf '%s\n' \
	"{\"hasCompletedOnboarding\":true,\"lastOnboardingVersion\":\"2.1.197\",\"customApiKeyResponses\":{\"approved\":[\"pi-stuff-local-fixture\"],\"rejected\":[]},\"projects\":{\"$project_dir\":{\"hasTrustDialogAccepted\":true,\"hasCompletedProjectOnboarding\":true,\"allowedTools\":[],\"lastGracefulShutdown\":false,\"lastVersionBase\":\"2.1.197\"}}}" \
	> "$config_dir/.claude.json"

mock="$repo_root/docs/prototypes/tui/claude-2.1.197-agent-activity-mock.ts"
bun "$mock" "$ready_file" "$event_log" 12000 &
mock_pid=$!

attempts=0
while [[ ! -s $ready_file && $attempts -lt 100 ]]; do
	if ! kill -0 "$mock_pid" 2>/dev/null; then
		echo "Local fixture server exited before becoming ready" >&2
		exit 1
	fi
	((attempts += 1))
	sleep 0.05
done
if [[ ! -s $ready_file ]]; then
	echo "Timed out waiting for the local fixture server" >&2
	exit 1
fi
mock_port=$(<"$ready_file")

wait_for_text() {
	local expected=$1
	local attempts=0
	while ((attempts < 400)); do
		if tmux capture-pane -p -S - -t "$tmux_session" | rg -F --quiet -- "$expected"; then
			return 0
		fi
		((attempts += 1))
		sleep 0.1
	done

	echo "Timed out waiting for: $expected" >&2
	tmux capture-pane -p -S - -t "$tmux_session" >&2
	return 1
}

finish_startup() {
	local attempts=0
	while ((attempts < 100)); do
		local pane
		pane=$(tmux capture-pane -p -S - -t "$tmux_session")
		if rg -F --quiet -- "Claude Code v2.1.197" <<< "$pane"; then
			return 0
		fi
		if rg -F --quiet -- "Detected a custom API key in your environment" <<< "$pane"; then
			tmux send-keys -t "$tmux_session" 1 Enter
			wait_for_text "Claude Code v2.1.197"
			return 0
		fi
		((attempts += 1))
		sleep 0.1
	done

	echo "Timed out during Claude Code startup" >&2
	tmux capture-pane -p -S - -t "$tmux_session" >&2
	return 1
}

reject_text() {
	local rejected=$1
	if tmux capture-pane -p -S - -t "$tmux_session" | rg -F --quiet -- "$rejected"; then
		echo "Unexpected text in Claude Code PTY: $rejected" >&2
		tmux capture-pane -p -S - -t "$tmux_session" >&2
		return 1
	fi
}

start_claude() {
	local suffix=$1
	local agents_json
	local command
	tmux_session="pi-stuff-claude-2197-$suffix-$$"
	agents_json='{"explorer":{"description":"Inspect one thing","prompt":"You inspect without tools."},"reviewer":{"description":"Review one thing","prompt":"You review without tools."}}'
	printf -v command \
		'env -i HOME=%q XDG_CONFIG_HOME=%q XDG_CACHE_HOME=%q XDG_DATA_HOME=%q CLAUDE_CONFIG_DIR=%q ANTHROPIC_BASE_URL=%q ANTHROPIC_API_KEY=%q NO_PROXY=%q no_proxy=%q PATH=%q LANG=%q TERM=%q SHELL=%q CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1 DISABLE_TELEMETRY=1 DISABLE_AUTOUPDATER=1 DISABLE_ERROR_REPORTING=1 %q --model %q --agents %q --tools Agent --allowedTools Agent --permission-mode dontAsk' \
		"$home_dir" \
		"$capture_root/xdg-config" \
		"$capture_root/xdg-cache" \
		"$capture_root/xdg-data" \
		"$config_dir" \
		"http://127.0.0.1:$mock_port" \
		'pi-stuff-local-fixture' \
		'127.0.0.1,localhost' \
		'127.0.0.1,localhost' \
		"$PATH" \
		'C.UTF-8' \
		'xterm-256color' \
		'/bin/bash' \
		"$claude_bin" \
		'claude-sonnet-4-5-20250929' \
		"$agents_json"

	tmux new-session -d -s "$tmux_session" -x 100 -y 32 -c "$project_dir" "$command"
	local geometry
	geometry=$(tmux display-message -p -t "$tmux_session" '#{pane_width}x#{pane_height}')
	if [[ $geometry != "100x32" ]]; then
		echo "Unexpected tmux geometry: $geometry" >&2
		return 1
	fi
	finish_startup
	reject_text "Do you trust the files in this folder?"
	reject_text "Invalid API key"
	tmux send-keys -t "$tmux_session" "Use explorer and reviewer in parallel." Enter
	wait_for_text "Running 2 agents"
}

stop_claude() {
	if [[ -n $tmux_session ]] && tmux has-session -t "$tmux_session" 2>/dev/null; then
		tmux kill-session -t "$tmux_session"
	fi
	tmux_session=""
}

capture_frame() {
	local name=$1
	local ansi_file="$capture_root/$name.ansi"
	tmux capture-pane -p -e -N -t "$tmux_session" > "$ansi_file"
	"$freeze_bin" \
		-c base \
		--margin 0 \
		--padding 8 \
		--border.radius 0 \
		--font.family 'Iosevka Nerd Font Mono' \
		--font.size 15 \
		--line-height 1.15 \
		-o "$artifact_dir/$name.png" \
		"$ansi_file"
}

start_claude foreground
sleep 4
capture_frame claude-2.1.197-agent-activity-foreground-running
wait_for_text "2 agents finished"
wait_for_text "Both UI investigations are complete."
capture_frame claude-2.1.197-agent-activity-foreground-finished
tmux send-keys -t "$tmux_session" C-o
wait_for_text "Showing detailed transcript"
capture_frame claude-2.1.197-agent-activity-expanded
stop_claude

start_claude background
sleep 3
tmux send-keys -t "$tmux_session" C-b
sleep 0.2
tmux send-keys -t "$tmux_session" C-b
wait_for_text "2 background agents launched"
wait_for_text "Waiting for 2 background agents to finish"
capture_frame claude-2.1.197-agent-activity-background-running
wait_for_text 'Agent "Inspect Claude activity UI" finished'
wait_for_text 'Agent "Inspect tintin activity UI" finished'
capture_frame claude-2.1.197-agent-activity-background-finished
stop_claude

start_claude roster-navigation
sleep 4
tmux send-keys -t "$tmux_session" Down
sleep 0.5
capture_frame claude-2.1.197-agent-activity-roster-manage
tmux send-keys -t "$tmux_session" Down
sleep 0.3
capture_frame claude-2.1.197-agent-activity-roster-manage-child
tmux send-keys -t "$tmux_session" Enter
sleep 0.5
capture_frame claude-2.1.197-agent-activity-roster-agent-view
stop_claude
# The released binary keeps child workers alive briefly after the probe TUI is
# closed. Let their deterministic local requests settle before removing HOME.
sleep 8

if [[ $(rg -c -- '"kind":"explorer-child"|"kind":"reviewer-child"' "$event_log") -ne 6 ]]; then
	echo "Expected two child Agent requests in each of three capture runs" >&2
	exit 1
fi
