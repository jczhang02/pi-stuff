#!/usr/bin/env bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
freeze_bin=${FREEZE_BIN:-freeze}
artifact_dir="$repo_root/docs/prototypes/tui/artifacts"
capture_root=$(mktemp -d)
tmux_session="pi-stuff-tool-ui-$$"

cleanup() {
	if tmux has-session -t "$tmux_session" 2>/dev/null; then
		tmux kill-session -t "$tmux_session"
	fi
	rm -rf -- "$capture_root"
}
trap cleanup EXIT

for executable in bun rg tmux "$freeze_bin"; do
	if ! command -v "$executable" >/dev/null 2>&1; then
		echo "Required executable not found: $executable" >&2
		exit 1
	fi
done

pi_bin="$repo_root/node_modules/.bin/pi"
certified_pi_version=$(bun "$repo_root/scripts/pi-host-contract.ts")
artifact_prefix="pi-$certified_pi_version"
if [[ ! -x $pi_bin ]]; then
	echo "Repository-pinned Pi executable not found: $pi_bin" >&2
	exit 1
fi
if [[ $("$pi_bin" --version) != "$certified_pi_version" ]]; then
	echo "Tool UI capture requires Pi $certified_pi_version" >&2
	exit 1
fi
if [[ $(bun --version) != "1.3.14" ]]; then
	echo "Tool UI capture requires Bun 1.3.14" >&2
	exit 1
fi

mkdir -p "$capture_root/agent" "$capture_root/sessions" "$artifact_dir"
printf '%s\n' '{"theme":"dark","quietStartup":true,"enableInstallTelemetry":false,"outputPad":1}' \
	> "$capture_root/agent/settings.json"
# This isolated Settings Layer fixture releases Ctrl+O from Host-wide expansion
# and from the tree picker's context-only filter cycle before the prototype uses it.
printf '%s\n' '{"app.tools.expand":[],"app.tree.filter.cycleForward":[]}' \
	> "$capture_root/agent/keybindings.json"

fixture="$repo_root/docs/prototypes/tui/tool-ui-comparison-fixture.ts"
extension="$repo_root/docs/prototypes/tui/tool-ui-comparison.ts"
individual_session=$(bun "$fixture" individual "$capture_root/sessions")
grouped_session=$(bun "$fixture" grouped "$capture_root/sessions")
bounded_session=$(bun "$fixture" bounded "$capture_root/sessions")

wait_for_text() {
	local expected=$1
	local attempts=0
	while ((attempts < 100)); do
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
	if tmux capture-pane -p -S - -t "$tmux_session" | rg -F --quiet -- "$rejected"; then
		echo "Unexpected text in Pi PTY: $rejected" >&2
		tmux capture-pane -p -S - -t "$tmux_session" >&2
		return 1
	fi
}

start_pi() {
	local session_file=$1
	local width=${2:-100}
	local height=${3:-32}
	local command
	printf -v command \
		'env PI_CODING_AGENT_DIR=%q PI_OFFLINE=1 PI_TELEMETRY=0 %q --session %q --model fixture/tool-ui-fixture --no-extensions -e %q --no-skills --no-prompt-templates --no-context-files --tools prototype_tool_action --no-themes --offline --approve' \
		"$capture_root/agent" \
		"$pi_bin" \
		"$session_file" \
		"$extension"

	tmux new-session -d -s "$tmux_session" -x "$width" -y "$height" -c "$repo_root" "$command"
	local geometry
	geometry=$(tmux display-message -p -t "$tmux_session" '#{pane_width}x#{pane_height}')
	if [[ $geometry != "${width}x${height}" ]]; then
		echo "Unexpected tmux geometry: $geometry" >&2
		return 1
	fi
}

stop_pi() {
	if tmux has-session -t "$tmux_session" 2>/dev/null; then
		tmux kill-session -t "$tmux_session"
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

capture_transcript_variant() {
	local session_file=$1
	local expected=$2
	local artifact_name=$3
	start_pi "$session_file"
	wait_for_text "入口、渲染约束和测试基线都已确认。"
	wait_for_text "$expected"
	reject_text "Extension issues"
	reject_text "shortcut conflict"
	# Review the complete settled transcript rather than leaving earlier rows
	# just above the viewport after Pi collapses hidden self-shell components.
	tmux copy-mode -u -t "$tmux_session"
	capture_frame "$artifact_name"
	stop_pi
}

capture_transcript_variant \
	"$individual_session" \
	"12 matches in 5 files" \
	"${artifact_prefix}-tool-ui-individual"

capture_transcript_variant \
	"$grouped_session" \
	"Investigated tool UI · read 2 sources" \
	"${artifact_prefix}-tool-ui-grouped"

capture_transcript_variant \
	"$bounded_session" \
	"+1 more" \
	"${artifact_prefix}-tool-ui-bounded"

start_pi "$bounded_session"
wait_for_text "入口、渲染约束和测试基线都已确认。"
tmux send-keys -t "$tmux_session" C-o
wait_for_text "Tool Details"
wait_for_text "test/suite-generator.test.ts"
reject_text "Extension issues"
reject_text "shortcut conflict"
tmux send-keys -t "$tmux_session" NPage NPage NPage
wait_for_text "FULL TEST OUTPUT · shard 24/24 complete"
capture_frame "${artifact_prefix}-tool-details-dialog"
tmux send-keys -t "$tmux_session" Escape
wait_for_text "tool-ui-fixture"
stop_pi

# Narrow-terminal smoke: exercise selection, local scrolling, and restoration
# without producing another review artifact.
start_pi "$bounded_session" 64 28
wait_for_text "入口、渲染约束和测试基线都已确认。"
tmux send-keys -t "$tmux_session" C-o
wait_for_text "Tool Details"
tmux send-keys -t "$tmux_session" NPage
wait_for_text "Lines"
reject_text "Extension issues"
reject_text "shortcut conflict"
tmux send-keys -t "$tmux_session" Escape
wait_for_text "tool-ui-fixture"
stop_pi
