import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sendTerminalNotification } from "../../packages/pi-stuff/src/notification/transport.ts";

test("RPC stays valid JSON even when Pi reports that UI requests are available", () => {
	const writes: string[] = [];
	const result = sendTerminalNotification(
		{
			body: "pi-stuff · 10s",
			delivery: "osc9",
			hasUI: true,
			mode: "rpc",
			terminalBell: false,
			title: "Pi Stuff complete",
			tmuxNotification: true,
		},
		{ environment: {}, write: (bytes) => writes.push(bytes) },
	);

	expect(result).toBe("not-interactive");
	expect(writes).toEqual([]);
});

test("Kitty receives one bounded Base64-encoded notification write", () => {
	const writes: string[] = [];
	const result = sendTerminalNotification(
		{
			body: "repo 10s",
			delivery: "kitty",
			hasUI: true,
			mode: "tui",
			terminalBell: false,
			title: "Done",
			tmuxNotification: true,
		},
		{ environment: {}, write: (bytes) => writes.push(bytes) },
	);

	expect(result).toBe("sent");
	expect(writes).toEqual([
		"\x1b]99;i=pi-stuff:d=0:e=1;RG9uZQ==\x1b\\\x1b]99;i=pi-stuff:p=body:e=1;cmVwbyAxMHM=\x1b\\",
	]);
});

test("terminal controls and newlines cannot survive inside a Kitty payload", () => {
	const writes: string[] = [];
	sendTerminalNotification(
		{
			body: "\x1b\\\x07repo\nready",
			delivery: "kitty",
			hasUI: true,
			mode: "tui",
			terminalBell: false,
			title: "\x1b]9;bad\x07\nDone",
			tmuxNotification: true,
		},
		{ environment: {}, write: (bytes) => writes.push(bytes) },
	);

	expect(writes).toEqual([
		"\x1b]99;i=pi-stuff:d=0:e=1;RG9uZQ==\x1b\\\x1b]99;i=pi-stuff:p=body:e=1;cmVwbyByZWFkeQ==\x1b\\",
	]);
});

test("OSC 9 and an optional terminal bell are emitted together exactly once", () => {
	const writes: string[] = [];
	const result = sendTerminalNotification(
		{
			body: "repo 10s",
			delivery: "osc9",
			hasUI: true,
			mode: "tui",
			terminalBell: true,
			title: "Done",
			tmuxNotification: true,
		},
		{ environment: {}, write: (bytes) => writes.push(bytes) },
	);

	expect(result).toBe("sent");
	expect(writes).toEqual(["\x1b]9;Done: repo 10s\x1b\\\x07"]);
});

test("tmux receives a passthrough-wrapped OSC notification and one attention bell", () => {
	const writes: string[] = [];
	const result = sendTerminalNotification(
		{
			body: "repo 10s",
			delivery: "osc9",
			hasUI: true,
			mode: "tui",
			terminalBell: false,
			title: "Done",
			tmuxNotification: true,
		},
		{
			environment: { TMUX: "/tmp/tmux-1000/default,1,0" },
			write: (bytes) => writes.push(bytes),
		},
	);

	expect(result).toBe("sent");
	expect(writes).toEqual(["\x1bPtmux;\x1b\x1b]9;Done: repo 10s\x1b\x1b\\\x1b\\\x07"]);
});

test("tmux auto delivery preserves the system notification and adds one attention bell", () => {
	const writes: string[] = [];
	const result = sendTerminalNotification(
		{
			body: "repo 10s",
			delivery: "auto",
			hasUI: true,
			mode: "tui",
			terminalBell: false,
			title: "Done",
			tmuxNotification: true,
		},
		{
			environment: {
				GHOSTTY_RESOURCES_DIR: "/fixture/ghostty",
				TMUX: "/tmp/tmux-1000/default,1,0",
			},
			write: (bytes) => writes.push(bytes),
		},
	);

	expect(result).toBe("sent");
	expect(writes).toEqual(["\x1bPtmux;\x1b\x1b]777;notify;Done;repo 10s\x1b\x1b\\\x1b\\\x07"]);
});

