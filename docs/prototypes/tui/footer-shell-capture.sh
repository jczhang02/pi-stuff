#!/usr/bin/env bash

# ACCEPTANCE — capture the production compact footer and Command Dialog
# lifecycle in certified Pi PTYs. The fixture is deterministic and offline.
# Ctrl+B is a capture-only entry point that preserves a pre-existing draft.

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
pi_bin="$repo_root/node_modules/.bin/pi"
certified_pi_version=$(bun "$repo_root/scripts/pi-host-contract.ts")
artifact_prefix="pi-$certified_pi_version"
extension="$repo_root/docs/prototypes/tui/footer-shell-capture.ts"
fixture="$repo_root/docs/prototypes/tui/footer-shell-fixture.ts"
artifact_dir="$repo_root/docs/prototypes/tui/artifacts"
freeze_bin=${FREEZE_BIN:-freeze}
capture_root=$(mktemp -d)
tmux_session=""
cjk_draft="草稿：保留项目、上下文与分支信息"

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
if [[ $("$pi_bin" --version) != "$certified_pi_version" ]]; then
	echo "Footer shell capture requires Pi $certified_pi_version" >&2
	exit 1
fi
if [[ $(bun --version) != "1.3.14" ]]; then
	echo "Footer shell capture requires Bun 1.3.14" >&2
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

reject_text() {
	local rejected=$1
	if tmux capture-pane -p -t "$tmux_session" | rg -F --quiet -- "$rejected"; then
		echo "Unexpected text in Pi PTY: $rejected" >&2
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

assert_normal_surface() {
	wait_for_text "compact-footer-fixture"
	wait_for_text "$cjk_draft"
	local footer_count
	footer_count=$(tmux capture-pane -p -t "$tmux_session" | rg -c -- "compact-footer-fixture" || true)
	if [[ $footer_count != "1" ]]; then
		echo "Expected exactly one compact footer line, got $footer_count" >&2
		tmux capture-pane -p -t "$tmux_session" >&2
		return 1
	fi
	if ! tmux capture-pane -p -t "$tmux_session" | rg --quiet -- "pi-stuff \(main\).*compact-footer-fixture.*ctx"; then
		echo "Compact footer did not contain project, branch, model, and context on one line" >&2
		tmux capture-pane -p -t "$tmux_session" >&2
		return 1
	fi
	reject_text "Agent"
	reject_text "Todo"
	reject_text "Fleet"
	reject_text "health"
}

assert_dialog_surface() {
	wait_for_text "Footer lifecycle"
	wait_for_text "普通页脚已隐藏"
	wait_for_absence "compact-footer-fixture"
	reject_text "$cjk_draft"
	reject_text "╭"
	reject_text "╮"
	reject_text "╰"
	reject_text "╯"
}

start_pi() {
	local width=$1
	local height=$2
	local label=$3
	local case_root="$capture_root/$label"
	local agent_dir="$case_root/agent"
	local sessions_dir="$case_root/sessions"
	local session_file
	local command

	mkdir -p "$agent_dir" "$sessions_dir"
	printf '%s\n' '{"theme":"dark","quietStartup":true,"enableInstallTelemetry":false,"outputPad":1}' \
		> "$agent_dir/settings.json"
	printf '%s\n' '{"tui.editor.cursorLeft":["left"]}' > "$agent_dir/keybindings.json"
	session_file=$(cd "$repo_root" && bun "$fixture" "$sessions_dir")
	printf -v command \
		'env PI_CODING_AGENT_DIR=%q PI_OFFLINE=1 PI_TELEMETRY=0 %q --session %q --model footer-fixture/compact-footer-fixture --no-extensions -e %q --no-skills --no-prompt-templates --no-context-files --no-themes --offline --approve' \
		"$agent_dir" \
		"$pi_bin" \
		"$session_file" \
		"$extension"

	tmux_session="pi-stuff-footer-$label-$$"
	tmux new-session -d -s "$tmux_session" -x "$width" -y "$height" -c "$repo_root" "$command"
	local geometry
	geometry=$(tmux display-message -p -t "$tmux_session" '#{pane_width}x#{pane_height}')
	if [[ $geometry != "${width}x${height}" ]]; then
		echo "Unexpected tmux geometry: $geometry" >&2
		return 1
	fi
	wait_for_text "页脚验收"
	wait_for_text "compact-footer-fixture"
}

stop_pi() {
	if [[ -n $tmux_session ]] && tmux has-session -t "$tmux_session" 2>/dev/null; then
		tmux kill-session -t "$tmux_session"
	fi
	tmux_session=""
}

capture_fixed_geometry() {
	local width=$1
	local height=$2
	local suffix="${width}x${height}"
	start_pi "$width" "$height" "fixed-$suffix"
	tmux send-keys -t "$tmux_session" -l "$cjk_draft"
	assert_normal_surface
	capture_frame "${artifact_prefix}-footer-normal-$suffix"

	tmux send-keys -t "$tmux_session" C-b
	assert_dialog_surface
	capture_frame "${artifact_prefix}-footer-dialog-$suffix"

	tmux send-keys -t "$tmux_session" Escape
	assert_normal_surface
	capture_frame "${artifact_prefix}-footer-restored-$suffix"
	stop_pi
}

capture_resize_cycle() {
	start_pi 100 32 "resize-cycle"
	tmux send-keys -t "$tmux_session" -l "$cjk_draft"
	assert_normal_surface
	tmux send-keys -t "$tmux_session" C-b
	assert_dialog_surface

	tmux resize-window -t "$tmux_session" -x 64 -y 28
	wait_for_text "CJK width: 项目 / 上下文 / 分支"
	assert_dialog_surface
	capture_frame "${artifact_prefix}-footer-resize-dialog-64x28"

	tmux send-keys -t "$tmux_session" Escape
	assert_normal_surface
	capture_frame "${artifact_prefix}-footer-resize-restored-cjk-64x28"

	tmux resize-window -t "$tmux_session" -x 100 -y 32
	assert_normal_surface
	capture_frame "${artifact_prefix}-footer-resize-restored-cjk-100x32"
	stop_pi
}

capture_fixed_geometry 100 32
capture_fixed_geometry 64 28
capture_resize_cycle

for artifact in \
	${artifact_prefix}-footer-normal-100x32 \
	${artifact_prefix}-footer-dialog-100x32 \
	${artifact_prefix}-footer-restored-100x32 \
	${artifact_prefix}-footer-normal-64x28 \
	${artifact_prefix}-footer-dialog-64x28 \
	${artifact_prefix}-footer-restored-64x28 \
	${artifact_prefix}-footer-resize-dialog-64x28 \
	${artifact_prefix}-footer-resize-restored-cjk-64x28 \
	${artifact_prefix}-footer-resize-restored-cjk-100x32; do
	if [[ ! -s "$artifact_dir/$artifact.png" ]]; then
		echo "Missing capture: $artifact.png" >&2
		exit 1
	fi
done

echo "Captured 9 real Pi $certified_pi_version footer lifecycle frames."
