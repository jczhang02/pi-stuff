#!/usr/bin/env bash

# PROTOTYPE — capture current and proposed BTW surfaces in certified Pi PTYs.

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
pi_bin="$repo_root/node_modules/.bin/pi"
certified_pi_version=$(bun "$repo_root/scripts/pi-host-contract.ts")
artifact_prefix="pi-$certified_pi_version"
provider="$repo_root/docs/prototypes/tui/work-btw-phase1-provider.ts"
prototype="$repo_root/docs/prototypes/tui/work-btw-phase1.ts"
artifact_dir="$repo_root/docs/prototypes/tui/artifacts"
freeze_bin=${FREEZE_BIN:-freeze}
capture_root=$(mktemp -d)
tmux_session=""

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
	echo "BTW Phase 1 capture requires Pi $certified_pi_version" >&2
	exit 1
fi
if [[ $(bun --version) != "1.4.0" ]]; then
	echo "BTW Phase 1 capture requires Bun 1.4.0" >&2
	exit 1
fi

mkdir -p "$artifact_dir"

wait_for_text() {
	local expected=$1
	local attempts=0
	while ((attempts < 300)); do
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
	while ((attempts < 100)); do
		if ! tmux capture-pane -p -t "$tmux_session" | rg -F --quiet -- "$rejected"; then
			return 0
		fi
		((attempts += 1))
		sleep 0.1
	done
	echo "Timed out waiting for text to disappear: $rejected" >&2
	return 1
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

start_pi() {
	local variant=$1
	local width=$2
	local height=$3
	local case_root="$capture_root/$variant-${width}x${height}"
	local agent_dir="$case_root/agent"
	local sessions_dir="$case_root/sessions"
	local extension
	local command

	mkdir -p "$agent_dir" "$sessions_dir"
	printf '%s\n' '{"theme":"dark","quietStartup":true,"enableInstallTelemetry":false,"outputPad":1}' \
		> "$agent_dir/settings.json"
	if [[ $variant == "current" ]]; then
		extension="$repo_root/packages/pi-stuff"
	else
		extension="$prototype"
	fi

	printf -v command \
		'env PI_CODING_AGENT_DIR=%q PI_OFFLINE=1 PI_TELEMETRY=0 %q --offline --approve --no-extensions --no-skills --no-context-files --no-prompt-templates --extension %q --extension %q --provider pi-stuff-btw-phase1 --model fixture --session-dir %q --session-id %q %q' \
		"$agent_dir" \
		"$pi_bin" \
		"$extension" \
		"$provider" \
		"$sessions_dir" \
		"phase1-$variant-${width}x${height}" \
		'MAIN_PHASE1 Continue the main task while I inspect the focused surface.'

	tmux_session="pi-stuff-btw-phase1-$variant-${width}x${height}-$$"
	tmux new-session -d -s "$tmux_session" -x "$width" -y "$height" -c "$repo_root" "$command"
	local geometry
	geometry=$(tmux display-message -p -t "$tmux_session" '#{pane_width}x#{pane_height}')
	if [[ $geometry != "${width}x${height}" ]]; then
		echo "Unexpected tmux geometry: $geometry" >&2
		exit 1
	fi
	wait_for_text "MAIN_PHASE1_DONE"
}

stop_pi() {
	if [[ -n $tmux_session ]] && tmux has-session -t "$tmux_session" 2>/dev/null; then
		tmux kill-session -t "$tmux_session"
	fi
	tmux_session=""
}

run_current() {
	local width=$1
	local height=$2
	local suffix="${width}x${height}"
	start_pi current "$width" "$height"

	tmux send-keys -t "$tmux_session" -l "/btw Why should this remain outside the main transcript?"
	tmux send-keys -t "$tmux_session" Enter
	wait_for_text "Answering…"
	wait_for_text "Question"
	capture_frame "${artifact_prefix}-btw-phase1-current-answering-$suffix"
	wait_for_text "The side answer stays outside the main transcript."
	capture_frame "${artifact_prefix}-btw-phase1-current-answered-$suffix"

	tmux send-keys -t "$tmux_session" Escape
	wait_for_absence "The side answer stays outside the main transcript."
	tmux send-keys -t "$tmux_session" -l "/btw What did the first answer emphasize in a second sentence?"
	tmux send-keys -t "$tmux_session" Enter
	wait_for_text "The first answer emphasized transcript isolation"
	wait_for_text "←/→ history"
	capture_frame "${artifact_prefix}-btw-phase1-current-history-$suffix"

	stop_pi
}

run_proposed() {
	local width=$1
	local height=$2
	local suffix="${width}x${height}"
	start_pi proposed "$width" "$height"

	tmux send-keys -t "$tmux_session" -l "/prototype-btw-phase1"
	tmux send-keys -t "$tmux_session" Enter
	wait_for_text "Answering…"
	wait_for_text "/btw Why should this remain outside the main transcript?"
	capture_frame "${artifact_prefix}-btw-phase1-proposed-answering-$suffix"
	wait_for_text "Markdown stays compact and uses the active Pi theme."
	capture_frame "${artifact_prefix}-btw-phase1-proposed-answered-$suffix"

	tmux send-keys -t "$tmux_session" Escape
	wait_for_absence "Markdown stays compact and uses the active Pi theme."
	tmux send-keys -t "$tmux_session" -l "/prototype-btw-phase1 history"
	tmux send-keys -t "$tmux_session" Enter
	wait_for_text "Which context does BTW receive?"
	wait_for_text "←/→ history"
	capture_frame "${artifact_prefix}-btw-phase1-proposed-history-$suffix"

	# Interaction smoke: selection, copy, promotion feedback, clear, and the
	# Claude-observed Space/Enter/Esc dismissal paths all remain focus-local.
	tmux send-keys -t "$tmux_session" Left
	wait_for_text "No. Routine BTW questions, answers, and history remain"
	tmux send-keys -t "$tmux_session" c
	wait_for_text "Copied answer"
	tmux send-keys -t "$tmux_session" f
	wait_for_text "Will open a new session after the main Agent becomes idle"
	tmux send-keys -t "$tmux_session" x
	wait_for_text "Cleared earlier history"
	tmux send-keys -t "$tmux_session" Space
	wait_for_absence "Cleared earlier history"

	for close_key in Enter Escape; do
		tmux send-keys -t "$tmux_session" -l "/prototype-btw-phase1 answered"
		tmux send-keys -t "$tmux_session" Enter
		wait_for_text "Markdown stays compact and uses the active Pi theme."
		tmux send-keys -t "$tmux_session" "$close_key"
		wait_for_absence "Markdown stays compact and uses the active Pi theme."
	done

	stop_pi
}

for geometry in "100 32" "64 28"; do
	read -r width height <<< "$geometry"
	run_current "$width" "$height"
	run_proposed "$width" "$height"
done

for variant in current proposed; do
	for state in answering answered history; do
		for geometry in 100x32 64x28; do
			artifact="$artifact_dir/${artifact_prefix}-btw-phase1-$variant-$state-$geometry.png"
			if [[ ! -s $artifact ]]; then
				echo "Missing capture: $artifact" >&2
				exit 1
			fi
		done
	done
done

echo "Captured current and proposed BTW Phase 1 states at 100x32 and 64x28"
