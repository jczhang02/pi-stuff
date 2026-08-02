#!/usr/bin/env bash

# PROTOTYPE — capture one deterministic native-Pi 0.83 lifecycle interaction.
# No command below starts a model, real Agent, network request, or product I/O.
# Ctrl+B/Ctrl+N/P are capture-only harness controls, not product keybindings.
# The displayed destructive command is fixture data and is never executed.

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
freeze_bin=${FREEZE_BIN:-freeze}
artifact_dir="$repo_root/docs/prototypes/tui/artifacts"
capture_root=$(mktemp -d)
tmux_session="pi-stuff-work-agent-lifecycle-$$"
main_draft="draft: keep migration notes"
continued_draft="$main_draft + typing continues"

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
if [[ ! -x $pi_bin ]]; then
	echo "Repository-pinned Pi executable not found: $pi_bin" >&2
	exit 1
fi
if [[ $($pi_bin --version) != "0.83.0" ]]; then
	echo "Work Agent lifecycle capture requires Pi 0.83.0" >&2
	exit 1
fi
if [[ $(bun --version) != "1.3.14" ]]; then
	echo "Work Agent lifecycle capture requires Bun 1.3.14" >&2
	exit 1
fi

mkdir -p "$capture_root/agent" "$capture_root/sessions" "$artifact_dir"
printf '%s\n' '{"theme":"dark","quietStartup":true,"enableInstallTelemetry":false,"outputPad":1}' \
	> "$capture_root/agent/settings.json"
# Release the Emacs cursor aliases used only by this isolated harness so the
# capture-only Ctrl+B and Ctrl+N extension shortcuts have no conflict.
printf '%s\n' '{"tui.editor.cursorLeft":["left"],"tui.editor.cursorDown":["down"]}' \
	> "$capture_root/agent/keybindings.json"

fixture="$repo_root/docs/prototypes/tui/work-agent-lifecycle-spike-fixture.ts"
extension="$repo_root/docs/prototypes/tui/work-agent-lifecycle-spike.ts"
session_file=$(bun "$fixture" "$capture_root/sessions")

