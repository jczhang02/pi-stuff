# Pi task-center prototype

Throwaway artifact for [issue #69](https://github.com/jczhang02/pi-stuff/issues/69).
It is not an adopted subagent UI. Two in-memory tasks exercise list selection,
details, return and draft preservation in the installed Pi host.

From this branch's repository root, run this single shell command:

```sh
(
  extension_path="$PWD/prototype/subagent-task-center.ts"
  trial_dir=$(mktemp -d)
  mkdir -p "$trial_dir/agent" "$trial_dir/workspace"
  cd "$trial_dir/workspace"
  PI_CODING_AGENT_DIR="$trial_dir/agent" /opt/bin/pi \
    --offline --no-session --no-tools --no-extensions --no-context-files \
    --no-skills --no-prompt-templates --use-theme light --tui-mode fullscreen \
    --provider openai-codex --model gpt-6-astra --thinking medium \
    --extension "$extension_path"
)
```

This is a reproduction of the inspected light/fullscreen configuration, not a
permanent environment baseline. Recheck the target before a new visual review.
Use the existing pinned dependencies; the accepted Pi host was 0.85.1; tooling used Bun 1.4.0.
No credentials are copied. The prototype does not execute tasks or submit prompts.

Type a draft, press **F12**, select with the host's selection keys, and press
Enter for details. Esc returns to the list; Esc again restores Pi's original
editor and draft. Do not submit the draft to a provider for this UI experiment.
Below 72 columns or 24 rows, the panel shows a size notice and keeps cancel
available. F12 was checked against the current Pi, Ghostty and GNOME bindings;
recheck bindings if the environment changes.

For the shared acceptance session on the development host:

```sh
bun run tui attach -s pi-fidelity-owner
```

For the isolated theme-refresh probe, set `PI_TASK_CENTER_THEME_PROBE=1` in the
launch environment. The panel asks Pi to switch its theme after opening. This
diagnostic is outside the displayed controls and changes only isolated settings.

## Evidence and limits

See [acceptance](acceptance.md) for the fresh-process experiment and owner fixes.
[Task detail](evidence/light-detail.png), [restored draft](evidence/draft-restored.png)
and [small-window notice](evidence/small-window.png) are actual Pi PTY renders.
They are not native Ghostty screenshots. The PNG renderer uses a bundled
JetBrains Mono font, with Ghostty colors and a stated size/scaling approximation;
compositor rasterization, fallback fonts and native window chrome remain unverified.
The isolated Pi host does not load the user's Zentui customization, so its editor
and footer are the stock Pi presentation. This is not full visual parity with that
customized setup.
