#!/usr/bin/env bash

set -euo pipefail

prototype_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$prototype_dir/../../../../.." && pwd)
pi_bin=${PI_BIN:-/opt/bin/pi}
freeze_bin=${FREEZE_BIN:-/tmp/pi-proto-bin/freeze}
artifact_dir="$prototype_dir/artifacts"
capture_root=$(mktemp -d)
tmux_session="pi-stuff-ui-settings-$$"

cleanup() {
	if tmux has-session -t "$tmux_session" 2>/dev/null; then
		tmux kill-session -t "$tmux_session"
	fi
	rm -rf -- "$capture_root"
}
trap cleanup EXIT

for executable in tmux "$pi_bin" "$freeze_bin"; do
	if [[ ! -x $executable ]] && ! command -v "$executable" >/dev/null 2>&1; then
		echo "Required executable not found: $executable" >&2
		exit 1
	fi
done

if [[ $($pi_bin --version) != "0.83.0" ]]; then
	echo "This prototype requires Pi 0.83.0" >&2
	exit 1
fi

mkdir -p "$capture_root/agent" "$artifact_dir"
cp "$prototype_dir/settings.json" "$capture_root/agent/settings.json"

wait_for_text() {
	local expected=$1
	local attempts=0
	while ((attempts < 150)); do
		if tmux capture-pane -p -t "$tmux_session" | rg -F --quiet -- "$expected"; then
			return 0
		fi
		((attempts += 1))
		sleep 0.1
	done

	echo "Timed out waiting for: $expected" >&2
	tmux capture-pane -p -t "$tmux_session" >&2
	return 1
}

start_pi() {
	local width=$1
	local height=$2
	local command
	printf -v command \
		'env TERM=xterm-256color COLORTERM=truecolor PI_CODING_AGENT_DIR=%q PI_OFFLINE=1 PI_TELEMETRY=0 ANTHROPIC_API_KEY=prototype-not-a-real-key %q --model anthropic/claude-sonnet-4-5 --no-session --no-extensions -e %q --no-skills --no-prompt-templates --no-context-files --no-tools --no-themes --ui-mode fullscreen --offline --approve' \
		"$capture_root/agent" \
		"$pi_bin" \
		"$prototype_dir/prototype-ui-settings.ts"

	tmux new-session -d -s "$tmux_session" -x "$width" -y "$height" -c "$repo_root" "$command"
	local geometry
	geometry=$(tmux display-message -p -t "$tmux_session" '#{pane_width}x#{pane_height}')
	if [[ $geometry != "${width}x${height}" ]]; then
		echo "Unexpected tmux geometry: $geometry" >&2
		return 1
	fi
	wait_for_text "claude-sonnet-4-5"
	tmux send-keys -t "$tmux_session" -l '/ui'
	tmux send-keys -t "$tmux_session" Enter
	wait_for_text "Statusline"
	wait_for_text "Tool running timer"
}

stop_pi() {
	if tmux has-session -t "$tmux_session" 2>/dev/null; then
		tmux kill-session -t "$tmux_session"
	fi
}

capture_frame() {
	local name=$1
	local ansi_file="$artifact_dir/$name.ansi"
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

start_pi 100 32
capture_frame "pi-0.83-ui-settings-open-100x32"
stop_pi

start_pi 64 28
capture_frame "pi-0.83-ui-settings-open-64x28"
stop_pi

start_pi 100 32
tmux send-keys -t "$tmux_session" -l 'timer'
wait_for_text "Tool running timer"
wait_for_text "Show elapsed time while long-running tools work"
capture_frame "pi-0.83-ui-settings-search-timer-100x32"
tmux send-keys -t "$tmux_session" Enter
wait_for_text "false"
capture_frame "pi-0.83-ui-settings-toggle-timer-100x32"
tmux send-keys -t "$tmux_session" Escape
wait_for_text "claude-sonnet-4-5"
if tmux capture-pane -p -t "$tmux_session" | rg -F --quiet -- "Type to search"; then
	echo "Escape did not restore the Pi editor" >&2
	exit 1
fi
stop_pi

echo "Captured real Pi SettingsList evidence under: $artifact_dir"
