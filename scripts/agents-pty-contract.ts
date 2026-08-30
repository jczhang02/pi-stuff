import { stripTerminalControls } from "./terminal-controls.js";
export const AGENTS_EXPECT_PROGRAM = `
set timeout 120

proc must_expect {pattern} {
    expect {
        -exact $pattern {}
        timeout {
            puts stderr "Timed out waiting for: $pattern"
            exit 2
        }
        eof {
            puts stderr "Reached EOF while waiting for: $pattern"
            exit 3
        }
    }
}

proc discard_pending_output {} {
    set discarded ""
    expect -timeout 0 {
        -re {.+} {
            append discarded $expect_out(0,string)
            exp_continue
        }
        timeout {}
        eof {
            puts stderr "Reached EOF while discarding pending output"
            exit 3
        }
    }
    return $discarded
}

proc wait_for_quiet {} {
    set deadline [expr {[clock milliseconds] + 5000}]
    set quiet_since [clock milliseconds]
    set output ""
    while {[clock milliseconds] < $deadline} {
        set pending [discard_pending_output]
        append output $pending
        set now [clock milliseconds]
        if {$pending ne ""} {
            set quiet_since $now
        } elseif {$now - $quiet_since >= 100} {
            return $output
        }
        after 10
    }
    puts stderr "Timed out waiting for terminal output to settle"
    exit 2
}

proc send_and_expect {keys pattern} {
    discard_pending_output
    send -- $keys
    must_expect $pattern
    wait_for_quiet
}

proc show_agent_tool_result {} {
    discard_pending_output
    send -- "t"
    for {set index 0} {$index < 4} {incr index} {
        expect {
            -exact "AGENT_TOOL_RESULT" {
                wait_for_quiet
                return
            }
            -exact "later lines" {
                set pending [wait_for_quiet]
                if {[string first "AGENT_TOOL_RESULT" $pending] >= 0} {
                    return
                }
            }
            timeout {
                puts stderr "Timed out waiting for expanded Agent Tool result"
                exit 2
            }
            eof {
                puts stderr "Reached EOF while waiting for expanded Agent Tool result"
                exit 3
            }
        }
        discard_pending_output
        send -- " "
    }
    puts stderr "Expanded Agent Tool result remained outside the bounded viewport"
    exit 2
}

set conversation_marker "launch one background general-purpose Agent"
spawn -noecho script -qefc $env(PI_STUFF_AGENTS_PTY_RUNNER) /dev/null
must_expect "MAIN_NOT_BLOCKED"
send -- "\\033\\[B"
must_expect $env(PI_STUFF_AGENTS_PTY_MAIN_HELP)
send -- "\\033"
must_expect "inspect with /agents"
send -- "/agents\\r"
must_expect "↑/↓ select · Enter details"
send -- "\\r"
must_expect "Agents / general-purpose"
must_expect "Activity"
must_expect "t tool details"
wait_for_quiet
send_and_expect " " "CHILD_MARKDOWN_RENDERED"
show_agent_tool_result
send_and_expect "\\033" "↑/↓ select · Enter details"
send_and_expect "\\033" $conversation_marker
send -- "\\004"
expect {
    eof {}
    timeout {
        puts stderr "Timed out waiting for Pi to exit"
        exit 4
    }
}

set env(PI_STUFF_AGENTS_PTY_RESUME) 1
spawn -noecho script -qefc $env(PI_STUFF_AGENTS_PTY_RUNNER) /dev/null
must_expect "inspect with /agents"
send -- "/agents\\r"
must_expect "↑/↓ select · Enter details"
send -- "\\r"
must_expect "Agents / general-purpose"
must_expect "Activity"
must_expect "t tool details"
wait_for_quiet
send_and_expect " " "CHILD_MARKDOWN_RENDERED"
show_agent_tool_result
send_and_expect "\\033" "↑/↓ select · Enter details"
send_and_expect "\\033" $conversation_marker
send -- "\\004"
expect {
    eof {}
    timeout {
        puts stderr "Timed out waiting for resumed Pi to exit"
        exit 5
    }
}
`;

export function fail(message: string): never {
	throw new Error(`Agents PTY verification failed: ${message}`);
}

export type FleetviewSelection = "idle" | "live" | "main" | "terminal";

export function fleetviewHelp(columns: number, selection: Exclude<FleetviewSelection, "idle">): string {
	const action = selection === "main" ? "" : ` · x ${selection === "terminal" ? "dismiss" : "stop"}`;
	return columns <= 64 ? `↑/↓ · Enter${action} · Esc` : `↑/↓ select · Enter view${action} · Esc return`;
}

export function verifyTerminalOutput(output: string, columns: number): void {
	const visible = stripTerminalControls(output);
	for (const required of [
		"MAIN_NOT_BLOCKED",
		fleetviewHelp(columns, "main"),
		"复核工具结果 🧪",
		"AGENT_PTY_TASK",
		"中文长任务",
		"Agents / general-purpose",
		"Agent finished",
		"inspect with /agents",
		"CHILD_FINAL_SUMMARY",
		"AGENT_TOOL_RESULT",
	]) {
		if (!visible.includes(required)) fail(`terminal output is missing ${required}\n${visible.slice(-8_000)}`);
	}
	const compact = visible.replace(/\s+/gu, " ");
	if (!/• Agent launch\b.*?· launched/u.test(compact)) {
		fail(`terminal output is missing the standalone Agent launch row\n${visible.slice(-8_000)}`);
	}
	if (compact.includes("Launched 1 background agent")) fail("Agent launch leaked into an aggregate summary");
	if (!visible.includes("━".repeat(columns))) fail(`Agent dialog did not render a ${columns}-column divider`);
	for (const forbidden of [
		"↓ to manage",
		"Fleet",
		"latest action",
		"statusline",
		"UNSOLICITED_MAIN_TURN",
		"MAIN_SAW_DIRECT_SUMMARY",
	]) {
		if (visible.includes(forbidden)) fail(`terminal output exposed forbidden UI: ${forbidden}`);
	}
	if (/● Agent[^\n]* · done(?:\s|$)/u.test(visible)) {
		fail("a live background Agent launch was presented as completed");
	}
	if (!/(?:^|[\r\n])[ \t]*• Agent finished ·/u.test(visible)) {
		fail(`the Conversation Transcript Agent outcome did not use the small bullet\n${visible.slice(-8_000)}`);
	}
	if (/(?:^|[\r\n])[ \t]*● Agent finished ·/u.test(visible)) {
		fail("the Conversation Transcript Agent outcome retained the large state dot");
	}
	if (
		/sample\.tx…[ \t]*(?:done|completed|queued|running|waiting|permission|failed|crashed|stopped|cancelled|\d+[smh])/i.test(
			visible,
		)
	) {
		fail("narrow Agent rows joined an ellipsis fragment to the terminal state");
	}
	if (/↓\s+\d+(?:\.\d+)?[kKmM]?\s+tokens?/.test(visible)) {
		fail("terminal output exposed the removed Agent token statusline");
	}
}
