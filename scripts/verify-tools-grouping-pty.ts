import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const providerExtension = join(root, "test/fixtures/tools-grouping-pty-provider.ts");
const runner = join(root, "test/fixtures/tools-grouping-pty-runner.sh");
const CERTIFIED_PI_VERSION = "0.83.0";

function fail(message: string): never {
	throw new Error(`Tool grouping PTY verification failed: ${message}`);
}

function command(
	args: readonly string[],
	options: { readonly env?: Record<string, string>; readonly cwd?: string } = {},
) {
	const result = Bun.spawnSync([...args], {
		...(options.cwd ? { cwd: options.cwd } : {}),
		...(options.env ? { env: { ...process.env, ...options.env } } : {}),
		stdout: "pipe",
		stderr: "pipe",
	});
	if (result.exitCode !== 0) {
		fail(`${args.join(" ")} exited ${String(result.exitCode)}: ${result.stderr.toString().trim()}`);
	}
	return result.stdout.toString();
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function capture(session: string): string {
	return command(["tmux", "capture-pane", "-p", "-t", session]);
}

async function waitForText(session: string, expected: string, timeoutMs = 20_000): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	let frame = "";
	while (Date.now() < deadline) {
		frame = capture(session);
		if (frame.includes(expected)) return frame;
		await Bun.sleep(50);
	}
	fail(`timed out waiting for ${expected}\nCurrent frame:\n${frame}`);
}

function send(session: string, text: string): void {
	command(["tmux", "send-keys", "-t", session, "-l", "--", text]);
	command(["tmux", "send-keys", "-t", session, "Enter"]);
}

async function detachForegroundBash(session: string): Promise<void> {
	// The lifecycle row can paint just before Pi installs the running-tool key
	// handler. Retry the raw Ctrl+B only until the row reports detached; unlike
	// tmux's symbolic C-b form, -H bypasses the client's prefix binding.
	await Bun.sleep(250);
	for (let attempt = 0; attempt < 4; attempt += 1) {
		command(["tmux", "send-keys", "-t", session, "-H", "02"]);
		await Bun.sleep(250);
		if (capture(session).includes("● Bash sleep 30 · background")) return;
	}
	fail(`Ctrl+B did not detach foreground Bash\nCurrent frame:\n${capture(session)}`);
}

async function sendTurn(session: string, text: string): Promise<void> {
	send(session, text);
	// The completion marker is painted just before Pi returns focus to the
	// editor. A second harmless Enter makes the fixture deterministic when the
	// first lands in that narrow handoff window.
	await Bun.sleep(150);
	command(["tmux", "send-keys", "-t", session, "Enter"]);
}

function requireGroup(frame: string): void {
	if (!frame.includes("● Explore 4 operations · Read, Find +2 more")) {
		fail(`settled exploration batch did not render one bounded summary\n${frame}`);
	}
}

function successGroup(frame: string): void {
	requireGroup(frame);
	for (const forbidden of ["● Read input-工具.txt", "● Find *.txt", "● List .", "● Bash pwd"]) {
		if (frame.includes(forbidden)) fail(`grouped frame retained individual row ${forbidden}\n${frame}`);
	}
}

function backgroundBarrier(frame: string): void {
	if (!frame.includes("● Bash sleep 30 · background")) fail(`detached Bash result was not visible\n${frame}`);
	if (!frame.includes("● Bash sleep 31 · background"))
		fail(`explicit background Bash result was not visible\n${frame}`);
	if ((frame.match(/● Read input-工具\.txt/g) ?? []).length < 3) {
		fail(`calls adjacent to background Bash were collapsed\n${frame}`);
	}
}

