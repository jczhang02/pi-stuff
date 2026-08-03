#!/usr/bin/env bash

# Capture the implemented production BTW surface in real Pi 0.83 PTYs.

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
pi_bin="$repo_root/node_modules/.bin/pi"
provider="$repo_root/docs/prototypes/tui/work-btw-phase1-provider.ts"
artifact_dir="$repo_root/docs/prototypes/tui/artifacts"
freeze_bin=${FREEZE_BIN:-freeze}
capture_root=$(mktemp -d)
tmux_session=""

cleanup() {
	if [[ -n $tmux_session ]] && tmux has-session -t "$tmux_session" 2>/dev/null; then
		tmux kill-session -t "$tmux_session"
	fi
	rm -rf -- "$capture_root"
}
trap cleanup EXIT

for executable in bun rg tmux "$freeze_bin"; do
	if ! command -v "$executable" >/dev/null 2>&1 && [[ ! -x $executable ]]; then
		echo "Required executable not found: $executable" >&2
		exit 1
	fi
done

if [[ $($pi_bin --version) != "0.83.0" ]]; then
	echo "BTW Phase 2 capture requires Pi 0.83.0" >&2
	exit 1
fi
if [[ $(bun --version) != "1.3.14" ]]; then
	echo "BTW Phase 2 capture requires Bun 1.3.14" >&2
	exit 1
fi

mkdir -p "$artifact_dir"

wait_for_text() {
	local expected=$1
	local attempts=0
	while ((attempts < 300)); do
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

wait_for_absence() {
	local rejected=$1
	local attempts=0
	while ((attempts < 100)); do
		if ! tmux capture-pane -p -t "$tmux_session" | rg -F --quiet -- "$rejected"; then
			return 0
		fi
		((attempts += 1))
		sleep 0.1
	done
	echo "Timed out waiting for text to disappear: $rejected" >&2
	return 1
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

start_pi() {
	local width=$1
	local height=$2
	local case_root="$capture_root/${width}x${height}"
	local agent_dir="$case_root/agent"
	local sessions_dir="$case_root/sessions"
	local command

	mkdir -p "$agent_dir" "$sessions_dir"
	printf '%s\n' '{"theme":"dark","quietStartup":true,"enableInstallTelemetry":false,"outputPad":1}' \
		> "$agent_dir/settings.json"
	printf -v command \
		'env PI_CODING_AGENT_DIR=%q PI_OFFLINE=1 PI_TELEMETRY=0 %q --offline --approve --no-extensions --no-skills --no-context-files --no-prompt-templates --extension %q --extension %q --provider pi-stuff-btw-phase1 --model fixture --session-dir %q --session-id %q %q' \
		"$agent_dir" \
		"$pi_bin" \
		"$repo_root/packages/pi-stuff" \
		"$provider" \
		"$sessions_dir" \
		"phase2-production-${width}x${height}" \
		'MAIN_PHASE1 Continue the main task while I inspect the focused surface.'

	tmux_session="pi-stuff-btw-phase2-${width}x${height}-$$"
	tmux new-session -d -s "$tmux_session" -x "$width" -y "$height" -c "$repo_root" "$command"
	local geometry
	geometry=$(tmux display-message -p -t "$tmux_session" '#{pane_width}x#{pane_height}')
	if [[ $geometry != "${width}x${height}" ]]; then
		echo "Unexpected tmux geometry: $geometry" >&2
		exit 1
	fi
	wait_for_text "MAIN_PHASE1_DONE"
}

stop_pi() {
	if [[ -n $tmux_session ]] && tmux has-session -t "$tmux_session" 2>/dev/null; then
		tmux kill-session -t "$tmux_session"
	fi
	tmux_session=""
}

run_geometry() {
	local width=$1
	local height=$2
	local suffix="${width}x${height}"
	start_pi "$width" "$height"

	tmux send-keys -t "$tmux_session" -l "/btw Why should this remain outside the main transcript?"
	tmux send-keys -t "$tmux_session" Enter
	wait_for_text "Answering…"
	wait_for_text "/btw"
	capture_frame "pi-0.83-btw-phase2-production-answering-$suffix"
	wait_for_text "The side answer stays outside the main transcript."
	wait_for_text "f fork"
	capture_frame "pi-0.83-btw-phase2-production-answered-$suffix"

	tmux send-keys -t "$tmux_session" Escape
	wait_for_absence "The side answer stays outside the main transcript."
	tmux send-keys -t "$tmux_session" -l "/btw What did the first answer emphasize in a second sentence?"
	tmux send-keys -t "$tmux_session" Enter
	wait_for_text "The first answer emphasized transcript isolation"
	wait_for_text "←/→ history"
	capture_frame "pi-0.83-btw-phase2-production-history-$suffix"

	stop_pi
}

run_geometry 100 32
run_geometry 64 28

for state in answering answered history; do
	for geometry in 100x32 64x28; do
		artifact="$artifact_dir/pi-0.83-btw-phase2-production-$state-$geometry.png"
		if [[ ! -s $artifact ]]; then
			echo "Missing capture: $artifact" >&2
			exit 1
		fi
	done
done

echo "Captured production BTW Phase 2 states at 100x32 and 64x28"
