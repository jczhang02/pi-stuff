#!/usr/bin/env bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
freeze_bin=${FREEZE_BIN:-freeze}
artifact_dir="$repo_root/docs/prototypes/tui/artifacts"
capture_root=$(mktemp -d)
tmux_session="pi-stuff-work-todo-$$"

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
	echo "Work Todo capture requires Pi $certified_pi_version" >&2
	exit 1
fi
if [[ $(bun --version) != "1.3.14" ]]; then
	echo "Work Todo capture requires Bun 1.3.14" >&2
	exit 1
fi

mkdir -p "$capture_root/agent" "$capture_root/sessions" "$artifact_dir"
printf '%s\n' '{"theme":"dark","quietStartup":true,"enableInstallTelemetry":false,"outputPad":1}' \
	> "$capture_root/agent/settings.json"

fixture="$repo_root/docs/prototypes/tui/work-todo-comparison-fixture.ts"
extension="$repo_root/docs/prototypes/tui/work-todo-comparison.ts"

declare -A session_files
for variant in checklist strip ondemand; do
	for state in running blocked; do
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
		'env PI_CODING_AGENT_DIR=%q PI_OFFLINE=1 PI_TELEMETRY=0 %q --session %q --model fixture/work-todo-fixture --no-extensions -e %q --no-skills --no-prompt-templates --no-context-files --tools prototype_work_todo --no-themes --offline --approve' \
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

capture_variant_state() {
	local variant=$1
	local state=$2
	start_pi "${session_files["$variant-$state"]}"
	wait_for_text "Compared Todo UI references"
	wait_for_text "Check Todo and Agent spacing"
	if [[ $state == "blocked" ]]; then
		wait_for_text "waiting"
	else
		wait_for_text "Compare Todo UI structures"
	fi
	tmux send-keys -t "$tmux_session" -l "draft: record this in Beads"
	wait_for_text "draft: record this in Beads"
	reject_text "Extension issues"
	reject_text "shortcut conflict"
	capture_frame "${artifact_prefix}-work-todo-$variant-$state"
	stop_pi
}

for variant in checklist strip ondemand; do
	capture_variant_state "$variant" running
	capture_variant_state "$variant" blocked
done

# Compare all three candidates at the same narrow geometry; otherwise the
# compact candidates' truncation and discoverability costs stay invisible.
for variant in checklist strip ondemand; do
	start_pi "${session_files["$variant-running"]}" 64 28
	wait_for_text "Compared Todo UI references"
	wait_for_text "Check Todo and Agent spacing"
	tmux send-keys -t "$tmux_session" -l "draft: record this in Beads"
	wait_for_text "draft: record this in Beads"
	if [[ $variant == "checklist" ]]; then
		wait_for_text "+3 pending"
	fi
	reject_text "Extension issues"
	reject_text "shortcut conflict"
	capture_frame "${artifact_prefix}-work-todo-$variant-narrow"
	stop_pi
done
