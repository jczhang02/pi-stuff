#!/usr/bin/env bash

# PROTOTYPE — capture deterministic certified-Pi BTW layout fixtures only.
# No command below starts a model, background Agent, or persistent mailbox.

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
freeze_bin=${FREEZE_BIN:-freeze}
artifact_dir="$repo_root/docs/prototypes/tui/artifacts"
capture_root=$(mktemp -d)
tmux_session="pi-stuff-work-btw-$$"
main_draft="draft: keep main API notes"

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
	echo "Work BTW capture requires Pi $certified_pi_version" >&2
	exit 1
fi
if [[ $(bun --version) != "1.4.0" ]]; then
	echo "Work BTW capture requires Bun 1.4.0" >&2
	exit 1
fi

mkdir -p "$capture_root/agent" "$capture_root/sessions" "$artifact_dir"
printf '%s\n' '{"theme":"dark","quietStartup":true,"enableInstallTelemetry":false,"outputPad":1}' \
	> "$capture_root/agent/settings.json"
# Ctrl+B is a capture-only entry point. Keep Left available while releasing the
# Emacs-style cursor-left alias so the extension shortcut has no conflict.
printf '%s\n' '{"tui.editor.cursorLeft":["left"]}' > "$capture_root/agent/keybindings.json"

fixture="$repo_root/docs/prototypes/tui/work-btw-comparison-fixture.ts"
extension="$repo_root/docs/prototypes/tui/work-btw-comparison.ts"

declare -A session_files
for variant in claude ephemeral mailbox; do
	session_files["$variant"]=$(bun "$fixture" "$variant" "$capture_root/sessions")
done

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

