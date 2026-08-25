#!/usr/bin/env bash

# PROTOTYPE — capture the selected Welcome Header in the real local Pi Host.
# The run is offline, uses a temporary Settings Layer, and writes no sessions.

set -euo pipefail

prototype_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$prototype_dir/../../../../.." && pwd)
pi_bin=${PI_BIN:-/opt/bin/pi}
certified_pi_version=$(bun "$repo_root/scripts/pi-host-contract.ts")
freeze_bin=${FREEZE_BIN:-/tmp/pi-proto-bin/freeze}
extension="$prototype_dir/welcome-header-prototype.ts"
artifact_dir="$prototype_dir/artifacts"
capture_root=$(mktemp -d)
tmux_session=""
# This is literal UI text, not a filesystem path.
# shellcheck disable=SC2088
welcome_fixture_path='~/dev/pi-stuff'

cleanup() {
	if [[ -n $tmux_session ]] && tmux has-session -t "$tmux_session" 2>/dev/null; then
		tmux kill-session -t "$tmux_session"
	fi
	rm -rf -- "$capture_root"
}
trap cleanup EXIT

for executable in bun rg tmux "$pi_bin" "$freeze_bin"; do
	if ! command -v "$executable" >/dev/null 2>&1 && [[ ! -x $executable ]]; then
		echo "Required executable not found: $executable" >&2
		exit 1
	fi
done

if [[ $("$pi_bin" --version) != "$certified_pi_version" ]]; then
	echo "Welcome capture requires the local Pi Host reporting $certified_pi_version" >&2
	exit 1
fi
if [[ $(bun --version) != "1.4.0" ]]; then
	echo "Welcome capture requires Bun 1.4.0" >&2
	exit 1
fi

mkdir -p "$artifact_dir"

wait_for_text() {
	local expected=$1
	local attempts=0
	while ((attempts < 160)); do
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
	while ((attempts < 160)); do
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

capture_frame() {
	local stem=$1
	tmux capture-pane -p -e -N -t "$tmux_session" > "$artifact_dir/$stem.ansi"
	tmux capture-pane -p -N -t "$tmux_session" > "$artifact_dir/$stem.txt"
	"$freeze_bin" \
		-c base \
		--margin 0 \
		--padding 8 \
		--border.radius 0 \
		--font.family 'Iosevka Nerd Font Mono' \
		--font.size 15 \
		--line-height 1.15 \
		-o "$artifact_dir/$stem.png" \
		"$artifact_dir/$stem.ansi"

	if [[ ! -s $artifact_dir/$stem.png || ! -s $artifact_dir/$stem.ansi || ! -s $artifact_dir/$stem.txt ]]; then
		echo "Missing capture artifact: $stem" >&2
		return 1
	fi
}

capture_geometry() {
	local width=$1
	local height=$2
	local include_scroll_proof=${3:-false}
	local label="${width}x${height}"
	local case_root="$capture_root/$label"
	local agent_dir="$case_root/agent"
	local command

	mkdir -p "$agent_dir"
	printf '%s\n' '{"theme":"dark","quietStartup":true,"enableInstallTelemetry":false,"outputPad":1,"tuiMode":"fullscreen"}' \
		> "$agent_dir/settings.json"
	printf -v command \
		'env PI_CODING_AGENT_DIR=%q PI_OFFLINE=1 PI_TELEMETRY=0 %q --no-session --model welcome-fixture/gpt-5.6-sol --no-extensions -e %q --no-skills --no-prompt-templates --no-context-files --no-tools --no-themes --offline --approve --tui-mode fullscreen' \
		"$agent_dir" \
		"$pi_bin" \
		"$extension"

	tmux_session="pi-stuff-welcome-$label-$$"
	tmux new-session -d -s "$tmux_session" -x "$width" -y "$height" -c "$repo_root" "$command"
	local geometry
	geometry=$(tmux display-message -p -t "$tmux_session" '#{pane_width}x#{pane_height}')
	if [[ $geometry != "$label" ]]; then
		echo "Unexpected tmux geometry: $geometry" >&2
		return 1
	fi

	wait_for_text "Welcome back!"
	sleep 0.2

	local stem="real-pi-welcome-$label"
	capture_frame "$stem"

	if [[ $include_scroll_proof == "true" ]]; then
		tmux send-keys -t "$tmux_session" -l "/prototype-fill"
		tmux send-keys -t "$tmux_session" Enter
		wait_for_text "Transcript line 20"
		wait_for_absence "Welcome back!"
		capture_frame "real-pi-welcome-scrolled-$label"
	fi

	tmux kill-session -t "$tmux_session"
	tmux_session=""
}

capture_geometry 100 32
capture_geometry 64 28 true
capture_geometry 32 18

rg -F --quiet -- "3 context · 24 extensions" \
	"$artifact_dir/real-pi-welcome-100x32.txt"
rg -F --quiet -- "$welcome_fixture_path" \
	"$artifact_dir/real-pi-welcome-64x28.txt"
rg -F --quiet -- "Welcome back!" \
	"$artifact_dir/real-pi-welcome-32x18.txt"
if rg -F --quiet -- "24 extensions" "$artifact_dir/real-pi-welcome-64x28.txt"; then
	echo "Narrow Welcome retained wide-only inventory" >&2
	exit 1
fi
rg -F --quiet -- "Transcript line 20 · Welcome belongs to the document" \
	"$artifact_dir/real-pi-welcome-scrolled-64x28.txt"
if rg -F --quiet -- "Welcome back!" "$artifact_dir/real-pi-welcome-scrolled-64x28.txt"; then
	echo "Welcome remained fixed after the transcript filled the viewport" >&2
	exit 1
fi

echo "Captured three Welcome widths plus a real 64x28 scroll-away proof in Pi $certified_pi_version."
