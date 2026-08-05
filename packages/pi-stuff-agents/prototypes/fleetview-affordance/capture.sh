#!/usr/bin/env bash

# PROTOTYPE ONLY — capture genuine Pi 0.83 PTY frames for three Fleetview
# affordance structures. Generated files stay on the throwaway branch.

set -euo pipefail

prototype_root=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(git -C "$prototype_root" rev-parse --show-toplevel)
pi_bin=${PI_BIN:-/opt/bin/pi}
freeze_bin=${FREEZE_BIN:-/tmp/pi-stuff-freeze-bin/freeze}
extension="$prototype_root/prototype.ts"
artifact_dir="$prototype_root/artifacts"
capture_root=$(mktemp -d /tmp/pi-stuff-fleetview-affordance.XXXXXX)
tmux_session=""

cleanup() {
	if [[ -n $tmux_session ]] && tmux has-session -t "$tmux_session" 2>/dev/null; then
		tmux kill-session -t "$tmux_session"
	fi
	if [[ -d $capture_root && $capture_root == /tmp/pi-stuff-fleetview-affordance.* ]]; then
		find "$capture_root" -depth -delete
	fi
}
trap cleanup EXIT

for executable in bun magick rg tmux "$pi_bin" "$freeze_bin"; do
	if ! command -v "$executable" >/dev/null 2>&1 && [[ ! -x $executable ]]; then
		echo "Required executable not found: $executable" >&2
		exit 1
	fi
done

[[ $($pi_bin --version) == "0.83.0" ]] || { echo "Requires Pi 0.83.0" >&2; exit 1; }
[[ $(bun --version) == "1.3.14" ]] || { echo "Requires Bun 1.3.14" >&2; exit 1; }
mkdir -p "$artifact_dir"

wait_for_text() {
	local expected=$1
	local attempts=0
	while ((attempts < 200)); do
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

capture_frame() {
	local stem=$1
	local raw_ansi="$capture_root/$stem.raw.ansi"
	local raw_text="$capture_root/$stem.raw.txt"

	tmux capture-pane -p -e -N -t "$tmux_session" > "$raw_ansi"
	tmux capture-pane -p -N -t "$tmux_session" > "$raw_text"
	"$freeze_bin" \
		-c base \
		--margin 0 \
		--padding 8 \
		--border.radius 0 \
		--font.family "Iosevka Nerd Font Mono" \
		--font.size 15 \
		--line-height 1.15 \
		-o "$artifact_dir/$stem.png" \
		"$raw_ansi"
	sed -E 's/[[:space:]]+$//' "$raw_ansi" > "$artifact_dir/$stem.ansi"
	sed -E 's/[[:space:]]+$//' "$raw_text" > "$artifact_dir/$stem.txt"
	magick "$artifact_dir/$stem.png" \
		-gravity South \
		-crop 'x700+0+0' \
		+repage \
		"$artifact_dir/$stem-detail.png"
}

capture_case() {
	local variant=$1
	local state=$2
	local width=$3
	local height=$4
	local stem="variant-${variant}-${state}-${width}x${height}"
	local case_root="$capture_root/$stem"
	local agent_dir="$case_root/agent"
	local command

	mkdir -p "$agent_dir"
	printf '%s\n' '{"theme":"dark","quietStartup":true,"enableInstallTelemetry":false,"outputPad":1,"uiMode":"fullscreen"}' > "$agent_dir/settings.json"
	printf '%s\n' '{"tui.editor.cursorLeft":["left"]}' > "$agent_dir/keybindings.json"
	printf -v command \
		'env PI_CODING_AGENT_DIR=%q PI_OFFLINE=1 PI_TELEMETRY=0 PI_STUFF_FLEETVIEW_VARIANT=%q PI_STUFF_FLEETVIEW_STATE=%q %q --no-session --model %q --thinking high --ui-mode fullscreen --no-extensions -e %q --no-skills --no-prompt-templates --no-context-files --no-tools --no-themes --offline --approve' \
		"$agent_dir" \
		"$variant" \
		"$state" \
		"$pi_bin" \
		"fleetview-affordance-fixture/gpt-5.6-sol" \
		"$extension"

	tmux_session="pi-stuff-fleetview-${variant}-${state}-${width}-$$"
	tmux new-session -d -s "$tmux_session" -x "$width" -y "$height" -c "$repo_root" "$command"
	local geometry
	geometry=$(tmux display-message -p -t "$tmux_session" '#{pane_width}x#{pane_height}')
	[[ $geometry == "${width}x${height}" ]] || { echo "Unexpected tmux geometry: $geometry" >&2; exit 1; }

	wait_for_text "openai-codex/gpt-5.6-sol"
	wait_for_text "explorer"
	wait_for_text "reviewer"
	if [[ $state == "active" ]]; then
		wait_for_text "x stop"
	else
		wait_for_text "● main"
	fi
	sleep 0.2
	capture_frame "$stem"
	tmux kill-session -t "$tmux_session"
	tmux_session=""
}

for variant in a b c; do
	for state in idle active; do
		capture_case "$variant" "$state" 100 24
		capture_case "$variant" "$state" 64 18
	done
done

for variant in a b c; do
	for state in idle active; do
		for geometry in 100x24 64x18; do
			for extension_name in ansi txt png; do
				artifact="$artifact_dir/variant-${variant}-${state}-${geometry}.${extension_name}"
				[[ -s $artifact ]] || { echo "Missing capture: $artifact" >&2; exit 1; }
			done
			artifact="$artifact_dir/variant-${variant}-${state}-${geometry}-detail.png"
			[[ -s $artifact ]] || { echo "Missing capture: $artifact" >&2; exit 1; }
		done
	done
done

echo "Captured twelve genuine Pi 0.83 frames under $artifact_dir"
