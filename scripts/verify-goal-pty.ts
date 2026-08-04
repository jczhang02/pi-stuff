import { existsSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";

const root = resolve(import.meta.dir, "..");
const providerExtension = join(root, "test/fixtures/ui-pty-provider.ts");
const runner = join(root, "test/fixtures/goal-pty-runner.sh");
const WAIT_TIMEOUT_MS = 20_000;

export interface GoalPtyVerificationOptions {
	readonly piBinary: string;
	readonly packagePath: string;
	readonly columns: number;
	readonly rows: number;
}

interface PersistedGoalSessionEntry {
	readonly customType?: unknown;
	readonly data?: unknown;
	readonly display?: unknown;
	readonly message?: unknown;
	readonly type?: unknown;
}

function fail(message: string): never {
	throw new Error(`Goal PTY verification failed: ${message}`);
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function verifyScreen(screen: string, columns: number, label: string, allowNormalChrome = false): void {
	if (!screen.includes("─".repeat(columns))) {
		fail(`${label} did not render a ${String(columns)}-column divider\n${screen}`);
	}
	const forbiddenChrome = allowNormalChrome ? ["╭", "╮", "╰", "╯"] : ["╭", "╮", "╰", "╯", "think:med", "Working..."];
	for (const forbidden of forbiddenChrome) {
		if (screen.includes(forbidden)) fail(`${label} exposed forbidden floating or normal chrome: ${forbidden}`);
	}
	for (const [index, line] of screen.split("\n").entries()) {
		const width = visibleWidth(line);
		if (width > columns) {
			fail(`${label} row ${String(index + 1)} occupies ${String(width)} columns in a ${String(columns)}-column PTY`);
		}
	}
}

class GoalPtySession {
	private readonly configDirectory: string;
	private readonly directory: string;
	private readonly options: GoalPtyVerificationOptions;
	private readonly sessionDirectory: string;
	private readonly socket: string;
	private readonly target = "pi";
	private stopped = false;

	constructor(
		directory: string,
		options: GoalPtyVerificationOptions,
		configDirectory: string,
		sessionDirectory: string,
	) {
		this.configDirectory = configDirectory;
		this.directory = directory;
		this.options = options;
		this.sessionDirectory = sessionDirectory;
		this.socket = join(directory, "goal-pty.sock");
	}

	start(): void {
		const environment = {
			...process.env,
			PI_CODING_AGENT_DIR: this.configDirectory,
			PI_OFFLINE: "1",
			PI_STUFF_GOAL_PTY_BIN: this.options.piBinary,
			PI_STUFF_GOAL_PTY_COLUMNS: String(this.options.columns),
			PI_STUFF_GOAL_PTY_PACKAGE: resolve(this.options.packagePath),
			PI_STUFF_GOAL_PTY_PROVIDER_EXTENSION: providerExtension,
			PI_STUFF_GOAL_PTY_ROWS: String(this.options.rows),
			PI_STUFF_GOAL_PTY_SESSIONS: this.sessionDirectory,
			PI_STUFF_GOAL_PTY_SESSION_ID: `goal-pty-${String(this.options.columns)}x${String(this.options.rows)}`,
			PI_STUFF_UI_PTY_LOG: join(this.directory, "provider.jsonl"),
			PI_TELEMETRY: "0",
			TERM: "xterm-256color",
		};
		const result = Bun.spawnSync(
			[
				"tmux",
				"-S",
				this.socket,
				"-f",
				"/dev/null",
				"new-session",
				"-d",
				"-s",
				this.target,
				"-x",
				String(this.options.columns),
				"-y",
				String(this.options.rows),
				"-c",
				this.directory,
				runner,
				";",
				"set-option",
				"-g",
				"remain-on-exit",
				"on",
			],
			{ env: environment, stderr: "pipe", stdout: "pipe" },
		);
		if (result.exitCode !== 0) {
			fail(`tmux could not start Pi: ${result.stderr.toString().trim() || result.stdout.toString().trim()}`);
		}
		const geometry = this.tmux(["display-message", "-p", "-t", this.target, "#{pane_width}x#{pane_height}"]).trim();
		if (geometry !== `${String(this.options.columns)}x${String(this.options.rows)}`) {
			fail(`expected ${String(this.options.columns)}x${String(this.options.rows)} PTY, received ${geometry}`);
		}
	}

	capture(): string {
		return this.tmux(["capture-pane", "-p", "-N", "-t", this.target]);
	}

	sendKey(...keys: readonly string[]): void {
		this.tmux(["send-keys", "-t", this.target, ...keys]);
	}

	sendLiteral(value: string): void {
		this.tmux(["send-keys", "-t", this.target, "-l", value]);
	}

	async waitForText(text: string): Promise<string> {
		const deadline = Date.now() + WAIT_TIMEOUT_MS;
		let screen = "";
		while (Date.now() < deadline) {
			screen = this.capture();
			if (screen.includes(text)) return screen;
			await delay(50);
		}
		fail(`timed out waiting for ${JSON.stringify(text)}\n${screen}`);
	}

	stop(): void {
		if (this.stopped) return;
		this.stopped = true;
		Bun.spawnSync(["tmux", "-S", this.socket, "kill-server"], { stderr: "pipe", stdout: "pipe" });
		rmSync(this.socket, { force: true });
	}

	private tmux(arguments_: readonly string[]): string {
		const result = Bun.spawnSync(["tmux", "-S", this.socket, ...arguments_], {
			stderr: "pipe",
			stdout: "pipe",
		});
		if (result.exitCode !== 0) {
			fail(
				`tmux ${arguments_.join(" ")} failed: ${result.stderr.toString().trim() || result.stdout.toString().trim()}`,
			);
		}
		return result.stdout.toString();
	}
}

export async function verifyGoalPty(options: GoalPtyVerificationOptions): Promise<void> {
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-goal-pty-"));
	const configDirectory = join(temporaryDirectory, "agent");
	const sessionDirectory = join(temporaryDirectory, "sessions");
	await Promise.all([mkdir(configDirectory), mkdir(sessionDirectory)]);
	await writeFile(
		join(configDirectory, "settings.json"),
		`${JSON.stringify({ defaultProjectTrust: "always", quietStartup: true, theme: "dark", uiMode: "fullscreen" }, null, "\t")}\n`,
		{ mode: 0o600 },
	);

	const session = new GoalPtySession(temporaryDirectory, options, configDirectory, sessionDirectory);
	try {
		session.start();
		await session.waitForText("Welcome back!");
		session.sendLiteral("/goal");
		session.sendKey("Enter");
		const main = await session.waitForText("No goal is currently set");
		for (const required of ["Goal", "Start a goal", "Start with token budget", "Settings", "Help"]) {
			if (!main.includes(required)) fail(`Goal manager is missing ${required}\n${main}`);
		}
		verifyScreen(main, options.columns, "Goal manager");

		session.sendKey("Down", "Down", "Enter");
		const settings = await session.waitForText("Pi Goal Settings");
		for (const required of ["Automatic work", "Unlimited", "No-progress guard", "Off", "Goal tools"]) {
			if (!settings.includes(required)) fail(`Goal SettingsList is missing ${required}\n${settings}`);
		}
		verifyScreen(settings, options.columns, "Goal SettingsList");

		session.sendKey("Escape");
		await session.waitForText("No goal is currently set");
		session.sendKey("Escape");
		const restored = await session.waitForText("think:med");
		for (const dialogText of ["Pi Goal Settings", "No goal is currently set"]) {
			if (restored.includes(dialogText)) fail(`Goal dialog did not close cleanly: ${dialogText}`);
		}

		const objective = "verify hidden Goal protocol";
		session.sendLiteral(`/goal ${objective}`);
		session.sendKey("Enter");
		const active = await session.waitForText("Goal complete:");
		for (const forbidden of ["<goal_objective>", "Goal-mode rules", "pi-goal-prompt:", "Continuation behavior:"]) {
			if (active.includes(forbidden)) fail(`hidden Goal protocol leaked into the TUI: ${forbidden}\n${active}`);
		}
		verifyScreen(active, options.columns, "active hidden Goal prompt", true);

		const requestLog = await readFile(join(temporaryDirectory, "provider.jsonl"), "utf8");
		const requests = requestLog
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as { ownedGoalPrompt?: string });
		const deliveredPrompt = requests.find((request) => request.ownedGoalPrompt)?.ownedGoalPrompt ?? "";
		for (const required of [
			`<goal_objective>\n${objective}\n</goal_objective>`,
			"Goal-mode rules:",
			"<!-- pi-goal-prompt:",
		]) {
			if (!deliveredPrompt.includes(required)) fail(`model context is missing hidden Goal protocol: ${required}`);
		}

		await delay(500);
		const sessionFiles = (await readdir(sessionDirectory, { recursive: true }))
			.filter((file) => file.endsWith(".jsonl"))
			.map((file) => join(sessionDirectory, file));
		if (sessionFiles.length !== 1) {
			fail(`expected one persisted Goal session, found ${String(sessionFiles.length)}`);
		}
		const sessionJsonl = await readFile(sessionFiles[0] as string, "utf8");
		const entries = sessionJsonl
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as PersistedGoalSessionEntry);
		const hiddenEntry = entries.find(
			(entry) => entry.type === "custom_message" && entry.customType === "pi-stuff-goal-prompt",
		);
		if (hiddenEntry?.display !== false) fail("persisted Goal protocol is not marked display=false");
		const goalStates = entries.filter((entry) => entry.type === "custom" && entry.customType === "goal-state");
		const completedGoal = goalStates
			.map((entry) => (entry.data as { goal?: { status?: unknown } } | undefined)?.goal)
			.find((goal) => goal?.status === "complete");
		const completionResults = entries
			.filter((entry) => {
				const message = entry.message as { role?: unknown; toolName?: unknown } | undefined;
				return entry.type === "message" && message?.role === "toolResult" && message.toolName === "goal_complete";
			})
			.map((entry) => entry.message as { content?: Array<{ text?: unknown }> });
		const successfulCompletion = completionResults.some((message) =>
			message.content?.some((part) => typeof part.text === "string" && part.text.startsWith("Goal complete:")),
		);
		if (!completedGoal || !successfulCompletion) {
			fail(
				`hidden Goal prompt fixture did not complete its Goal: ${JSON.stringify({ completedGoal, completionResults })}`,
			);
		}

		const exportPath = join(temporaryDirectory, "goal-session.html");
		const certifiedExporter = join(root, ".artifacts/pi-host/linux-x64/pi");
		const requestedExporterAssets = join(resolve(options.piBinary, ".."), "export-html/template.css");
		const exporter = existsSync(requestedExporterAssets) ? options.piBinary : certifiedExporter;
		if (!existsSync(exporter)) fail("no export-capable certified Pi binary is available");
		const exported = Bun.spawnSync([exporter, "--export", sessionFiles[0] as string, exportPath], {
			env: { ...process.env, PI_TELEMETRY: "0" },
			stderr: "pipe",
			stdout: "pipe",
		});
		if (exported.exitCode !== 0) {
			fail(`Pi HTML export failed: ${exported.stderr.toString().trim() || exported.stdout.toString().trim()}`);
		}
		const exportedHtml = await readFile(exportPath, "utf8");
		for (const forbidden of ["<goal_objective>", "Goal-mode rules:", "pi-goal-prompt:"]) {
			if (exportedHtml.includes(forbidden)) fail(`Goal protocol leaked as plaintext into HTML export: ${forbidden}`);
		}
	} finally {
		session.stop();
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	const { PI_BIN = "/opt/pi-coding-agent/pi" } = process.env;
	await verifyGoalPty({
		piBinary: PI_BIN,
		packagePath: join(root, "packages/pi-stuff"),
		columns: 56,
		rows: 24,
	});
	console.log("Certified Goal Command Dialog and native SettingsList in a 56x24 PTY");
}
