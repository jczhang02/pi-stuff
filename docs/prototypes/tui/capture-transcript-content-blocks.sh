#!/usr/bin/env bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
pi_bin="$repo_root/node_modules/.bin/pi"
certified_pi_version=$(bun "$repo_root/scripts/pi-host-contract.ts")
artifact_prefix="pi-$certified_pi_version"
freeze_bin=${FREEZE_BIN:-freeze}
artifact_dir="$repo_root/docs/prototypes/tui/artifacts"
capture_root=$(mktemp -d)
tmux_session="pi-stuff-transcript-$$"

cleanup() {
	if tmux has-session -t "$tmux_session" 2>/dev/null; then
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
	echo "Transcript content capture requires Pi $certified_pi_version" >&2
	exit 1
fi

mkdir -p "$capture_root/agent" "$artifact_dir"
printf '%s\n' '{"theme":"dark","quietStartup":true,"enableInstallTelemetry":false,"outputPad":1}' \
	> "$capture_root/agent/settings.json"

success_session=$(bun "$repo_root/docs/prototypes/tui/transcript-content-fixture.ts" success "$capture_root/sessions")
error_session=$(bun "$repo_root/docs/prototypes/tui/transcript-content-fixture.ts" error "$capture_root/sessions")

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

start_pi() {
	local session_file=$1
	local command
	printf -v command \
		'env PI_CODING_AGENT_DIR=%q PI_OFFLINE=1 PI_TELEMETRY=0 %q --session %q --model fixture/transcript-fixture --no-extensions -e %q --no-skills --no-prompt-templates --no-context-files --tools prototype_inspect --no-themes --offline --approve' \
		"$capture_root/agent" \
		"$pi_bin" \
		"$session_file" \
		"$repo_root/docs/prototypes/tui/transcript-content-blocks.ts"

	tmux new-session -d -s "$tmux_session" -x 100 -y 32 -c "$repo_root" "$command"
	local geometry
	geometry=$(tmux display-message -p -t "$tmux_session" '#{pane_width}x#{pane_height}')
	if [[ $geometry != "100x32" ]]; then
		echo "Unexpected tmux geometry: $geometry" >&2
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

start_pi "$success_session"
wait_for_text "3 项兼容性约束已确认"
capture_frame "${artifact_prefix}-transcript-compact-success"

tmux send-keys -t "$tmux_session" C-o
wait_for_text "TypeScript    5.9.3"
capture_frame "${artifact_prefix}-transcript-expanded-detail"
tmux kill-session -t "$tmux_session"

start_pi "$error_session"
wait_for_text "检查路径后重试"
capture_frame "${artifact_prefix}-transcript-compact-error"
