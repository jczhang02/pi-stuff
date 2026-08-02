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

claude_bin=${CLAUDE_21220_BIN:-}
if [[ -z $claude_bin ]] && command -v claude >/dev/null 2>&1; then
	claude_bin=$(command -v claude)
fi
if [[ -z $claude_bin || ! -x $claude_bin ]]; then
	echo "Set CLAUDE_21220_BIN to an executable Claude Code 2.1.220 binary" >&2
	exit 1
fi
if [[ $("$claude_bin" --version) != "2.1.220 (Claude Code)" ]]; then
	echo "BTW reference capture requires Claude Code 2.1.220" >&2
	exit 1
fi

expected_sha256=674f61f20ff306f3100cf9200e4c36c4b70278b5bef2884549819b942a89c863
actual_sha256=$(sha256sum "$claude_bin" | cut -d " " -f 1)
if [[ $actual_sha256 != "$expected_sha256" ]]; then
	echo "Unexpected Claude Code 2.1.220 binary checksum: $actual_sha256" >&2
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
	"{\"hasCompletedOnboarding\":true,\"lastOnboardingVersion\":\"2.1.220\",\"customApiKeyResponses\":{\"approved\":[\"-stuff-local-fixture\"],\"rejected\":[]},\"projects\":{\"$project_dir\":{\"hasTrustDialogAccepted\":true,\"hasCompletedProjectOnboarding\":true,\"allowedTools\":[],\"lastGracefulShutdown\":false,\"lastVersionBase\":\"2.1.220\"}}}" \
	> "$config_dir/.claude.json"

mock="$repo_root/docs/prototypes/tui/claude-2.1.220-btw-mock.ts"
bun "$mock" "$ready_file" "$event_log" 120000 2500 &
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

wait_for_visible_text() {
	local expected=$1
	local attempts=0
	while ((attempts < 400)); do
		if tmux capture-pane -p -t "$tmux_session" | rg -F --quiet -- "$expected"; then
			return 0
		fi
		((attempts += 1))
		sleep 0.1
	done

	echo "Timed out waiting for visible text: $expected" >&2
	tmux capture-pane -p -t "$tmux_session" >&2
	return 1
}

wait_for_hidden_text() {
	local rejected=$1
	local attempts=0
	while ((attempts < 400)); do
		if ! tmux capture-pane -p -t "$tmux_session" | rg -F --quiet -- "$rejected"; then
			return 0
		fi
		((attempts += 1))
		sleep 0.1
	done

	echo "Timed out waiting for text to disappear: $rejected" >&2
	tmux capture-pane -p -t "$tmux_session" >&2
	return 1
}

wait_for_event() {
	local event_name=$1
	local attempts=0
	while ((attempts < 400)); do
		if [[ -s $event_log ]] && rg -F --quiet -- "\"kind\":\"$event_name\"" "$event_log"; then
			return 0
		fi
		((attempts += 1))
		sleep 0.1
	done

	echo "Timed out waiting for fixture event: $event_name" >&2
	[[ ! -e $event_log ]] || cat "$event_log" >&2
	tmux capture-pane -p -t "$tmux_session" >&2
	return 1
}

