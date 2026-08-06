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
	options: {
		readonly env?: Record<string, string>;
		readonly cwd?: string;
	} = {},
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

function captureHistory(session: string): string {
	return command(["tmux", "capture-pane", "-p", "-S", "-", "-t", session]);
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
		if (capture(session).includes("Launched 2 background tasks")) return;
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

function normalized(frame: string): string {
	return frame.replace(/\s+/gu, " ");
}

function requireGroup(frame: string): void {
	const summary = "Updated 1 task, ran 1 command, searched 1 pattern, read 1 file, listed 1 directory";
	const compact = normalized(frame);
	if (!compact.includes(summary)) {
		fail(`settled cross-round-trip activity did not render one semantic summary\n${frame}`);
	}
	if (compact.split(summary).length - 1 !== 1) {
		fail(`settled activity rendered more than one summary row\n${frame}`);
	}
	if (!compact.includes("ctrl+o to expand")) fail(`activity summary omitted its disclosure hint\n${frame}`);
}

function successGroup(frame: string): void {
	requireGroup(frame);
	for (const required of [
		"THINKING_STEP_1",
		"THINKING_STEP_2",
		"THINKING_STEP_3",
		"THINKING_STEP_4",
		"THINKING_STEP_5",
	]) {
		if (!frame.includes(required)) fail(`visible Thinking was lost while grouping: ${required}\n${frame}`);
	}
	for (const forbidden of ["● Read input-工具.txt", "● Find *.txt", "● List .", "● Bash pwd"]) {
		if (frame.includes(forbidden)) fail(`compact frame retained individual row ${forbidden}\n${frame}`);
	}
}

function backgroundBarrier(frame: string): void {
	if (!normalized(frame).includes("Launched 2 background tasks, read 1 file")) {
		fail(`background calls were not folded into one semantic Activity Group\n${frame}`);
	}
	for (const forbidden of ["sleep 30", "sleep 31", "● Read input-工具.txt"]) {
		if (frame.includes(forbidden)) fail(`background Activity Group leaked raw member ${forbidden}\n${frame}`);
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
		writeFile(join(temporaryDirectory, "input-工具.txt"), "alpha\nbeta\n", {
			mode: 0o600,
		}),
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
			command(["tmux", "send-keys", "-t", tmuxSession, "C-o"]);
			await waitForText(tmuxSession, "Tool output: expanded");
			const expanded = captureHistory(tmuxSession);
			for (const required of ["input-工具.txt", "*.txt", "command:", "pwd", "Task create", "Result"]) {
				if (!expanded.includes(required)) fail(`Ctrl+O did not restore ${required}\n${expanded}`);
			}
			command(["tmux", "send-keys", "-t", tmuxSession, "C-o"]);
			await waitForText(tmuxSession, "Tool output: collapsed");
			successGroup(capture(tmuxSession));

			send(tmuxSession, "/tools");
			const tools = await waitForText(tmuxSession, "activity groups");
			for (const required of ["Tools", "Updated 1 task", "5 tools", "Esc close"]) {
				if (!tools.includes(required)) fail(`/tools lost grouped member ${required}\n${tools}`);
			}
			command(["tmux", "send-keys", "-t", tmuxSession, "Enter"]);
			const details = await waitForText(tmuxSession, "Tool activity details");
			for (const required of ["Read", "Find", "input-工具.txt"]) {
				if (!details.includes(required)) fail(`/tools group details lost member ${required}\n${details}`);
			}
			command(["tmux", "send-keys", "-t", tmuxSession, "PageDown"]);
			await Bun.sleep(100);
			const laterDetails = capture(tmuxSession);
			for (const required of ["Bash", "pwd", "Task create"]) {
				if (!laterDetails.includes(required)) fail(`/tools paged details lost member ${required}\n${laterDetails}`);
			}
			if (laterDetails.includes("1. Read")) fail(`/tools paged details did not advance lazily\n${laterDetails}`);
			command(["tmux", "send-keys", "-t", tmuxSession, "Escape"]);
			await Bun.sleep(100);
			command(["tmux", "send-keys", "-t", tmuxSession, "Escape"]);
			await Bun.sleep(100);

			send(tmuxSession, "/reload");
			await waitForText(tmuxSession, "Reloaded keybindings, extensions");
			successGroup(capture(tmuxSession));

			await sendTurn(tmuxSession, "failure");
			const failure = await waitForText(tmuxSession, "GROUP_FAILURE_DONE");
			if (!normalized(failure).includes("Ran 1 command, read 1 file · 1 failed")) {
				fail(`failure count was hidden by grouping\n${failure}`);
			}
			if (!failure.includes("Command exited with code 17")) fail(`first failure summary was hidden\n${failure}`);
			if (failure.includes("● Read input-工具.txt")) fail(`failure group leaked successful member rows\n${failure}`);

			await sendTurn(tmuxSession, "mutation");
			const mutation = await waitForText(tmuxSession, "GROUP_MUTATION_DONE");
			if (!normalized(mutation).includes("Ran 1 command, read 1 file")) {
				fail(`consequential tools were not summarized in the Activity Group\n${mutation}`);
			}
			if (mutation.includes("printf mutation >")) fail(`compact mode leaked a mutation command\n${mutation}`);
			if ((await readFile(join(temporaryDirectory, "bash-mutation-工具.txt"), "utf8")) !== "mutation") {
				fail("consequential Bash did not preserve its filesystem effect");
			}

			send(tmuxSession, "permission");
			await waitForText(tmuxSession, "Fixture permission");
			const permission = captureHistory(tmuxSession);
			if (!normalized(permission).includes("Running 1 command")) {
				fail(`permission UI hid the active Activity Group\n${permission}`);
			}
			if (!permission.includes("Waiting for permission")) {
				fail(`permission Activity Group omitted its bounded wait hint\n${permission}`);
			}
			command(["tmux", "send-keys", "-t", tmuxSession, "Enter"]);
			const permissionDone = await waitForText(tmuxSession, "GROUP_PERMISSION_DONE");
			if (!normalized(permissionDone).includes("Ran 1 command")) {
				fail(`permission Activity Group did not settle semantically\n${permissionDone}`);
			}
			if (permissionDone.includes("fixture_confirm")) {
				fail(`permission Activity Group leaked raw Tool chrome\n${permissionDone}`);
			}

			send(tmuxSession, "rejection");
			await waitForText(tmuxSession, "Fixture rejection");
			command(["tmux", "send-keys", "-t", tmuxSession, "Escape"]);
			const rejection = await waitForText(tmuxSession, "GROUP_REJECTION_DONE");
			if (!normalized(rejection).includes("Ran 1 command · 1 rejected")) {
				fail(`permission rejection was not disclosed by the folded Activity Group\n${rejection}`);
			}
			if (!rejection.includes("rejected")) fail(`permission rejection omitted its issue line\n${rejection}`);

			await sendTurn(tmuxSession, "cancellation");
			const cancellation = await waitForText(tmuxSession, "GROUP_CANCELLATION_DONE");
			if (!normalized(cancellation).includes("Ran 1 command · 1 cancelled")) {
				fail(`cancelled activity was not disclosed by the folded Activity Group\n${cancellation}`);
			}
			if (!cancellation.includes("cancelled")) fail(`cancelled activity omitted its issue line\n${cancellation}`);

			await sendTurn(tmuxSession, "media");
			const media = await waitForText(tmuxSession, "GROUP_MEDIA_DONE");
			if (!normalized(media).includes("Viewed 1 image")) {
				fail(`media Tool chrome did not fold into a semantic Activity Group\n${media}`);
			}
			if (!media.includes("[Image: [image/png] 1x1]")) {
				fail(`media body disappeared with folded Tool chrome\n${media}`);
			}
			if (media.includes("fixture_media") || media.includes("Visible image")) {
				fail(`media Activity Group leaked raw Tool chrome\n${media}`);
			}

			await sendTurn(tmuxSession, "agent");
			const agent = await waitForText(tmuxSession, "GROUP_AGENT_DONE");
			if (!normalized(agent).includes("Managed 1 agent")) {
				fail(`Agent activity did not fold into a semantic Activity Group\n${agent}`);
			}
			if (agent.includes("Subagent") || agent.includes("action: status")) {
				fail(`Agent Activity Group leaked raw Tool chrome\n${agent}`);
			}

			await sendTurn(tmuxSession, "completion");
			const completionLaunch = await waitForText(tmuxSession, "GROUP_COMPLETION_DONE");
			if (!normalized(completionLaunch).includes("Launched 1 background task")) {
				fail(`background launch did not settle in its originating Activity Group\n${completionLaunch}`);
			}
			const completion = await waitForText(tmuxSession, 'Background command "completion fixture" completed');
			if (!normalized(completion).includes("Launched 1 background task")) {
				fail(`background completion reopened or replaced its historical Activity Group\n${completion}`);
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
			command(["tmux", "resize-window", "-t", tmuxSession, "-x", String(options.columns), "-y", "60"]);
			await Bun.sleep(100);
			const treeHistory = capture(tmuxSession);
			if (
				!normalized(treeHistory).includes(
					"Updated 1 task, ran 1 command, searched 1 pattern, read 1 file, listed 1 directory",
				)
			) {
				fail(`session_tree replay lost the Tool Activity Group\n${treeHistory}`);
			}
		} else if (scenario === "resume") {
			send(tmuxSession, "background");
			await waitForText(tmuxSession, "running 1 command");
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
			await waitForText(tmuxSession, "GROUP_BACKGROUND_DONE");
			const resumed = captureHistory(tmuxSession);
			requireGroup(resumed);
			backgroundBarrier(resumed);
		}

		const sessions = (await readdir(sessionDirectory)).filter((entry) => entry.endsWith(".jsonl"));
		if (sessions.length !== 1 || !sessions[0]) fail("expected exactly one isolated session");
		const transcript = await readFile(join(sessionDirectory, sessions[0]), "utf8");
		const toolResults = transcript
			.trim()
			.split("\n")
			.map(
				(line) =>
					JSON.parse(line) as {
						readonly message?: { readonly role?: string };
					},
			)
			.filter((entry) => entry.message?.role === "toolResult");
		const expectedResults =
			scenario === "lifecycle" ? 17 : scenario === "compaction" ? 6 : scenario === "resume" ? 10 : 5;
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
		for (const displayOnly of ["ctrl+o to expand", "Updated 1 task, ran 1 command"]) {
			if (transcript.includes(displayOnly))
				fail(`display-only grouping leaked into persisted session data: ${displayOnly}`);
		}
		if (scenario === "compaction" && !transcript.includes('"type":"compaction"')) {
			fail("real session did not persist the exercised compaction boundary");
		}
	} finally {
		Bun.spawnSync(["tmux", "kill-session", "-t", tmuxSession], {
			stdout: "ignore",
			stderr: "ignore",
		});
		await rm(temporaryDirectory, { force: true, recursive: true });
	}
}

if (import.meta.main) {
	const { PI_BIN = "/opt/pi-coding-agent/pi" } = process.env;
	const packagePath = join(root, "packages/pi-stuff");
	await verifyToolsGroupingPty({
		columns: 100,
		rows: 32,
		packagePath,
		piBinary: PI_BIN,
		scenario: "lifecycle",
	});
	await verifyToolsGroupingPty({
		columns: 100,
		rows: 32,
		packagePath,
		piBinary: PI_BIN,
		scenario: "compaction",
	});
	await verifyToolsGroupingPty({
		columns: 100,
		rows: 32,
		packagePath,
		piBinary: PI_BIN,
		scenario: "resume",
	});
	await verifyToolsGroupingPty({
		columns: 100,
		rows: 32,
		packagePath,
		piBinary: PI_BIN,
		scenario: "tree",
	});
	await verifyToolsGroupingPty({
		columns: 64,
		rows: 28,
		packagePath,
		piBinary: PI_BIN,
	});
	console.log("Certified complete Tool Activity Grouping in 100x32 and 64x28 PTYs");
}
