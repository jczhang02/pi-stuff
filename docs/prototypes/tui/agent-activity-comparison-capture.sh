#!/usr/bin/env bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
freeze_bin=${FREEZE_BIN:-freeze}
artifact_dir="$repo_root/docs/prototypes/tui/artifacts"
capture_root=$(mktemp -d)
tmux_session="pi-stuff-agent-activity-$$"

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
	echo "Agent activity capture requires Pi $certified_pi_version" >&2
	exit 1
fi
if [[ $(bun --version) != "1.3.14" ]]; then
	echo "Agent activity capture requires Bun 1.3.14" >&2
	exit 1
fi

mkdir -p "$capture_root/agent" "$capture_root/sessions" "$artifact_dir"
printf '%s\n' '{"theme":"dark","quietStartup":true,"enableInstallTelemetry":false,"outputPad":1}' \
	> "$capture_root/agent/settings.json"

fixture="$repo_root/docs/prototypes/tui/agent-activity-comparison-fixture.ts"
extension="$repo_root/docs/prototypes/tui/agent-activity-comparison.ts"

declare -A session_files
for variant in claude tintin hybrid; do
	for state in running completed; do
		session_files["$variant-$state"]=$(bun "$fixture" "$variant" "$state" "$capture_root/sessions")
	done
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
		'env PI_CODING_AGENT_DIR=%q PI_OFFLINE=1 PI_TELEMETRY=0 %q --session %q --model fixture/agent-activity-fixture --no-extensions -e %q --no-skills --no-prompt-templates --no-context-files --tools prototype_agent_activity --no-themes --offline --approve' \
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

capture_variant() {
	local variant=$1
	local state=$2
	local expected=$3
	local artifact_name="${artifact_prefix}-agent-activity-$variant-$state"
	start_pi "${session_files["$variant-$state"]}"
	wait_for_text "$expected"
	reject_text "Extension issues"
	reject_text "shortcut conflict"
	capture_frame "$artifact_name"
	stop_pi
}

capture_variant claude running "Running 3 agents"
capture_variant claude completed "3 agents finished"
capture_variant tintin running "1 queued"
capture_variant tintin completed "Claude Code activity UI completed"
capture_variant hybrid running "2 running · 1 queued"
capture_variant hybrid completed "3 research agents finished"

# Narrow-terminal smoke: the recommended synthesis must truncate cleanly while
# keeping the editor and Host footer usable.
start_pi "${session_files["hybrid-running"]}" 64 28
wait_for_text "2 running · 1 queued"
wait_for_text "+1 more"
reject_text "Extension issues"
reject_text "shortcut conflict"
stop_pi
