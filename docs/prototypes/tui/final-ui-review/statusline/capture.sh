#!/usr/bin/env bash

# PROTOTYPE — capture the accepted Statusline layout in certified Pi PTYs.
# The harness is deterministic, offline, and isolated from the user's Pi settings.

set -euo pipefail

prototype_root=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$prototype_root/../../../../.." && pwd)
pi_bin=${PI_BIN:-/opt/bin/pi}
certified_pi_version=$(bun "$repo_root/scripts/pi-host-contract.ts")
artifact_prefix="pi-$certified_pi_version"
freeze_bin=${FREEZE_BIN:-/tmp/pi-proto-bin/freeze}
extension="$prototype_root/statusline-prototype.ts"
fixture="$prototype_root/statusline-fixture.ts"
artifact_dir="$prototype_root/artifacts"
capture_root=$(mktemp -d)
tmux_session=""
expected_path="~"/d/pi-stuff
expected_cost="\$0.42"

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
	echo "Statusline prototype requires Pi $certified_pi_version" >&2
	exit 1
fi
if [[ $(bun --version) != "1.4.0" ]]; then
	echo "Statusline prototype requires Bun 1.4.0" >&2
	exit 1
fi

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

wait_for_absence() {
	local rejected=$1
	local attempts=0
	while ((attempts < 200)); do
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
	local ansi_file="$artifact_dir/$name.ansi"
	local text_file="$artifact_dir/$name.txt"
	tmux capture-pane -p -e -N -t "$tmux_session" > "$ansi_file"
	tmux capture-pane -p -N -t "$tmux_session" > "$text_file"
	"$freeze_bin" \
		-c base \
		--margin 0 \
		--padding 8 \
		--border.radius 0 \
		--font.family "Iosevka Nerd Font Mono" \
		--font.size 15 \
		--line-height 1.15 \
		-o "$artifact_dir/$name.png" \
		"$ansi_file"
}

start_pi() {
	local width=$1
	local height=$2
	local label=$3
	local fixture_kind=$4
	local model=$5
	local case_root="$capture_root/$label"
	local agent_dir="$case_root/agent"
	local sessions_dir="$case_root/sessions"
	local session_file
	local command

	mkdir -p "$agent_dir" "$sessions_dir"
	printf '%s\n' '{"theme":"dark","quietStartup":true,"enableInstallTelemetry":false,"outputPad":1,"tuiMode":"fullscreen"}' \
		> "$agent_dir/settings.json"
	printf '%s\n' '{"tui.editor.cursorLeft":["left"]}' > "$agent_dir/keybindings.json"
	session_file=$(cd "$repo_root" && bun "$fixture" "$sessions_dir" "$fixture_kind")
	printf -v command \
		'env PI_CODING_AGENT_DIR=%q PI_OFFLINE=1 PI_TELEMETRY=0 %q --session %q --model %q --thinking medium --tui-mode fullscreen --no-extensions -e %q --no-skills --no-prompt-templates --no-context-files --no-tools --no-themes --offline --approve' \
		"$agent_dir" \
		"$pi_bin" \
		"$session_file" \
		"statusline-fixture/$model" \
		"$extension"

	tmux_session="pi-stuff-statusline-$label-$$"
	tmux new-session -d -s "$tmux_session" -x "$width" -y "$height" -c "$repo_root" "$command"
	local geometry
	geometry=$(tmux display-message -p -t "$tmux_session" '#{pane_width}x#{pane_height}')
	if [[ $geometry != "${width}x${height}" ]]; then
		echo "Unexpected tmux geometry: $geometry" >&2
		return 1
	fi
	wait_for_text "deterministic Statusline fixture"
	wait_for_text "sonnet-4.5"
}

stop_pi() {
	if [[ -n $tmux_session ]] && tmux has-session -t "$tmux_session" 2>/dev/null; then
		tmux kill-session -t "$tmux_session"
	fi
	tmux_session=""
}

assert_full_metered_statusline() {
	for expected in "sonnet-4.5" "med" "$expected_path" "+12 ~3 -1" "42%" "↻18k" "$expected_cost" "goal:UI" "mcp:2" "load:full"; do
		wait_for_text "$expected"
	done
}

start_pi 100 32 "metered-100x32" short "sonnet-4.5-metered"
assert_full_metered_statusline
capture_frame "${artifact_prefix}-statusline-metered-100x32"
stop_pi

start_pi 64 28 "metered-64x28" short "sonnet-4.5-metered"
wait_for_text "sonnet-4.5"
wait_for_text "$expected_path"
capture_frame "${artifact_prefix}-statusline-metered-64x28"
stop_pi

start_pi 100 32 "subscription-100x32" short "sonnet-4.5-subscription"
wait_for_text "sonnet-4.5"
wait_for_text "load:full"
reject_text "$expected_cost"
reject_text "(sub)"
capture_frame "${artifact_prefix}-statusline-subscription-100x32"
stop_pi

start_pi 100 32 "overflow-100x32" overflow "sonnet-4.5-metered"
assert_full_metered_statusline
wait_for_text "请按照已经确认的 Claude Code 风格完成状态栏"
wait_for_text "所有字段都应遵循 Pi 主题"
capture_frame "${artifact_prefix}-statusline-prompt-overflow-100x32"
stop_pi

start_pi 100 32 "temporary-surfaces" short "sonnet-4.5-metered"
assert_full_metered_statusline
tmux send-keys -t "$tmux_session" C-b
wait_for_text "Statusline hidden · temporary selector"
wait_for_absence "sonnet-4.5"
capture_frame "${artifact_prefix}-statusline-selector-hidden-100x32"
tmux send-keys -t "$tmux_session" Escape
assert_full_metered_statusline
capture_frame "${artifact_prefix}-statusline-selector-restored-100x32"

tmux send-keys -t "$tmux_session" -l "/proto"
wait_for_text "prototype-statusline-selector"
wait_for_absence "sonnet-4.5"
capture_frame "${artifact_prefix}-statusline-autocomplete-hidden-100x32"
tmux send-keys -t "$tmux_session" Escape
assert_full_metered_statusline
capture_frame "${artifact_prefix}-statusline-autocomplete-restored-100x32"
stop_pi

for artifact in \
	${artifact_prefix}-statusline-metered-100x32 \
	${artifact_prefix}-statusline-metered-64x28 \
	${artifact_prefix}-statusline-subscription-100x32 \
	${artifact_prefix}-statusline-prompt-overflow-100x32 \
	${artifact_prefix}-statusline-selector-hidden-100x32 \
	${artifact_prefix}-statusline-selector-restored-100x32 \
	${artifact_prefix}-statusline-autocomplete-hidden-100x32 \
	${artifact_prefix}-statusline-autocomplete-restored-100x32; do
	for extension in ansi txt png; do
		if [[ ! -s "$artifact_dir/$artifact.$extension" ]]; then
			echo "Missing capture: $artifact.$extension" >&2
			exit 1
		fi
	done
done

echo "Captured 8 genuine Pi $certified_pi_version Statusline frames under $artifact_dir"