test("tmux notification off preserves visual delivery without an attention bell", () => {
	const writes: string[] = [];
	expect(
		sendTerminalNotification(
			{
				body: "repo 10s",
				delivery: "osc777",
				hasUI: true,
				mode: "tui",
				terminalBell: true,
				title: "Done",
				tmuxNotification: false,
			},
			{
				environment: { TMUX: "/tmp/tmux-1000/default,1,0" },
				write: (bytes) => writes.push(bytes),
			},
		),
	).toBe("sent");
	expect(writes).toEqual(["\x1bPtmux;\x1b\x1b]777;notify;Done;repo 10s\x1b\x1b\\\x1b\\"]);
});

test("tmux auto delivery falls back to an attention bell when the visual protocol is unknown", () => {
	const writes: string[] = [];
	expect(
		sendTerminalNotification(
			{
				body: "repo 10s",
				delivery: "auto",
				hasUI: true,
				mode: "tui",
				terminalBell: false,
				title: "Done",
				tmuxNotification: true,
			},
			{
				environment: { TERM: "tmux-256color", TMUX: "/tmp/tmux-1000/default,1,0" },
				write: (bytes) => writes.push(bytes),
			},
		),
	).toBe("sent");
	expect(writes).toEqual(["\x07"]);
});

test("tmux notification off suppresses explicit bell delivery", () => {
	const writes: string[] = [];
	expect(
		sendTerminalNotification(
			{
				body: "repo 10s",
				delivery: "bell",
				hasUI: true,
				mode: "tui",
				terminalBell: true,
				title: "Done",
				tmuxNotification: false,
			},
			{
				environment: { TMUX: "/tmp/tmux-1000/default,1,0" },
				write: (bytes) => writes.push(bytes),
			},
		),
	).toBe("unsupported");
	expect(writes).toEqual([]);
});

test("explicit visual delivery marks an unattended tmux window", async () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-stuff-notification-tmux-"));
	const socket = join(directory, "tmux.sock");
	const tmux = (...args: string[]): string => {
		const result = Bun.spawnSync(["tmux", "-S", socket, ...args], { stderr: "pipe", stdout: "pipe" });
		if (result.exitCode !== 0) throw new Error(result.stderr.toString());
		return result.stdout.toString().trim();
	};
	try {
		tmux("-f", "/dev/null", "new-session", "-d", "-s", "repro", "-n", "target", "sleep 5");
		tmux("set-option", "-g", "bell-action", "any");
		tmux("set-window-option", "-g", "monitor-bell", "on");
		tmux("new-window", "-t", "repro", "-n", "current", "sleep 5");
		const paneTty = tmux("display-message", "-p", "-t", "repro:target", "#{pane_tty}");

		expect(
			sendTerminalNotification(
				{
					body: "repo 10s",
					delivery: "osc777",
					hasUI: true,
					mode: "tui",
					terminalBell: false,
					title: "Done",
					tmuxNotification: true,
				},
				{
					environment: { TMUX: `${socket},1,0` },
					write: (bytes) => writeFileSync(paneTty, bytes),
				},
			),
		).toBe("sent");
		await Bun.sleep(50);
		expect(tmux("display-message", "-p", "-t", "repro:target", "#{window_bell_flag}")).toBe("1");
	} finally {
		Bun.spawnSync(["tmux", "-S", socket, "kill-server"], { stderr: "ignore", stdout: "ignore" });
		rmSync(directory, { force: true, recursive: true });
	}
});

test("OSC 777 delimiters in labels cannot create extra protocol fields", () => {
	const writes: string[] = [];
	const result = sendTerminalNotification(
		{
			body: "repo;body",
			delivery: "osc777",
			hasUI: true,
			mode: "tui",
			terminalBell: false,
			title: "Done;evil",
			tmuxNotification: true,
		},
		{ environment: {}, write: (bytes) => writes.push(bytes) },
	);

	expect(result).toBe("sent");
	expect(writes).toEqual(["\x1b]777;notify;Done evil;repo body\x1b\\"]);
});

test("bell delivery never duplicates BEL when terminal bell is also enabled", () => {
	const writes: string[] = [];
	const result = sendTerminalNotification(
		{
			body: "repo 10s",
			delivery: "bell",
			hasUI: true,
			mode: "tui",
			terminalBell: true,
			title: "Done",
			tmuxNotification: true,
		},
		{ environment: {}, write: (bytes) => writes.push(bytes) },
	);

	expect(result).toBe("sent");
	expect(writes).toEqual(["\x07"]);
});

