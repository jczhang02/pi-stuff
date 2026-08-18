import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CERTIFIED_PI_VERSION } from "./pi-host-contract.ts";

const root = resolve(import.meta.dir, "..");
const providerExtension = join(root, "test/fixtures/tools-grouping-pty-provider.ts");
const runner = join(root, "test/fixtures/tools-grouping-pty-runner.sh");

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

type TmuxCommand = (args: readonly string[]) => string;

function capture(tmux: TmuxCommand, session: string): string {
	return tmux(["capture-pane", "-p", "-t", session]);
}

function captureHistory(tmux: TmuxCommand, session: string): string {
	return tmux(["capture-pane", "-p", "-S", "-", "-t", session]);
}

function captureAnsiHistory(tmux: TmuxCommand, session: string): string {
	return tmux(["capture-pane", "-p", "-e", "-S", "-", "-t", session]);
}

function markerColor(frame: string, summary: string): string {
	const line = frame
		.split("\n")
		.reverse()
		.find((candidate) => Bun.stripANSI(candidate).includes(summary) && candidate.includes("•"));
	if (!line) fail(`could not find colored Activity marker for ${summary}\n${frame}`);
	const marker = line.indexOf("•");
	const colors = line.slice(0, marker).match(new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;:]*m`, "gu")) ?? [];
	const color = colors.reverse().find((code) => {
		const parameter = Number.parseInt(code.slice(2), 10);
		return parameter === 38 || (parameter >= 30 && parameter <= 37) || (parameter >= 90 && parameter <= 97);
	});
	if (!color) fail(`Activity marker for ${summary} had no terminal color\n${line}`);
	return color;
}

async function waitForText(tmux: TmuxCommand, session: string, expected: string, timeoutMs = 20_000): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	let frame = "";
	while (Date.now() < deadline) {
		frame = capture(tmux, session);
		if (frame.includes(expected)) return frame;
		await Bun.sleep(50);
	}
	fail(`timed out waiting for ${expected}\nCurrent frame:\n${frame}`);
}

function send(tmux: TmuxCommand, session: string, text: string): void {
	tmux(["send-keys", "-t", session, "-l", "--", text]);
	tmux(["send-keys", "-t", session, "Enter"]);
}

async function detachForegroundBash(tmux: TmuxCommand, session: string): Promise<void> {
	// The lifecycle row can paint just before Pi installs the running-tool key
	// handler. Retry the raw Ctrl+B only until the row reports detached; unlike
	// tmux's symbolic C-b form, -H bypasses the client's prefix binding.
	await Bun.sleep(250);
	for (let attempt = 0; attempt < 4; attempt += 1) {
		tmux(["send-keys", "-t", session, "-H", "02"]);
		await Bun.sleep(250);
		const frame = capture(tmux, session);
		if (frame.includes("Command manually moved to background task") || frame.includes("GROUP_BACKGROUND_DONE"))
			return;
	}
	fail(`Ctrl+B did not detach foreground Bash\nCurrent frame:\n${capture(tmux, session)}`);
}

async function sendTurn(tmux: TmuxCommand, session: string, text: string): Promise<void> {
	send(tmux, session, text);
	// The completion marker is painted just before Pi returns focus to the
	// editor. A second harmless Enter makes the fixture deterministic when the
	// first lands in that narrow handoff window.
	await Bun.sleep(150);
	tmux(["send-keys", "-t", session, "Enter"]);
}

function normalized(frame: string): string {
	return frame.replace(/\s+/gu, " ");
}

function requireGroup(frame: string): void {
	const summaries = ["Searched 1 pattern, read 1 file, listed 1 directory"];
	const compact = normalized(frame);
	for (const summary of summaries) {
		if (!compact.includes(summary)) fail(`settled non-Bash activity omitted ${summary}\n${frame}`);
		if (compact.split(summary).length - 1 !== 1) {
			fail(`settled non-Bash activity rendered ${summary} more than once\n${frame}`);
		}
	}
	if (!frame.includes("• Bash(pwd)") || !frame.includes("⎿ ")) fail(`standalone Bash operation was lost\n${frame}`);
	if (!compact.includes("• Task create")) {
		fail(`standalone Task operation was lost\n${frame}`);
	}
	if (compact.includes("ran 1 command") || compact.includes("Ran 1 command")) {
		fail(`Bash leaked back into an aggregate command count\n${frame}`);
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
	for (const forbidden of ["• Read input-工具.txt", "• Find *.txt", "• List .", "• Bash pwd"]) {
		if (frame.includes(forbidden)) fail(`compact frame retained individual row ${forbidden}\n${frame}`);
	}
}

function backgroundBarrier(frame: string): void {
	if (!normalized(frame).includes("Read 1 file")) {
		fail(`neighboring reads were not retained around standalone Bash operations\n${frame}`);
	}
	for (const required of ["Bash(sleep 30)", "Bash(sleep 31)"]) {
		if (!frame.includes(required)) fail(`background Bash operation omitted ${required}\n${frame}`);
	}
	for (const forbidden of ["Launched 2 background tasks", "• Read input-工具.txt"]) {
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
	const tmuxSocket = join(temporaryDirectory, "tmux.sock");
	const tmux: TmuxCommand = (args) => command(["tmux", "-S", tmuxSocket, ...args]);
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
		SHELL: "/bin/sh",
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
	let successfulMarkerColor = "";
	let warningMarkerColor = "";

	try {
		tmux(["-f", "/dev/null", "new-session", "-d", "-s", `${tmuxSession}-owner`]);
		tmux(["set-option", "-s", "extended-keys", "on"]);
		const serverOptions = tmux(["show-options", "-s"]);
		if (/^extended-keys-format\b/m.test(serverOptions)) {
			tmux(["set-option", "-s", "extended-keys-format", "csi-u"]);
		}
		tmux(["set-option", "-g", "remain-on-exit", "on"]);
		tmux([
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
		const geometry = tmux(["display-message", "-p", "-t", tmuxSession, "#{pane_width}x#{pane_height}"]).trim();
		if (geometry !== `${String(options.columns)}x${String(options.rows)}`) fail(`unexpected geometry ${geometry}`);
		if (scenario === "compaction") await waitForText(tmux, tmuxSession, "PADDING_DONE");
		else {
			successGroup(await waitForText(tmux, tmuxSession, "GROUP_SUCCESS_DONE"));
			if (scenario === "lifecycle") {
				successfulMarkerColor = markerColor(
					captureAnsiHistory(tmux, tmuxSession),
					"Searched 1 pattern, read 1 file, listed 1 directory",
				);
			}
		}

		if (scenario === "lifecycle") {
			const partialStarted = performance.now();
			await sendTurn(tmux, tmuxSession, "partial-bash");
			await waitForText(tmux, tmuxSession, "PARTIAL_BASH_VISIBLE", 6_000);
			await waitForText(tmux, tmuxSession, "GROUP_PARTIAL_BASH_DONE", 6_000);
			if (performance.now() - partialStarted > 6_000) fail("foreground Bash partial update stalled the TUI");
			await sendTurn(tmux, tmuxSession, "plain");
			await waitForText(tmux, tmuxSession, "PLAIN_DONE", 2_000);

			await sendTurn(tmux, tmuxSession, "structured");
			const structured = await waitForText(tmux, tmuxSession, "STRUCTURED_CODE_LINE");
			const structuredLines = structured.split("\n");
			const headingLine = structuredLines.find((line) => line.includes("Structured result"));
			if (!headingLine || !/^\s*•\s/u.test(headingLine)) {
				fail(`structured Assistant message omitted its outer transcript bullet\n${structured}`);
			}
			for (const required of [
				"STRUCTURED_PARAGRAPH 中文",
				"STRUCTURED_ITEM_ONE",
				"STRUCTURED_ITEM_TWO",
				"STRUCTURED_CODE_LINE",
			]) {
				if (!structured.includes(required)) fail(`structured Assistant Markdown lost ${required}\n${structured}`);
			}
			if (structuredLines.filter((line) => /^ •\s/u.test(line) && line.includes("Structured result")).length !== 1) {
				fail(`structured Assistant message rendered more than one outer transcript bullet\n${structured}`);
			}

			await sendTurn(tmux, tmuxSession, "bashui");
			const bashUi = await waitForText(tmux, tmuxSession, "GROUP_BASH_UI_DONE");
			const bashUiText = normalized(bashUi);
			for (const required of [
				"Bash(printf 'BASH_UI_ONE\\nBASH_UI_TWO",
				"⎿ BASH_UI_ONE",
				"BASH_UI_THREE",
				"… +3 lines (ctrl+o to expand)",
				"Bash(printf BASH_UI_SECOND && printf '_DONE\\n')",
				"⎿ BASH_UI_SECOND_DONE",
			]) {
				if (!bashUiText.includes(required)) fail(`Claude-style Bash UI omitted ${required}\n${bashUi}`);
			}
			if (bashUiText.includes("Ran 2 commands")) fail(`multiple Bash calls collapsed into one aggregate\n${bashUi}`);

			tmux(["send-keys", "-t", tmuxSession, "C-o"]);
			await waitForText(tmux, tmuxSession, "Tool output: expanded");
			const expanded = captureHistory(tmux, tmuxSession);
			for (const required of ["input-工具.txt", "*.txt", "Bash(pwd)", "Task create"]) {
				if (!expanded.includes(required)) fail(`Ctrl+O did not restore ${required}\n${expanded}`);
			}
			if (/^\s*(?:Call|Result|Details|Arguments)\s*$/mu.test(expanded)) {
				fail(`Ctrl+O exposed raw protocol headings\n${expanded}`);
			}
			tmux(["send-keys", "-t", tmuxSession, "C-o"]);
			await waitForText(tmux, tmuxSession, "Tool output: collapsed");
			const collapsedHistory = captureHistory(tmux, tmuxSession);
			successGroup(collapsedHistory);
			for (const required of ["Bash(printf 'BASH_UI_ONE", "Bash(printf BASH_UI_SECOND"]) {
				if (!collapsedHistory.includes(required)) fail(`Ctrl+O collapse lost ${required}\n${collapsedHistory}`);
			}

			send(tmux, tmuxSession, "/tools");
			const tools = await waitForText(tmux, tmuxSession, "activities");
			for (const required of ["Tools", "Tools / Bash · done", "BASH_UI_SECOND_DONE", "Esc close", "┃"]) {
				if (!tools.includes(required)) fail(`/tools lost grouped member ${required}\n${tools}`);
			}
			tmux(["send-keys", "-t", tmuxSession, "Enter"]);
			await Bun.sleep(100);
			const details = capture(tmux, tmuxSession);
			for (const required of ["Tools / Bash · done", "◆ Detail · formatted", "BASH_UI_SECOND_DONE"]) {
				if (!details.includes(required)) fail(`/tools group details lost member ${required}\n${details}`);
			}
			tmux(["send-keys", "-t", tmuxSession, "Escape"]);
			await Bun.sleep(100);
			tmux(["send-keys", "-t", tmuxSession, "Escape"]);
			await Bun.sleep(100);

			send(tmux, tmuxSession, "/reload");
			await waitForText(tmux, tmuxSession, "Reloaded keybindings, extensions");
			const reloadedHistory = captureHistory(tmux, tmuxSession);
			successGroup(reloadedHistory);
			for (const required of ["Bash(printf 'BASH_UI_ONE", "Bash(printf BASH_UI_SECOND"]) {
				if (!reloadedHistory.includes(required)) fail(`/reload lost ${required}\n${reloadedHistory}`);
			}

			await sendTurn(tmux, tmuxSession, "failure");
			const failure = await waitForText(tmux, tmuxSession, "GROUP_FAILURE_DONE");
			if (!normalized(failure).includes("Read 1 file") || !failure.includes("Bash(printf FIXTURE_GROUP_ERROR")) {
				fail(`standalone failure or neighboring read group was hidden\n${failure}`);
			}
			if (!failure.includes("⎿  Error: Exit code 17")) {
				fail(`Bash failure did not retain its explicit child outcome\n${failure}`);
			}
			if (failure.includes("• Read input-工具.txt")) fail(`failure group leaked successful member rows\n${failure}`);
			const unresolvedMarkerColor = markerColor(
				captureAnsiHistory(tmux, tmuxSession),
				"Bash(printf FIXTURE_GROUP_ERROR",
			);
			if (unresolvedMarkerColor === successfulMarkerColor) {
				fail("failed Bash operation retained the success color");
			}
			await sendTurn(tmux, tmuxSession, "recovery");
			const recovery = await waitForText(tmux, tmuxSession, "GROUP_RECOVERY_DONE");
			const recoveryText = normalized(recovery);
			for (const required of ["Retry same exact retry · retry failed", "Retry same exact retry · recovered"]) {
				if (!recoveryText.includes(required)) fail(`standalone retry omitted ${required}\n${recovery}`);
			}
			const recoveryAnsi = captureAnsiHistory(tmux, tmuxSession);
			const failedRetryColor = markerColor(recoveryAnsi, "Retry same exact retry · retry failed");
			if (failedRetryColor === successfulMarkerColor) fail("failed retry retained the success color");
			const recoveredMarkerColor = markerColor(recoveryAnsi, "Retry same exact retry · recovered");
			if (recoveredMarkerColor !== successfulMarkerColor) {
				fail(
					`recovered standalone Tool did not use the success color: expected ${JSON.stringify(successfulMarkerColor)}, received ${JSON.stringify(recoveredMarkerColor)}`,
				);
			}
			await sendTurn(tmux, tmuxSession, "mutation");
			const mutation = await waitForText(tmux, tmuxSession, "GROUP_MUTATION_DONE");
			if (!normalized(mutation).includes("Read 1 file") || !mutation.includes("Bash(printf mutation >")) {
				fail(`consequential standalone Bash and neighboring reads were not rendered\n${mutation}`);
			}
			if ((await readFile(join(temporaryDirectory, "bash-mutation-工具.txt"), "utf8")) !== "mutation") {
				fail("consequential Bash did not preserve its filesystem effect");
			}

			send(tmux, tmuxSession, "permission");
			await waitForText(tmux, tmuxSession, "Fixture permission");
			const permission = captureHistory(tmux, tmuxSession);
			if (!normalized(permission).includes("Permission Waiting for permission… · working")) {
				fail(`permission UI hid the active standalone Tool\n${permission}`);
			}
			if (!permission.includes("Waiting for permission")) {
				fail(`permission Tool omitted its bounded wait hint\n${permission}`);
			}
			tmux(["send-keys", "-t", tmuxSession, "Enter"]);
			const permissionDone = await waitForText(tmux, tmuxSession, "GROUP_PERMISSION_DONE");
			if (!normalized(permissionDone).includes("Permission Waiting for permission… · permission allowed")) {
				fail(`permission Tool did not settle semantically\n${permissionDone}`);
			}
			if (permissionDone.includes("fixture_confirm")) {
				fail(`permission Tool leaked raw protocol chrome\n${permissionDone}`);
			}

			send(tmux, tmuxSession, "rejection");
			await waitForText(tmux, tmuxSession, "Fixture rejection");
			tmux(["send-keys", "-t", tmuxSession, "Escape"]);
			const rejection = await waitForText(tmux, tmuxSession, "GROUP_REJECTION_DONE");
			const rejectionSummary = "Permission Waiting for permission… · permission rejected";
			if (!normalized(rejection).includes(rejectionSummary)) {
				fail(`permission rejection was not disclosed by the standalone Tool\n${rejection}`);
			}
			if (!rejection.includes("rejected")) fail(`permission rejection omitted its issue line\n${rejection}`);
			warningMarkerColor = markerColor(captureAnsiHistory(tmux, tmuxSession), rejectionSummary);
			if (warningMarkerColor === successfulMarkerColor || warningMarkerColor === unresolvedMarkerColor) {
				fail("rejected standalone Tool did not use its warning color");
			}

			await sendTurn(tmux, tmuxSession, "cancellation");
			const cancellation = await waitForText(tmux, tmuxSession, "GROUP_CANCELLATION_DONE");
			const cancellationSummary = "Cancel Cancelling operation · Operation aborted";
			if (!normalized(cancellation).includes(cancellationSummary)) {
				fail(`cancelled activity was not disclosed by the standalone Tool\n${cancellation}`);
			}
			if (!cancellation.includes("Operation aborted"))
				fail(`cancelled activity omitted its issue line\n${cancellation}`);
			if (markerColor(captureAnsiHistory(tmux, tmuxSession), cancellationSummary) !== warningMarkerColor) {
				fail("cancelled standalone Tool did not retain warning color");
			}

			await sendTurn(tmux, tmuxSession, "media");
			const media = await waitForText(tmux, tmuxSession, "GROUP_MEDIA_DONE");
			if (!normalized(media).includes("Media Visible image · media loaded")) {
				fail(`standalone media Tool lost its formatted row\n${media}`);
			}
			const mediaLines = media.split("\n");
			const activityLine = mediaLines.find((line) => line.includes("Media Visible image"));
			const previewLine = mediaLines.find((line) => line.includes("Image preview unavailable · PNG · 1×1"));
			if (!previewLine) {
				fail(`media body disappeared with standalone Tool chrome\n${media}`);
			}
			if (!activityLine || activityLine.indexOf("Media") !== previewLine.indexOf("Image")) {
				fail(`media fallback did not align with the Tool body column\n${media}`);
			}
			if (media.includes("fixture_media")) {
				fail(`media Tool leaked raw protocol chrome\n${media}`);
			}

			await sendTurn(tmux, tmuxSession, "agent");
			const agent = await waitForText(tmux, tmuxSession, "GROUP_AGENT_DONE");
			if (!normalized(agent).includes("Agent status · checked")) {
				fail(`standalone Agent Tool lost its formatted row\n${agent}`);
			}
			if (agent.includes("Subagent") || agent.includes("action: status")) {
				fail(`Agent Tool leaked raw protocol chrome\n${agent}`);
			}

			await sendTurn(tmux, tmuxSession, "completion");
			const completionLaunch = await waitForText(tmux, tmuxSession, "GROUP_COMPLETION_DONE");
			if (!completionLaunch.includes("Bash(sleep 0.4; printf FIXTURE_BACKGROUND_COMPLETED")) {
				fail(`background Bash launch did not retain its operation block\n${completionLaunch}`);
			}
			const completion = await waitForText(tmux, tmuxSession, 'Background command "completion fixture" completed');
			const taskRoot = join(temporaryDirectory, ".pi", "tasks");
			const outputFiles = (await readdir(taskRoot, { recursive: true })).filter((entry) =>
				entry.endsWith(".output"),
			);
			const outputs = await Promise.all(outputFiles.map((entry) => readFile(join(taskRoot, entry), "utf8")));
			if (!outputs.some((output) => output.includes("FIXTURE_BACKGROUND_COMPLETED"))) {
				fail(`background completion lost its output\n${completion}`);
			}
			if (!captureHistory(tmux, tmuxSession).includes("Bash(sleep 0.4; printf FIXTURE_BACKGROUND_COMPLETED")) {
				fail(`background completion removed its historical Bash operation block\n${completion}`);
			}
		} else if (scenario === "compaction") {
			await Bun.sleep(250);
			await sendTurn(tmux, tmuxSession, "postcompact");
			await waitForText(tmux, tmuxSession, "GROUP_POST_COMPACT_DONE");
			requireGroup(capture(tmux, tmuxSession));
			await Bun.sleep(250);
			send(tmux, tmuxSession, "/compact");
			await waitForText(tmux, tmuxSession, "Compacted from");
			requireGroup(capture(tmux, tmuxSession));
		} else if (scenario === "tree") {
			await Bun.sleep(250);
			await sendTurn(tmux, tmuxSession, "plain");
			await waitForText(tmux, tmuxSession, "PLAIN_DONE");
			await Bun.sleep(250);
			tmux(["send-keys", "-t", tmuxSession, "C-y"]);
			await waitForText(tmux, tmuxSession, "Session Tree");
			tmux(["send-keys", "-t", tmuxSession, "C-t", "Up", "Up", "Enter"]);
			await waitForText(tmux, tmuxSession, "Navigated to selected point");
			tmux(["resize-window", "-t", tmuxSession, "-x", String(options.columns), "-y", "60"]);
			await Bun.sleep(100);
			const treeHistory = capture(tmux, tmuxSession);
			const treeText = normalized(treeHistory);
			for (const required of [
				"Searched 1 pattern, read 1 file, listed 1 directory",
				"Bash(pwd)",
				"Task create Certify Activity Group",
			]) {
				if (!treeText.includes(required)) fail(`session_tree replay lost ${required}\n${treeHistory}`);
			}
		} else if (scenario === "resume") {
			send(tmux, tmuxSession, "background");
			await waitForText(tmux, tmuxSession, "Bash(sleep 30)");
			await detachForegroundBash(tmux, tmuxSession);
			backgroundBarrier(await waitForText(tmux, tmuxSession, "GROUP_BACKGROUND_DONE"));
			tmux(["kill-session", "-t", tmuxSession]);
			await Bun.sleep(250);
			tmux([
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
			await waitForText(tmux, tmuxSession, "GROUP_BACKGROUND_DONE");
			const resumed = captureHistory(tmux, tmuxSession);
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
			scenario === "lifecycle" ? 22 : scenario === "compaction" ? 6 : scenario === "resume" ? 10 : 5;
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
		if (scenario === "lifecycle" && !transcript.includes("STRUCTURED_CODE_LINE")) {
			fail("persisted transcript lost the structured Assistant fixture");
		}
		for (const required of requiredTranscriptText) {
			if (!transcript.includes(required)) fail(`persisted transcript lost ${required}`);
		}
		for (const displayOnly of ["ctrl+o to expand", "Searched 1 pattern, read 1 file", "• Bash(pwd)"]) {
			if (transcript.includes(displayOnly))
				fail(`display-only grouping leaked into persisted session data: ${displayOnly}`);
		}
		if (scenario === "compaction" && !transcript.includes('"type":"compaction"')) {
			fail("real session did not persist the exercised compaction boundary");
		}
	} finally {
		Bun.spawnSync(["tmux", "-S", tmuxSocket, "kill-server"], {
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
