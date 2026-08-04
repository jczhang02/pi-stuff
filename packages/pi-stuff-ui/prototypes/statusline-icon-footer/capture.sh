#!/usr/bin/env bash

# PROTOTYPE ONLY — capture six genuine Pi 0.83 PTY frames (three variants at
# wide and narrow terminal widths). Generated files stay inside this prototype.

set -euo pipefail

prototype_root=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(git -C "$prototype_root" rev-parse --show-toplevel)
pi_bin=${PI_BIN:-/opt/bin/pi}
freeze_bin=${FREEZE_BIN:-/tmp/pi-stuff-freeze-bin/freeze}
extension="$prototype_root/statusline-prototype.ts"
fixture="$prototype_root/statusline-fixture.ts"
artifact_dir="$prototype_root/artifacts"
capture_root=$(mktemp -d /tmp/pi-stuff-statusline-prototype.XXXXXX)
tmux_session=""

cleanup() {
	if [[ -n $tmux_session ]] && tmux has-session -t "$tmux_session" 2>/dev/null; then
		tmux kill-session -t "$tmux_session"
	fi
	if [[ -d $capture_root && $capture_root == /tmp/pi-stuff-statusline-prototype.* ]]; then
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

reject_text() {
	local rejected=$1
	if tmux capture-pane -p -t "$tmux_session" | rg -F --quiet -- "$rejected"; then
		echo "Unexpected text in Pi PTY: $rejected" >&2
		tmux capture-pane -p -t "$tmux_session" >&2
		return 1
	fi
}

require_pattern() {
	local expected_pattern=$1
	if ! tmux capture-pane -p -t "$tmux_session" | rg --quiet --regexp "$expected_pattern"; then
		echo "Expected aligned Pi PTY pattern: $expected_pattern" >&2
		tmux capture-pane -p -t "$tmux_session" >&2
		return 1
	fi
}

capture_frame() {
	local name=$1
	local ansi_file="$artifact_dir/$name.ansi"
	local text_file="$artifact_dir/$name.txt"
	local raw_ansi="$capture_root/$name.raw.ansi"
	local raw_text="$capture_root/$name.raw.txt"
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
		-o "$artifact_dir/$name.png" \
		"$raw_ansi"
	sed -E 's/[[:space:]]+$//' "$raw_ansi" > "$ansi_file"
	sed -E 's/[[:space:]]+$//' "$raw_text" > "$text_file"
	magick "$artifact_dir/$name.png" \
		-gravity South \
		-crop 'x360+0+0' \
		+repage \
		"$artifact_dir/$name-footer.png"
}

capture_case() {
	local variant=$1
	local width=$2
	local height=$3
	local label="variant-${variant}-${width}x${height}"
	local case_root="$capture_root/$label"
	local agent_dir="$case_root/agent"
	local sessions_dir="$case_root/sessions"
	local session_file
	local command

	mkdir -p "$agent_dir" "$sessions_dir"
	printf '%s\n' '{"theme":"dark","quietStartup":true,"enableInstallTelemetry":false,"outputPad":1,"uiMode":"fullscreen"}' > "$agent_dir/settings.json"
	printf '%s\n' '{"tui.editor.cursorLeft":["left"]}' > "$agent_dir/keybindings.json"
	session_file=$(cd "$repo_root" && bun "$fixture" "$sessions_dir")
	printf -v command \
		'env PI_CODING_AGENT_DIR=%q PI_OFFLINE=1 PI_TELEMETRY=0 PI_STUFF_STATUSLINE_VARIANT=%q %q --session %q --model %q --thinking high --ui-mode fullscreen --no-extensions -e %q --no-skills --no-prompt-templates --no-context-files --no-tools --no-themes --offline --approve' \
		"$agent_dir" \
		"$variant" \
		"$pi_bin" \
		"$session_file" \
		"statusline-fixture/gpt-5.6-sol" \
		"$extension"

	tmux_session="pi-stuff-statusline-${variant}-${width}-$$"
	tmux new-session -d -s "$tmux_session" -x "$width" -y "$height" -c "$repo_root" "$command"
	wait_for_text "deterministic Statusline fixture"
	wait_for_text "openai-codex/gpt-5.6-sol"
	wait_for_text " 请按 pi-footer"
	if [[ $variant == a ]]; then
		require_pattern '^󰚩 openai-codex/gpt-5\.6-sol'
		require_pattern '^ 请按 pi-footer'
	fi
	if [[ $width == 120 ]]; then
		for expected in "high" "Fast" "pi-stuff" "main" "+6" "-0" "42%" "78%" "52%"; do
			wait_for_text "$expected"
		done
	else
		for expected in "pi-stuff" "main" "42%" "52%"; do
			wait_for_text "$expected"
		done
		for rejected in "high" "Fast" "78%"; do
			reject_text "$rejected"
		done
		if [[ $variant == a ]]; then
			reject_text "+6"
		else
			wait_for_text "+6"
		fi
	fi
	capture_frame "$label"
	tmux kill-session -t "$tmux_session"
	tmux_session=""
}

for variant in a b c; do
	capture_case "$variant" 120 30
	capture_case "$variant" 72 24
done

for variant in a b c; do
	for geometry in 120x30 72x24; do
		for extension_name in ansi txt png; do
			artifact="$artifact_dir/variant-${variant}-${geometry}.${extension_name}"
			[[ -s $artifact ]] || { echo "Missing capture: $artifact" >&2; exit 1; }
		done
		artifact="$artifact_dir/variant-${variant}-${geometry}-footer.png"
		[[ -s $artifact ]] || { echo "Missing capture: $artifact" >&2; exit 1; }
	done
done

echo "Captured six genuine Pi 0.83 frames under $artifact_dir"