test("auto selects Kitty only when the terminal environment is recognized", () => {
	const writes: string[] = [];
	const result = sendTerminalNotification(
		{
			body: "repo 10s",
			delivery: "auto",
			hasUI: true,
			mode: "tui",
			terminalBell: false,
			title: "Done",
			tmuxNotification: true,
		},
		{
			environment: { KITTY_WINDOW_ID: "42" },
			write: (bytes) => writes.push(bytes),
		},
	);

	expect(result).toBe("sent");
	expect(writes[0]).toStartWith("\x1b]99;");
});

test("empty labels still produce a valid bounded notification", () => {
	const writes: string[] = [];
	const result = sendTerminalNotification(
		{
			body: "\n\x07",
			delivery: "osc9",
			hasUI: true,
			mode: "tui",
			terminalBell: false,
			title: "",
			tmuxNotification: true,
		},
		{ environment: {}, write: (bytes) => writes.push(bytes) },
	);

	expect(result).toBe("sent");
	expect(writes).toEqual(["\x1b]9;Pi Stuff\x1b\\"]);
});

test("auto selects OSC 777 for Ghostty and OSC 9 for the remaining recognized terminals", () => {
	const ghosttyWrites: string[] = [];
	expect(
		sendTerminalNotification(
			{
				body: "The task is ready.",
				delivery: "auto",
				hasUI: true,
				mode: "tui",
				terminalBell: false,
				title: "Pi · ps-9e7 — Ready",
				tmuxNotification: true,
			},
			{
				environment: { GHOSTTY_RESOURCES_DIR: "/fixture/ghostty", TERM_PROGRAM: "tmux" },
				write: (bytes) => ghosttyWrites.push(bytes),
			},
		),
	).toBe("sent");
	expect(ghosttyWrites).toEqual(["\x1b]777;notify;Pi · ps-9e7 — Ready;The task is ready.\x1b\\"]);

	for (const program of ["iTerm.app", "WezTerm"]) {
		const writes: string[] = [];
		expect(
			sendTerminalNotification(
				{
					body: "repo 10s",
					delivery: "auto",
					hasUI: true,
					mode: "tui",
					terminalBell: false,
					title: "Done",
					tmuxNotification: true,
				},
				{ environment: { TERM_PROGRAM: program }, write: (bytes) => writes.push(bytes) },
			),
		).toBe("sent");
		expect(writes).toEqual(["\x1b]9;Done: repo 10s\x1b\\"]);
	}
	const writes: string[] = [];
	expect(
		sendTerminalNotification(
			{
				body: "repo 10s",
				delivery: "auto",
				hasUI: true,
				mode: "tui",
				terminalBell: false,
				title: "Done",
				tmuxNotification: true,
			},
			{ environment: { TERM: "xterm-256color" }, write: (bytes) => writes.push(bytes) },
		),
	).toBe("unsupported");
	expect(writes).toEqual([]);
});

test("headless TUI, print, and JSON modes never write", () => {
	for (const [mode, hasUI] of [
		["tui", false],
		["print", false],
		["json", false],
	] as const) {
		const writes: string[] = [];
		expect(
			sendTerminalNotification(
				{
					body: "repo",
					delivery: "bell",
					hasUI,
					mode,
					terminalBell: false,
					title: "Done",
					tmuxNotification: true,
				},
				{ write: (bytes) => writes.push(bytes) },
			),
		).toBe("not-interactive");
		expect(writes).toEqual([]);
	}
});

test("long Unicode fields stay bounded and a write failure is non-fatal", () => {
	const writes: string[] = [];
	expect(
		sendTerminalNotification(
			{
				body: "体".repeat(300),
				delivery: "kitty",
				hasUI: true,
				mode: "tui",
				terminalBell: false,
				title: `完${"成".repeat(100)}\u009c`,
				tmuxNotification: true,
			},
			{ environment: {}, write: (bytes) => writes.push(bytes) },
		),
	).toBe("sent");
	const payloads = (writes[0] ?? "")
		.split("\x1b\\")
		.filter(Boolean)
		.map((frame) => Buffer.from(frame.slice(frame.lastIndexOf(";") + 1), "base64").toString("utf8"));
	expect(payloads.map((payload) => [...payload].length)).toEqual([32, 80]);

	expect(
		sendTerminalNotification(
			{
				body: "repo",
				delivery: "bell",
				hasUI: true,
				mode: "tui",
				terminalBell: false,
				title: "Done",
				tmuxNotification: true,
			},
			{
				write: () => {
					throw new Error("closed");
				},
			},
		),
	).toBe("failed");
});
