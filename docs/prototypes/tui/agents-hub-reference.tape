Require node

Output "/tmp/pi-stuff-agents-hub-reference.gif"
Output "/tmp/pi-stuff-agents-hub-reference.ascii"

Set Shell "bash"
Set Width 1100
Set Height 720
Set Padding 0
Set FontFamily "Iosevka Nerd Font Mono"
Set FontSize 16
Set LineHeight 1.1
Set CursorBlink false
Set TypingSpeed 20ms
Set Theme "Builtin Dark"

Hide
Type `test -x ./node_modules/.bin/pi`
Enter
Type `test "$(./node_modules/.bin/pi --version)" = "0.83.0"`
Enter
Type `clear`
Enter
Show

Type `./node_modules/.bin/pi --no-session --no-extensions -e ./docs/prototypes/tui/agents-hub-reference.ts --no-skills --no-prompt-templates --no-context-files --no-tools --no-themes --offline --approve`
Enter
Wait+Screen /pi-stuff/

Type "/prototype-agents"
Enter
Wait+Screen /No subagents are currently running/
Screenshot "/tmp/pi-stuff-agents-running.png"

Right
Wait+Screen /Create new agent/
Screenshot "/tmp/pi-stuff-agents-library.png"

Down
Down
Enter
Wait+Screen /Run agent/
Screenshot "/tmp/pi-stuff-agent-menu.png"
Sleep 1s