wait_for_text() {
	local expected=$1
	local attempts=0
	while ((attempts < 120)); do
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

wait_for_pattern() {
	local pattern=$1
	local attempts=0
	while ((attempts < 120)); do
		if tmux capture-pane -p -t "$tmux_session" | rg --quiet -- "$pattern"; then
			return 0
		fi
		((attempts += 1))
		sleep 0.1
	done

	echo "Timed out waiting for pattern: $pattern" >&2
	tmux capture-pane -p -t "$tmux_session" >&2
	return 1
}

wait_for_absence() {
	local rejected=$1
	local attempts=0
	while ((attempts < 120)); do
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

reject_text() {
	local rejected=$1
	if tmux capture-pane -p -t "$tmux_session" | rg -F --quiet -- "$rejected"; then
		echo "Unexpected text in Pi PTY: $rejected" >&2
		tmux capture-pane -p -t "$tmux_session" >&2
		return 1
	fi
}

start_pi() {
	local width=${1:-100}
	local height=${2:-32}
	local command
	printf -v command \
		'env PI_CODING_AGENT_DIR=%q PI_OFFLINE=1 PI_TELEMETRY=0 %q --session %q --model fixture/work-agent-lifecycle-fixture --no-extensions -e %q --no-skills --no-prompt-templates --no-context-files --tools prototype_work_agent_lifecycle --no-themes --offline --approve' \
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

assert_no_floating_ui() {
	reject_text "╭"
	reject_text "╮"
	reject_text "╰"
	reject_text "╯"
	reject_text "Extension issues"
	reject_text "shortcut conflict"
}

assert_main_surface() {
	wait_for_text "Verify one work-surface coordinator"
	wait_for_text "↓ to manage"
	wait_for_text "$main_draft"
	reject_text "Tripwire confirmation"
	reject_text "PROTOTYPE state · surface BTW"
	assert_no_floating_ui
}

assert_command_surface() {
	local width=$1
	wait_for_pattern "^─{$width}$"
	reject_text "$main_draft"
	reject_text "Verify one work-surface coordinator"
	reject_text "↓ to manage"
	reject_text "work-agent-lifecycle-fixture"
	assert_no_floating_ui
}

type_main_draft() {
	wait_for_text "Background Agents"
	wait_for_text "↓ to manage"
	tmux send-keys -t "$tmux_session" -l "$main_draft"
	wait_for_text "$main_draft"
	sleep 0.2
}

capture_command_coordinator() {
	start_pi 100 32
	type_main_draft
	assert_main_surface

	# Capture-only Ctrl+B opens BTW. The product entry point remains undecided.
	tmux send-keys -t "$tmux_session" C-b
	wait_for_text "single exchange"
	assert_command_surface 100
	capture_frame "pi-0.83-work-agent-lifecycle-btw"

	# Capture-only P injects an inert, statically explicit destructive-operation
	# tripwire into the same custom() component.
	tmux send-keys -t "$tmux_session" -l p
	wait_for_text "Tripwire confirmation"
	wait_for_text "outside session cwd"
	wait_for_text "rm -- /tmp/pi-stuff-tripwire-prototype/obsolete.txt"
	wait_for_text "Allow this exact operation once"
	wait_for_text "Deny"
	wait_for_text "decision is not remembered"
	wait_for_text "resume BTW"
	assert_command_surface 100
	reject_text "single exchange"
	reject_text "Allow for this session"
	reject_text "Always allow"
	reject_text "Allow and remember"
	capture_frame "pi-0.83-work-agent-lifecycle-permission"

	# Esc denies only this exact operation and restores the suspended BTW surface.
	tmux send-keys -t "$tmux_session" Escape
	wait_for_text "Denied reviewer operation · BTW restored"
	assert_command_surface 100
	capture_frame "pi-0.83-work-agent-lifecycle-permission-rejected-btw-restored"

	# The independent one-time approval path must restore the same BTW surface.
	tmux send-keys -t "$tmux_session" -l p
	wait_for_text "Tripwire confirmation"
	wait_for_text "Allow this exact operation once"
	tmux send-keys -t "$tmux_session" Enter
	wait_for_text "Allowed this exact reviewer operation once · BTW restored"
	assert_command_surface 100
	capture_frame "pi-0.83-work-agent-lifecycle-permission-allowed-btw-restored"

	# A second Esc now closes BTW itself and restores all Host-owned chrome.
	tmux send-keys -t "$tmux_session" Escape
	wait_for_absence "PROTOTYPE state · surface BTW"
	assert_main_surface
	capture_frame "pi-0.83-work-agent-lifecycle-main-restored"

	# Capture-only Ctrl+N injects user-input-required after the main Agent has
	# judged a human answer necessary. No custom surface opens and all later
	# typing remains editor-owned.
	tmux send-keys -t "$tmux_session" C-n
	wait_for_text "planner needs input"
	wait_for_text "waiting"
	tmux send-keys -t "$tmux_session" -l " + typing continues"
	wait_for_text "$continued_draft"
	reject_text "Tripwire confirmation"
	reject_text "PROTOTYPE state · surface BTW"
	capture_frame "pi-0.83-work-agent-lifecycle-needs-input-editor-owned"

	# The custom editor admits roster navigation only after the draft is empty.
	tmux send-keys -t "$tmux_session" C-u
	wait_for_absence "$continued_draft"
	tmux send-keys -t "$tmux_session" Down
	wait_for_text "x stop selected"
	tmux send-keys -t "$tmux_session" Down
	wait_for_pattern '●[[:space:]]*reviewer'
	tmux send-keys -t "$tmux_session" -l x
	wait_for_text "stopping"
	reject_text "Are you sure"
	reject_text "Confirm"
	reject_text "Tripwire confirmation"
	capture_frame "pi-0.83-work-agent-lifecycle-stop-requested"

	wait_for_text "stopped · 12s"
	wait_for_text "done · 18s"
	wait_for_text "failed · 9s"
	wait_for_text "waiting"
	reject_text "reviewer + planner continue"
	capture_frame "pi-0.83-work-agent-lifecycle-mixed"
	stop_pi
}

capture_narrow_mixed() {
	start_pi 64 28
	type_main_draft

	# Repeat the non-modal event at 64×28 before creating the mixed final state.
	tmux send-keys -t "$tmux_session" C-n
	wait_for_text "planner needs input"
	tmux send-keys -t "$tmux_session" -l " + typing continues"
	wait_for_text "$continued_draft"
	tmux send-keys -t "$tmux_session" C-u
	wait_for_absence "$continued_draft"
	tmux send-keys -t "$tmux_session" Down Down
	wait_for_pattern '●[[:space:]]*reviewer'
	tmux send-keys -t "$tmux_session" -l x
	wait_for_text "stopped · 12s"
	wait_for_text "done · 18s"
	wait_for_text "failed · 9s"
	wait_for_text "waiting"
	assert_no_floating_ui
	capture_frame "pi-0.83-work-agent-lifecycle-mixed-narrow"
	stop_pi
}

capture_command_coordinator
capture_narrow_mixed