export async function verifyToolsGroupingPty(options: {
	readonly columns: number;
	readonly packagePath: string;
	readonly piBinary: string;
	readonly rows: number;
	readonly scenario?: "basic" | "compaction" | "lifecycle" | "resume" | "tree";
}): Promise<void> {
	const scenario = options.scenario ?? "basic";
	const version = command([options.piBinary, "--version"]).trim();
	if (version !== CERTIFIED_PI_VERSION) fail(`expected Pi ${CERTIFIED_PI_VERSION}, received ${version}`);
	command(["tmux", "-V"]);
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-tools-grouping-"));
	const configDirectory = join(temporaryDirectory, "config");
	const sessionDirectory = join(temporaryDirectory, "sessions");
	const tmuxSession = `pi-stuff-tools-grouping-${String(process.pid)}-${String(Date.now())}`;
	await Promise.all([mkdir(configDirectory), mkdir(sessionDirectory)]);
	await Promise.all([
		writeFile(
			join(configDirectory, "settings.json"),
			`${JSON.stringify({ branchSummary: { skipPrompt: true }, defaultProjectTrust: "always", outputPad: 1, quietStartup: true }, null, "\t")}\n`,
			{ mode: 0o600 },
		),
		writeFile(join(configDirectory, "keybindings.json"), '{"app.session.tree":["ctrl+y"]}\n', { mode: 0o600 }),
		writeFile(join(temporaryDirectory, "input-工具.txt"), "alpha\nbeta\n", { mode: 0o600 }),
	]);
	const environment = {
		PI_CODING_AGENT_DIR: configDirectory,
		PI_STUFF_TOOLS_GROUPING_BIN: options.piBinary,
		PI_STUFF_TOOLS_GROUPING_COLUMNS: String(options.columns),
		PI_STUFF_TOOLS_GROUPING_PACKAGE: resolve(options.packagePath),
		PI_STUFF_TOOLS_GROUPING_PROVIDER_EXTENSION: providerExtension,
		PI_STUFF_TOOLS_GROUPING_PROMPT: scenario === "compaction" ? "padding" : "success",
		PI_STUFF_TOOLS_GROUPING_ROWS: String(options.rows),
		PI_STUFF_TOOLS_GROUPING_SESSIONS: sessionDirectory,
		PI_STUFF_TOOLS_GROUPING_SESSION_ID: `tools-grouping-${String(options.columns)}x${String(options.rows)}`,
		TERM: "xterm-256color",
	};
	const launch = (extraEnvironment: Readonly<Record<string, string>> = {}) =>
		[
			"env",
			...Object.entries({ ...environment, ...extraEnvironment }).map(
				([name, value]) => `${name}=${shellQuote(value)}`,
			),
			shellQuote(runner),
		].join(" ");

	try {
		command([
			"tmux",
			"new-session",
			"-d",
			"-s",
			tmuxSession,
			"-x",
			String(options.columns),
			"-y",
			String(options.rows),
			"-c",
			temporaryDirectory,
			launch(),
		]);
		const geometry = command([
			"tmux",
			"display-message",
			"-p",
			"-t",
			tmuxSession,
			"#{pane_width}x#{pane_height}",
		]).trim();
		if (geometry !== `${String(options.columns)}x${String(options.rows)}`) fail(`unexpected geometry ${geometry}`);
		if (scenario === "compaction") await waitForText(tmuxSession, "PADDING_DONE");
		else successGroup(await waitForText(tmuxSession, "GROUP_SUCCESS_DONE"));

		if (scenario === "lifecycle") {
			send(tmuxSession, "/tools");
			const tools = await waitForText(tmuxSession, "current-session operations");
			for (const required of ["Tools", "Bash", "Find", "List", "Read", "input-工具.txt", "Esc close"]) {
				if (!tools.includes(required)) fail(`/tools lost grouped member ${required}\n${tools}`);
			}
			command(["tmux", "send-keys", "-t", tmuxSession, "Escape"]);
			await Bun.sleep(100);

			send(tmuxSession, "/reload");
			await waitForText(tmuxSession, "Reloaded keybindings, extensions");
			successGroup(capture(tmuxSession));

			await sendTurn(tmuxSession, "failure");
			const failure = await waitForText(tmuxSession, "GROUP_FAILURE_DONE");
			if (!failure.includes("● State error · FIXTURE_GROUP_ERROR")) fail(`error was hidden by grouping\n${failure}`);
			if ((failure.match(/● Read input-工具\.txt/g) ?? []).length !== 2) {
				fail(`calls adjacent to an error did not ungroup\n${failure}`);
			}

			await sendTurn(tmuxSession, "mutation");
			const mutation = await waitForText(tmuxSession, "GROUP_MUTATION_DONE");
			for (const required of [
				"● Read input-工具.txt",
				"● Bash printf mutation > bash-mutation-工具.txt",
				"GROUP_MUTATION_DONE",
			]) {
				if (!mutation.includes(required)) fail(`consequential batch hid ${required}\n${mutation}`);
			}
			if ((await readFile(join(temporaryDirectory, "bash-mutation-工具.txt"), "utf8")) !== "mutation") {
				fail("consequential Bash did not preserve its filesystem effect");
			}
		} else if (scenario === "compaction") {
			await Bun.sleep(250);
			await sendTurn(tmuxSession, "postcompact");
			await waitForText(tmuxSession, "GROUP_POST_COMPACT_DONE");
			requireGroup(capture(tmuxSession));
			await Bun.sleep(250);
			send(tmuxSession, "/compact");
			await waitForText(tmuxSession, "Compacted from");
			requireGroup(capture(tmuxSession));
		} else if (scenario === "tree") {
			await Bun.sleep(250);
			await sendTurn(tmuxSession, "plain");
			await waitForText(tmuxSession, "PLAIN_DONE");
			await Bun.sleep(250);
			command(["tmux", "send-keys", "-t", tmuxSession, "C-y"]);
			await waitForText(tmuxSession, "Session Tree");
			command(["tmux", "send-keys", "-t", tmuxSession, "C-t", "Up", "Up", "Enter"]);
			await waitForText(tmuxSession, "Navigated to selected point");
			command(["tmux", "copy-mode", "-u", "-t", tmuxSession]);
			const treeHistory = capture(tmuxSession);
			if (!treeHistory.includes("● Explore 4 operations · Read, Find +2 more")) {
				fail(`session_tree replay lost the exploration group\n${treeHistory}`);
			}
			command(["tmux", "send-keys", "-X", "-t", tmuxSession, "cancel"]);
		} else if (scenario === "resume") {
			send(tmuxSession, "background");
			await waitForText(tmuxSession, "● Bash sleep 30");
			await detachForegroundBash(tmuxSession);
			backgroundBarrier(await waitForText(tmuxSession, "GROUP_BACKGROUND_DONE"));
			command(["tmux", "kill-session", "-t", tmuxSession]);
			await Bun.sleep(250);
			command([
				"tmux",
				"new-session",
				"-d",
				"-s",
				tmuxSession,
				"-x",
				String(options.columns),
				"-y",
				String(options.rows),
				"-c",
				temporaryDirectory,
				launch({ PI_STUFF_TOOLS_GROUPING_RESUME: "1" }),
			]);
			const resumed = await waitForText(tmuxSession, "GROUP_BACKGROUND_DONE");
			requireGroup(resumed);
			backgroundBarrier(resumed);
		}

		const sessions = (await readdir(sessionDirectory)).filter((entry) => entry.endsWith(".jsonl"));
		if (sessions.length !== 1 || !sessions[0]) fail("expected exactly one isolated session");
		const transcript = await readFile(join(sessionDirectory, sessions[0]), "utf8");
		const toolResults = transcript
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as { readonly message?: { readonly role?: string } })
			.filter((entry) => entry.message?.role === "toolResult");
		const expectedResults =
			scenario === "lifecycle" ? 10 : scenario === "compaction" ? 5 : scenario === "resume" ? 9 : 4;
		if (toolResults.length !== expectedResults) {
			fail(
				`grouping changed model-visible results: expected ${String(expectedResults)}, found ${String(toolResults.length)}`,
			);
		}
		const requiredTranscriptText =
			scenario === "compaction"
				? ["input-工具.txt", "PADDING_DONE", "GROUP_POST_COMPACT_DONE"]
				: scenario === "resume"
					? ["input-工具.txt", "GROUP_SUCCESS_DONE", "GROUP_BACKGROUND_DONE"]
					: ["input-工具.txt", "GROUP_SUCCESS_DONE"];
		for (const required of requiredTranscriptText) {
			if (!transcript.includes(required)) fail(`persisted transcript lost ${required}`);
		}
		if (transcript.includes("Explore 4 operations")) {
			fail("display-only grouping leaked into persisted session data");
		}
		if (scenario === "compaction" && !transcript.includes('"type":"compaction"')) {
			fail("real session did not persist the exercised compaction boundary");
		}
	} finally {
		Bun.spawnSync(["tmux", "kill-session", "-t", tmuxSession], { stdout: "ignore", stderr: "ignore" });
		await rm(temporaryDirectory, { force: true, recursive: true });
	}
}

if (import.meta.main) {
	const { PI_BIN = "/opt/pi-coding-agent/pi" } = process.env;
	const packagePath = join(root, "packages/pi-stuff");
	await verifyToolsGroupingPty({ columns: 100, rows: 32, packagePath, piBinary: PI_BIN, scenario: "lifecycle" });
	await verifyToolsGroupingPty({ columns: 100, rows: 32, packagePath, piBinary: PI_BIN, scenario: "compaction" });
	await verifyToolsGroupingPty({ columns: 100, rows: 32, packagePath, piBinary: PI_BIN, scenario: "resume" });
	await verifyToolsGroupingPty({ columns: 100, rows: 32, packagePath, piBinary: PI_BIN, scenario: "tree" });
	await verifyToolsGroupingPty({ columns: 64, rows: 28, packagePath, piBinary: PI_BIN });
	console.log("Certified semantic Tool grouping in 100x32 and 64x28 PTYs");
}