reject_visible_text() {
	local rejected=$1
	if tmux capture-pane -p -t "$tmux_session" | rg -F --quiet -- "$rejected"; then
		echo "Unexpected text in Claude Code PTY: $rejected" >&2
		tmux capture-pane -p -t "$tmux_session" >&2
		return 1
	fi
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

tmux_session="pi-stuff-claude-21220-btw-$$"
command=""
printf -v command \
	'env -i HOME=%q XDG_CONFIG_HOME=%q XDG_CACHE_HOME=%q XDG_DATA_HOME=%q CLAUDE_CONFIG_DIR=%q ANTHROPIC_BASE_URL=%q ANTHROPIC_API_KEY=%q HTTP_PROXY=%q HTTPS_PROXY=%q ALL_PROXY=%q NO_PROXY=%q no_proxy=%q PATH=%q LANG=%q TERM=%q SHELL=%q CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1 DISABLE_TELEMETRY=1 DISABLE_AUTOUPDATER=1 DISABLE_ERROR_REPORTING=1 %q --no-chrome --model %q --tools default --permission-mode dontAsk' \
	"$home_dir" \
	"$capture_root/xdg-config" \
	"$capture_root/xdg-cache" \
	"$capture_root/xdg-data" \
	"$config_dir" \
	"http://127.0.0.1:$mock_port" \
	'pi-stuff-local-fixture' \
	'http://127.0.0.1:9' \
	'http://127.0.0.1:9' \
	'http://127.0.0.1:9' \
	'127.0.0.1,localhost' \
	'127.0.0.1,localhost' \
	"$PATH" \
	'C.UTF-8' \
	'xterm-256color' \
	'/bin/bash' \
	"$claude_bin" \
	'claude-sonnet-4-5-20250929'

tmux new-session -d -s "$tmux_session" -x 100 -y 32 -c "$project_dir" "$command"
geometry=$(tmux display-message -p -t "$tmux_session" '#{pane_width}x#{pane_height}')
if [[ $geometry != "100x32" ]]; then
	echo "Unexpected tmux geometry: $geometry" >&2
	exit 1
fi

wait_for_visible_text "Claude Code v2.1.220"
wait_for_visible_text "don't ask on"
reject_visible_text "Do you trust the files in this folder?"
reject_visible_text "Detected a custom API key in your environment"
reject_visible_text "Invalid API key"

tmux send-keys -t "$tmux_session" -l "MAIN_CAPTURE_MARKER Keep working on src/config/runtime.ts while I ask side questions."
wait_for_visible_text "MAIN_CAPTURE_MARKER"
tmux send-keys -t "$tmux_session" Enter
wait_for_event "main-request"
wait_for_visible_text "esc to interrupt"
capture_frame "claude-2.1.220-btw-main-running"

tmux send-keys -t "$tmux_session" -l "/btw SIDE_CAPTURE_ONE Which file did I name?"
wait_for_visible_text "SIDE_CAPTURE_ONE"
tmux send-keys -t "$tmux_session" Enter
wait_for_event "side-one-request"
wait_for_visible_text "Answering…"
capture_frame "claude-2.1.220-btw-answering"

wait_for_event "side-one-response"
wait_for_visible_text "src/config/runtime.ts"
wait_for_visible_text "c to copy"
capture_frame "claude-2.1.220-btw-answered"

tmux send-keys -t "$tmux_session" Escape
wait_for_hidden_text "SIDE_CAPTURE_ONE"
wait_for_visible_text "esc to interrupt"
if rg -F --quiet -- '"kind":"main-response"' "$event_log"; then
	echo "Primary fixture response finished before the resumed-main capture" >&2
	exit 1
fi
capture_frame "claude-2.1.220-btw-main-resumed"

tmux send-keys -t "$tmux_session" -l "/btw SIDE_CAPTURE_TWO Summarize that side answer in three words."
wait_for_visible_text "SIDE_CAPTURE_TWO"
tmux send-keys -t "$tmux_session" Enter
wait_for_event "side-two-request"
wait_for_visible_text "Answering…"
wait_for_event "side-two-response"
wait_for_visible_text "Named file: runtime.ts."
wait_for_visible_text "SIDE_CAPTURE_ONE"
wait_for_visible_text "SIDE_CAPTURE_TWO"
wait_for_visible_text "←/→ to switch"
capture_frame "claude-2.1.220-btw-history"

for expected_event in main-request side-one-request side-one-response side-two-request side-two-response; do
	if [[ $(rg -c -- "\"kind\":\"$expected_event\"" "$event_log") -ne 1 ]]; then
		echo "Expected exactly one fixture event: $expected_event" >&2
		exit 1
	fi
done
if rg -F --quiet -- '"kind":"unexpected-request"' "$event_log"; then
	echo "Released Claude Code sent an unexpected Messages request" >&2
	cat "$event_log" >&2
	exit 1
fi
if rg -F --quiet -- '"kind":"main-response"' "$event_log"; then
	echo "Primary fixture response must still be pending after BTW history capture" >&2
	exit 1
fi
for side_event in side-one-request side-two-request; do
	if ! rg -F --quiet -- "\"kind\":\"$side_event\",\"payload\":{\"stream\":true," "$event_log"; then
		echo "Expected a streaming released-Claude BTW request: $side_event" >&2
		cat "$event_log" >&2
		exit 1
	fi
done

for state in main-running answering answered main-resumed history; do
	artifact="$artifact_dir/claude-2.1.220-btw-$state.png"
	if [[ ! -s $artifact ]]; then
		echo "Expected capture artifact was not written: $artifact" >&2
		exit 1
	fi
done