wait_for_pattern() {
	local pattern=$1
	local attempts=0
	while ((attempts < 100)); do
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
	while ((attempts < 100)); do
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
	local session_file=$1
	local width=${2:-100}
	local height=${3:-32}
	local command
	printf -v command \
		'env PI_CODING_AGENT_DIR=%q PI_OFFLINE=1 PI_TELEMETRY=0 %q --session %q --model fixture/work-btw-fixture --no-extensions -e %q --no-skills --no-prompt-templates --no-context-files --tools prototype_work_btw --no-themes --offline --approve' \
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

type_main_draft() {
	wait_for_text "Main task continues"
	wait_for_text "↓ to manage"
	tmux send-keys -t "$tmux_session" -l "$main_draft"
	wait_for_text "$main_draft"
	# Let Pi finish the editor frame before the custom surface replaces it;
	# otherwise tmux can retain one stale draft row from the previous frame.
	sleep 0.2
}

assert_normal_screen() {
	local width=$1
	wait_for_text "Main task continues"
	wait_for_text "Compare three dialog structures"
	wait_for_text "↓ to manage"
	wait_for_text "$main_draft"
	reject_text "BTW"
	reject_text "Follow-up"
	reject_text "╭"
	reject_text "╮"
	reject_text "╰"
	reject_text "╯"
	reject_text "Extension issues"
	reject_text "shortcut conflict"

	if [[ $width == "100" ]]; then
		local footer_count
		footer_count=$(tmux capture-pane -p -t "$tmux_session" | rg -F -c -- "work-btw-fixture" || true)
		if [[ $footer_count != "1" ]]; then
			echo "Expected exactly one built-in footer row, found: $footer_count" >&2
			tmux capture-pane -p -t "$tmux_session" >&2
			return 1
		fi
	fi
}

assert_dialog_screen() {
	local width=$1
	wait_for_text "BTW"
	wait_for_pattern "^─{$width}$"
	reject_text "$main_draft"
	reject_text "Compare three dialog structures"
	reject_text "↓ to manage"
	reject_text "work-btw-fixture"
	reject_text "╭"
	reject_text "╮"
	reject_text "╰"
	reject_text "╯"
	reject_text "Extension issues"
	reject_text "shortcut conflict"
}

open_dialog() {
	tmux send-keys -t "$tmux_session" C-b
}

capture_claude_variant() {
	start_pi "${session_files[claude]}"
	type_main_draft
	assert_normal_screen 100
	open_dialog
	wait_for_text "single exchange"
	assert_dialog_screen 100
	reject_text "Follow-up"
	capture_frame "${artifact_prefix}-work-btw-claude-exchange"

	tmux send-keys -t "$tmux_session" h
	wait_for_text "session-local history"
	capture_frame "${artifact_prefix}-work-btw-claude-history"

	tmux send-keys -t "$tmux_session" Escape
	wait_for_absence "session-local history"
	assert_normal_screen 100
	capture_frame "${artifact_prefix}-work-btw-claude-restored"
	stop_pi

	start_pi "${session_files[claude]}" 64 28
	type_main_draft
	open_dialog
	wait_for_text "single exchange"
	assert_dialog_screen 64
	reject_text "Follow-up"
	capture_frame "${artifact_prefix}-work-btw-claude-narrow"
	stop_pi
}

capture_ephemeral_variant() {
	start_pi "${session_files[ephemeral]}"
	type_main_draft
	assert_normal_screen 100
	open_dialog
	wait_for_text "BTW side thread"
	assert_dialog_screen 100
	tmux send-keys -t "$tmux_session" -l "show a concrete failure path"
	wait_for_text "show a concrete failure path"
	capture_frame "${artifact_prefix}-work-btw-ephemeral-thread"

	tmux send-keys -t "$tmux_session" Tab
	wait_for_pattern "› Bring answer into main draft"
	capture_frame "${artifact_prefix}-work-btw-ephemeral-bring"

	tmux send-keys -t "$tmux_session" Escape
	wait_for_absence "BTW side thread"
	assert_normal_screen 100
	capture_frame "${artifact_prefix}-work-btw-ephemeral-restored"
	stop_pi

	# The optional action moves only a reference into the restored main draft;
	# it does not create a normal transcript entry or persistent BTW surface.
	start_pi "${session_files[ephemeral]}"
	type_main_draft
	open_dialog
	wait_for_text "BTW side thread"
	tmux send-keys -t "$tmux_session" Tab Enter
	wait_for_text "Reference from detached answer"
	wait_for_absence "BTW side thread"
	wait_for_text "Compare three dialog structures"
	wait_for_text "↓ to manage"
	reject_text "Extension issues"
	reject_text "shortcut conflict"
	stop_pi

	start_pi "${session_files[ephemeral]}" 64 28
	type_main_draft
	open_dialog
	wait_for_text "BTW side thread"
	assert_dialog_screen 64
	tmux send-keys -t "$tmux_session" -l "narrow follow-up"
	wait_for_text "narrow follow-up"
	capture_frame "${artifact_prefix}-work-btw-ephemeral-narrow"
	stop_pi
}

submit_mailbox_question() {
	open_dialog
	wait_for_text "BTW detached mailbox"
	tmux send-keys -t "$tmux_session" -l "Can this stay outside the main transcript?"
	wait_for_text "Can this stay outside the main transcript?"
	tmux send-keys -t "$tmux_session" Enter
	wait_for_absence "BTW detached mailbox"
}

capture_mailbox_variant() {
	start_pi "${session_files[mailbox]}"
	type_main_draft
	assert_normal_screen 100
	submit_mailbox_question
	assert_normal_screen 100
	capture_frame "${artifact_prefix}-work-btw-mailbox-returned"

	open_dialog
	wait_for_text "BTW mailbox"
	wait_for_text "No fork, model call"
	assert_dialog_screen 100
	capture_frame "${artifact_prefix}-work-btw-mailbox-answer"

	tmux send-keys -t "$tmux_session" Escape
	wait_for_absence "BTW mailbox"
	assert_normal_screen 100
	stop_pi

	start_pi "${session_files[mailbox]}" 64 28
	type_main_draft
	submit_mailbox_question
	assert_normal_screen 64
	open_dialog
	wait_for_text "BTW mailbox"
	wait_for_text "No fork, model call"
	assert_dialog_screen 64
	capture_frame "${artifact_prefix}-work-btw-mailbox-narrow"
	stop_pi
}

capture_claude_variant
capture_ephemeral_variant
capture_mailbox_variant
