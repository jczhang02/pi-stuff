import { rmSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createLiveThoughtTransformer } from "../packages/pi-stuff-ui/live-thought.js";
import {
	FIXTURE_THINKING,
	THOUGHT_PHASES,
	TODO_PTY_PROMPT,
	TODO_PTY_READY,
	TODO_PTY_SUBJECTS,
} from "../test/fixtures/ui-pty-provider.js";
import { CERTIFIED_PI_HOST_PROFILE, CERTIFIED_PI_VERSION } from "./pi-host-contract.js";
import { verifyPiHostProvenance } from "./verify-pi-host-provenance.js";

const root = resolve(import.meta.dir, "..");
const providerExtension = join(root, "test/fixtures/ui-pty-provider.ts");
const runner = join(root, "test/fixtures/ui-pty-runner.sh");
const TARGET_SIZES = [
	{ columns: 100, rows: 32 },
	{ columns: 64, rows: 28 },
	{ columns: 48, rows: 22 },
	{ columns: 32, rows: 18 },
	{ columns: 24, rows: 16 },
] as const;
const UI_LABELS = [
	"Statusline",
	"Statusline density",
	"Latest prompt",
	"Statusline icons",
	"Welcome header",
	"Input highlighting",
	"Inline slash autocomplete",
	"Tool running timer",
] as const;
const NERD_MODEL_MARKER = "\u{F06A9}";
const ASCII_MODEL_MARKER = "◆";
const NERD_THINKING_MARKER = "\uF441 med";
const LONG_PROMPT_PREFIX = "中文_LONG_CJK_PROMPT_开始";
const LONG_PROMPT_TOKEN = "长提示";
const LONG_PROMPT_SUFFIX = "LONG_CJK_PROMPT_结尾";
const LONG_PROMPT = `${LONG_PROMPT_PREFIX} ${Array.from(
	{ length: 48 },
	(_, index) => `${LONG_PROMPT_TOKEN}${String(index + 1).padStart(2, "0")}中文🧪`,
).join(" ")} ${LONG_PROMPT_SUFFIX}`;
const SUBSCRIPTION_MODEL = "ui-pty-subscription";
const POLL_INTERVAL_MS = 50;
const WAIT_TIMEOUT_MS = 20_000;
const thoughtTransformer = createLiveThoughtTransformer();

export interface UiPtyVerificationOptions {
	readonly artifactDirectory?: string;
	readonly packagePath: string;
	readonly piBinary: string;
}

export interface UiPtyEvidence {
	readonly markdownTransformer: boolean;
	readonly sizes: readonly string[];
	readonly verified: readonly string[];
}

interface FixtureRecord {
	readonly commands?: unknown;
	readonly lastUser?: unknown;
	readonly markdownTransformer?: unknown;
	readonly model?: unknown;
	readonly provider?: unknown;
	readonly priorThinkingPreserved?: unknown;
	readonly selected?: unknown;
	readonly type?: unknown;
	readonly usingOAuth?: unknown;
}

interface CasePaths {
	readonly config: string;
	readonly log: string;
	readonly project: string;
	readonly sessions: string;
}

let sessionCounter = 0;

function fail(message: string): never {
	throw new Error(`UI PTY verification failed: ${message}`);
}

function commandOutput(command: string, args: readonly string[], options: { readonly cwd?: string } = {}): string {
	const result = Bun.spawnSync([command, ...args], {
		...(options.cwd ? { cwd: options.cwd } : {}),
		stderr: "pipe",
		stdout: "pipe",
	});
	if (result.exitCode !== 0) {
		fail(
			`${command} ${args.join(" ")} exited ${String(result.exitCode)}: ${result.stderr.toString().trim() || result.stdout.toString().trim()}`,
		);
	}
	return result.stdout.toString();
}

function verifyHostVersion(piBinary: string): void {
	const version = commandOutput(piBinary, ["--version"]).trim();
	if (version !== CERTIFIED_PI_VERSION) {
		fail(`expected Pi ${CERTIFIED_PI_VERSION}, received ${version || "no version"}`);
	}
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

class TmuxPiSession {
	private columns: number;
	private readonly environment: Record<string, string | undefined>;
	private readonly label: string;
	private readonly project: string;
	private rows: number;
	private readonly socket: string;
	private stopped = false;
	private readonly target = "pi";

	constructor(paths: CasePaths, options: UiPtyVerificationOptions, columns: number, rows: number) {
		sessionCounter += 1;
		this.columns = columns;
		this.rows = rows;
		this.project = paths.project;
		this.label = `piui-${String(process.pid)}-${String(sessionCounter)}`;
		this.socket = join(paths.config, `${this.label}.sock`);
		this.environment = {
			...process.env,
			MAGIC_CONTEXT_PI_SUBAGENT: "1",
			PI_CODING_AGENT_DIR: paths.config,
			PI_OFFLINE: "1",
			POWERLINE_NERD_FONTS: "1",
			PI_STUFF_UI_PTY_BIN: options.piBinary,
			PI_STUFF_UI_PTY_COLUMNS: String(columns),
			PI_STUFF_UI_PTY_LOG: paths.log,
			PI_STUFF_UI_PTY_PACKAGE: resolve(options.packagePath),
			PI_STUFF_UI_PTY_PROVIDER_EXTENSION: providerExtension,
			PI_STUFF_UI_PTY_ROWS: String(rows),
			PI_STUFF_UI_PTY_SESSIONS: paths.sessions,
			PI_STUFF_UI_PTY_SESSION_ID: `ui-pty-${String(columns)}x${String(rows)}-${String(sessionCounter)}`,
			PI_TELEMETRY: "0",
			TERM: "xterm-256color",
		};
	}

	start(): void {
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
				String(this.columns),
				"-y",
				String(this.rows),
				"-c",
				this.project,
				runner,
				";",
				"set-option",
				"-s",
				"extended-keys",
				"on",
				";",
				"set-option",
				"-g",
				"remain-on-exit",
				"on",
			],
			{ env: this.environment, stderr: "pipe", stdout: "pipe" },
		);
		if (result.exitCode !== 0) {
			fail(`tmux could not start Pi: ${result.stderr.toString().trim() || result.stdout.toString().trim()}`);
		}
		const serverOptions = this.tmux(["show-options", "-s"]);
		if (/^extended-keys-format\b/m.test(serverOptions)) {
			this.tmux(["set-option", "-s", "extended-keys-format", "csi-u"]);
		}
		const geometry = this.tmux(["display-message", "-p", "-t", this.target, "#{pane_width}x#{pane_height}"]).trim();
		if (geometry !== `${String(this.columns)}x${String(this.rows)}`) {
			fail(`expected ${String(this.columns)}x${String(this.rows)} PTY, received ${geometry}`);
		}
	}

	capture(history = false): string {
		return this.tmux(["capture-pane", "-p", "-N", ...(history ? ["-S", "-"] : []), "-t", this.target]);
	}

	captureAnsi(history = false): string {
		return this.tmux(["capture-pane", "-p", "-e", "-N", ...(history ? ["-S", "-"] : []), "-t", this.target]);
	}

	sendKey(...keys: readonly string[]): void {
		this.tmux(["send-keys", "-t", this.target, ...keys]);
	}

	sendLiteral(value: string): void {
		this.tmux(["send-keys", "-t", this.target, "-l", value]);
	}

	resize(columns: number, rows: number): void {
		this.tmux(["resize-window", "-t", this.target, "-x", String(columns), "-y", String(rows)]);
		const geometry = this.tmux(["display-message", "-p", "-t", this.target, "#{pane_width}x#{pane_height}"]).trim();
		if (geometry !== `${String(columns)}x${String(rows)}`) {
			fail(`live resize expected ${String(columns)}x${String(rows)}, received ${geometry}`);
		}
		const paneTty = this.tmux(["display-message", "-p", "-t", this.target, "#{pane_tty}"]).trim();
		commandOutput("stty", ["-F", paneTty, "rows", String(rows), "columns", String(columns)]);
		this.columns = columns;
		this.rows = rows;
	}

	paneTitle(): string {
		return this.tmux(["display-message", "-p", "-t", this.target, "#{pane_title}"]).trim();
	}

	async waitForText(text: string, history = false): Promise<string> {
		return this.waitFor((screen) => screen.includes(text), `text ${JSON.stringify(text)}`, history);
	}

	async waitForAbsence(text: string): Promise<string> {
		return this.waitFor((screen) => !screen.includes(text), `absence of ${JSON.stringify(text)}`);
	}

	async waitForStatusline(): Promise<string> {
		return this.waitFor(hasStatusline, "the shared Statusline Footer");
	}

	async waitForStatuslineAbsence(): Promise<string> {
		return this.waitFor((screen) => !hasStatusline(screen), "absence of the shared Statusline Footer");
	}

	async waitForDivider(columns: number): Promise<string> {
		const modelMarker = columns < 32 ? "ui-pt" : "ui-pty-model";
		return this.waitFor(
			(screen) =>
				screen.includes("Welcome back!") &&
				screen.includes(modelMarker) &&
				screen
					.split("\n")
					.some(
						(line) =>
							line.length > 0 &&
							[...line].every((character) => character === "─") &&
							visibleWidth(line) === columns,
					),
			`${String(columns)}-column Welcome divider`,
		);
	}

	stop(): void {
		if (this.stopped) return;
		this.stopped = true;
		Bun.spawnSync(["tmux", "-S", this.socket, "kill-server"], {
			stderr: "pipe",
			stdout: "pipe",
		});
		const probe = Bun.spawnSync(["tmux", "-S", this.socket, "has-session"], {
			stderr: "pipe",
			stdout: "pipe",
		});
		if (probe.exitCode === 0) fail(`isolated tmux server ${this.label} survived cleanup`);
		rmSync(this.socket, { force: true });
	}

	private tmux(args: readonly string[]): string {
		const result = Bun.spawnSync(["tmux", "-S", this.socket, ...args], {
			stderr: "pipe",
			stdout: "pipe",
		});
		if (result.exitCode !== 0) {
			fail(`tmux ${args.join(" ")} failed: ${result.stderr.toString().trim() || result.stdout.toString().trim()}`);
		}
		return result.stdout.toString();
	}

	private async waitFor(
		predicate: (screen: string) => boolean,
		description: string,
		history = false,
	): Promise<string> {
		const deadline = Date.now() + WAIT_TIMEOUT_MS;
		let screen = "";
		while (Date.now() < deadline) {
			screen = this.capture(history);
			if (predicate(screen)) return screen;
			await delay(POLL_INTERVAL_MS);
		}
		fail(`timed out waiting for ${description} in ${String(this.columns)}x${String(this.rows)}\n${screen}`);
	}
}

async function createCase(rootDirectory: string, label: string): Promise<CasePaths> {
	const caseDirectory = join(rootDirectory, label);
	const config = join(caseDirectory, "agent");
	const sessions = join(caseDirectory, "sessions");
	const project = join(caseDirectory, "项目", "长路径", "验证");
	const log = join(caseDirectory, "ui-pty.jsonl");
	await Promise.all([
		mkdir(config, { recursive: true }),
		mkdir(sessions, { recursive: true }),
		mkdir(project, { recursive: true }),
	]);
	await Promise.all([
		writeFile(
			join(config, "settings.json"),
			`${JSON.stringify(
				{
					defaultProjectTrust: "always",
					enableInstallTelemetry: false,
					hideThinkingBlock: false,
					images: { autoResize: false },
					outputPad: 1,
					quietStartup: true,
					theme: "dark",
					uiMode: "fullscreen",
				},
				null,
				"\t",
			)}\n`,
			{ mode: 0o600 },
		),
		writeFile(log, "", { mode: 0o600 }),
		writeFile(join(project, "tracked-工具.txt"), "committed\n", {
			mode: 0o600,
		}),
	]);
	commandOutput("git", ["init", "-b", "main"], { cwd: project });
	commandOutput("git", ["config", "user.name", "Pi Stuff UI Fixture"], {
		cwd: project,
	});
	commandOutput("git", ["config", "user.email", "ui-fixture@example.invalid"], { cwd: project });
	commandOutput("git", ["config", "commit.gpgsign", "false"], {
		cwd: project,
	});
	commandOutput("git", ["add", "tracked-工具.txt"], { cwd: project });
	commandOutput("git", ["commit", "-m", "fixture"], { cwd: project });
	await Promise.all([
		writeFile(join(project, "tracked-工具.txt"), "modified 中文\n", {
			mode: 0o600,
		}),
		writeFile(join(project, "untracked-🧪.txt"), "new\n", { mode: 0o600 }),
	]);
	return { config, log, project, sessions };
}

function verifyTerminalWidth(screen: string, columns: number, label: string): void {
	for (const [index, line] of screen.split("\n").entries()) {
		const width = visibleWidth(line);
		if (width > columns) {
			fail(`${label} row ${String(index + 1)} occupies ${String(width)} columns in a ${String(columns)}-column PTY`);
		}
	}
}

function verifyNoFloatingFrame(screen: string, label: string): void {
	const lines = screen.split("\n");
	let surfaceStart = 0;
	for (const [index, line] of lines.entries()) {
		if (line.length > 0 && [...line].every((character) => character === "─")) surfaceStart = index;
	}
	const surface = lines.slice(surfaceStart).join("\n");
	for (const forbidden of ["╭", "╮", "╰", "╯"]) {
		if (surface.includes(forbidden)) fail(`${label} exposed floating-frame glyph ${forbidden}`);
	}
}

function verifyWelcomeCard(screen: string, columns: number, rows: number): void {
	for (const corner of ["╭", "╮", "╰", "╯"]) {
		if (!screen.includes(corner)) fail(`${String(columns)}-column Welcome card is missing ${corner}`);
	}
	const title = screen.split("\n").find((line) => line.includes("Pi Stuff"));
	if (!title || visibleWidth(title) !== columns) {
		fail(`${String(columns)}-column Welcome title row is not full-width\n${screen}`);
	}
	const lines = screen.split("\n");
	const compact = columns < 48 || rows <= 18;
	const finalLogoRow = lines.findIndex((line) => line.includes(compact ? "█▀ █" : "██    ██"));
	if (finalLogoRow < 0) {
		fail(
			`${String(columns)}x${String(rows)} Welcome is missing the official ${compact ? "4×2" : "8×4"} Pi mark\n${screen}`,
		);
	}
	const blankAfterLogo = lines[finalLogoRow + 1];
	if (blankAfterLogo?.replace(/[│ ]/gu, "") !== "") {
		fail(`${String(columns)}x${String(rows)} Welcome has no full blank row below the Pi mark\n${screen}`);
	}
	if (compact && screen.includes("██████")) {
		fail(`${String(columns)}x${String(rows)} Welcome cropped the full Pi mark instead of selecting the compact mark`);
	}
}

async function writePtyEvidence(directory: string | undefined, name: string, session: TmuxPiSession): Promise<void> {
	if (!directory) return;
	await mkdir(directory, { recursive: true });
	await Promise.all([
		writeFile(join(directory, `${name}.ansi`), sanitizePtyEvidence(session.captureAnsi()), "utf8"),
		writeFile(join(directory, `${name}.txt`), sanitizePtyEvidence(session.capture()), "utf8"),
	]);
}

function sanitizePtyEvidence(value: string): string {
	return value
		.replace(/\/tmp\/pi-stuff-ui-pty-[^/\s]+/gu, "[fixture]")
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.trimEnd();
}

function verifyFreshScreen(screen: string, columns: number, rows: number): void {
	const modelMarker = columns < 32 ? "ui-pt" : "ui-pty-model";
	const requiredFields = ["Welcome back!", modelMarker, ...(columns >= 48 ? ["med"] : [])];
	for (const required of requiredFields) {
		if (!screen.includes(required)) {
			fail(`${String(columns)}-column fresh screen is missing ${required}\n${screen}`);
		}
	}
	const editorDivider = screen
		.split("\n")
		.find((line) => line.length > 0 && [...line].every((character) => character === "─"));
	if (!editorDivider || visibleWidth(editorDivider) !== columns) {
		fail(`${String(columns)}-column editor did not render a full-width divider`);
	}
	verifyWelcomeCard(screen, columns, rows);

	if (columns >= 70) {
		for (const required of [
			"Loaded",
			"Tips for getting started",
			"Type / to browse commands",
			"extensions",
			"tools",
			"skills",
		]) {
			if (!screen.includes(required)) fail(`wide Welcome/Statusline is missing ${required}`);
		}
	} else {
		for (const forbidden of ["Loaded", "Tips for getting started", "extensions", " tools", " skills"]) {
			if (screen.includes(forbidden)) fail(`single-column Welcome retained wide-only ${forbidden}`);
		}
	}
	const statusline = statuslineRow(screen);
	if (!statusline) fail(`${String(columns)}-column screen has no icon-led Statusline below the editor\n${screen}`);
	if (!statusline.startsWith(`${NERD_MODEL_MARKER} `)) {
		fail(`${String(columns)}-column Statusline did not use the deterministic Nerd model icon\n${screen}`);
	}
	if (columns >= 48 && !statusline.includes(NERD_THINKING_MARKER)) {
		fail(`${String(columns)}-column Statusline dropped or mis-rendered the Thinking segment\n${screen}`);
	}
	for (const required of ["ui-pt", "%", ...(columns >= 48 ? ["main"] : [])]) {
		if (!statusline.includes(required)) {
			fail(`${String(columns)}-column Statusline dropped priority field ${required}\n${screen}`);
		}
	}
	verifyTerminalWidth(screen, columns, `fresh ${String(columns)}-column screen`);
}

function rowsBelowEditorDivider(screen: string): readonly string[] {
	const lines = screen.split("\n");
	let dividerIndex = -1;
	for (const [index, line] of lines.entries()) {
		if (line.length > 0 && [...line].every((character) => character === "─")) dividerIndex = index;
	}
	return dividerIndex < 0 ? [] : lines.slice(dividerIndex + 1);
}

function statuslineRow(screen: string): string | undefined {
	return rowsBelowEditorDivider(screen).find(
		(line) => line.startsWith(`${NERD_MODEL_MARKER} `) || line.startsWith(`${ASCII_MODEL_MARKER} `),
	);
}

function hasStatusline(screen: string): boolean {
	return statuslineRow(screen) !== undefined;
}

async function openUi(session: TmuxPiSession): Promise<string> {
	session.sendKey("C-u");
	session.sendLiteral("/ui");
	session.sendKey("Enter");
	let screen = await session.waitForText("Tool running timer");
	for (const label of UI_LABELS) {
		if (!screen.includes(label)) screen = await session.waitForText(label);
	}
	if (screen.includes("RTK command") || screen.includes("RTK output")) {
		fail("/ui retained RTK behavior settings");
	}
	return screen;
}

async function openFilteredUi(session: TmuxPiSession, query: string, label: string): Promise<string> {
	await openUi(session);
	session.sendLiteral(query);
	return session.waitForText(`→ ${label}`);
}

function verifySettingValue(screen: string, label: string, expected: boolean | string): void {
	const row = screen.split("\n").find((line) => line.includes(label));
	if (!row?.includes(String(expected))) {
		fail(`${label} did not show ${String(expected)} in /ui\n${screen}`);
	}
}

async function waitForPersistedSetting(path: string, key: string, expected: unknown): Promise<Record<string, unknown>> {
	const deadline = Date.now() + WAIT_TIMEOUT_MS;
	let last = "settings file not created";
	while (Date.now() < deadline) {
		try {
			const text = await readFile(path, "utf8");
			last = text;
			const settings = JSON.parse(text) as Record<string, unknown>;
			if (Object.is(settings[key], expected)) return settings;
		} catch (error) {
			last = String(error);
		}
		await delay(POLL_INTERVAL_MS);
	}
	fail(`${key}=${JSON.stringify(expected)} was not persisted: ${last}`);
}

async function waitForFixtureRecords(path: string, type: string, count: number): Promise<readonly FixtureRecord[]> {
	const deadline = Date.now() + WAIT_TIMEOUT_MS;
	let records: readonly FixtureRecord[] = [];
	while (Date.now() < deadline) {
		records = await readFixtureRecords(path);
		if (records.filter((record) => record.type === type).length >= count) return records;
		await delay(POLL_INTERVAL_MS);
	}
	fail(`fixture log did not reach ${String(count)} ${type} record(s)`);
}

function containsFixtureThinking(value: unknown): boolean {
	if (value === FIXTURE_THINKING) return true;
	if (Array.isArray(value)) return value.some(containsFixtureThinking);
	if (typeof value !== "object" || value === null) return false;
	return Object.values(value).some(containsFixtureThinking);
}

async function waitForPersistedThinking(sessionDirectory: string): Promise<void> {
	const deadline = Date.now() + WAIT_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const sessionFiles = (await readdir(sessionDirectory)).filter((entry) => entry.endsWith(".jsonl"));
		for (const sessionFile of sessionFiles) {
			const records = (await readFile(join(sessionDirectory, sessionFile), "utf8"))
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line) as unknown);
			if (records.some(containsFixtureThinking)) return;
		}
		await delay(POLL_INTERVAL_MS);
	}
	fail("settled session JSONL did not retain the original Thinking content");
}

function expectedThoughtProjection(phaseIndex: number, columns: number): string {
	const markdown = THOUGHT_PHASES.slice(0, phaseIndex + 1)
		.map((phase) => `**${phase}**`)
		.join("\n\n");
	return thoughtTransformer(markdown, {
		// Pi's assistant message component reserves one column on each side.
		availableWidth: Math.max(0, columns - 2),
		isStreaming: true,
		messageType: "assistant-thinking",
	}).replaceAll(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/gu, "$1");
}

function thoughtRows(screen: string): string[] {
	return screen.split("\n").filter((line) => /(?:^|\s)✻(?: thoughts:)?\s/u.test(line));
}

function verifySingleThoughtRow(screen: string, expected: string, columns: number, phase: string): void {
	const rows = thoughtRows(screen);
	if (rows.length !== 1 || !rows[0]?.includes(expected)) {
		fail(`${phase} did not render exactly one expected Thought row in ${String(columns)} columns\n${screen}`);
	}
	if (visibleWidth(rows[0]) > columns) {
		fail(`${phase} Thought occupied ${String(visibleWidth(rows[0]))} columns in a ${String(columns)}-column PTY`);
	}
}

async function verifyThoughtLifecycle(
	session: TmuxPiSession,
	paths: CasePaths,
	columns: number,
	rows: number,
): Promise<void> {
	const settledMarker = `THOUGHT_DONE_${String(columns)}`;
	session.sendLiteral(`THOUGHT_PROBE_${String(columns)}`);
	session.sendKey("Enter");

	let screen = "";
	for (const [index, phase] of THOUGHT_PHASES.entries()) {
		const expected = expectedThoughtProjection(index, columns);
		screen = await session.waitForText(expected);
		verifySingleThoughtRow(screen, expected, columns, `live frame ${String(index + 1)}`);
		if (screen.includes(settledMarker)) {
			fail(`Thought frame ${String(index + 1)} was captured only after the response settled`);
		}
		for (let priorIndex = 0; priorIndex < index; priorIndex += 1) {
			const prior = expectedThoughtProjection(priorIndex, columns);
			if (prior !== expected && screen.includes(prior)) {
				fail(`Thought phase ${JSON.stringify(phase)} appended instead of replacing ${JSON.stringify(prior)}`);
			}
		}
		if (session.paneTitle().includes("OWNED_TITLE")) fail("model-provided OSC changed the real PTY title");
	}

	await session.waitForText(settledMarker);
	session.resize(columns - 1, rows);
	await delay(100);
	session.resize(columns, rows);
	const settledThought = expectedThoughtProjection(THOUGHT_PHASES.length - 1, columns);
	screen = await session.waitForText(settledThought);
	verifySingleThoughtRow(screen, settledThought, columns, "settled resize rerender");
	if (!screen.includes(settledMarker)) fail("settled Thought was not present beside its completed response");
	const promptRows = rowsBelowEditorDivider(screen).filter((line) =>
		line.includes(`THOUGHT_PROBE_${String(columns)}`),
	);
	if (promptRows.length !== 1) {
		fail(
			`${String(columns)}-column latest prompt occupied ${String(promptRows.length)} rows instead of exactly one\n${screen}`,
		);
	}
	verifyTerminalWidth(screen, columns, `settled ${String(columns)}-column Thought`);
	await waitForPersistedThinking(paths.sessions);
}

async function verifyThoughtContextPreservation(session: TmuxPiSession, paths: CasePaths): Promise<void> {
	session.sendLiteral("VERIFY_CONTEXT_REUSE");
	session.sendKey("Enter");
	await session.waitForText("CONTEXT_PRESERVED");
	const records = await waitForFixtureRecords(paths.log, "request", 2);
	const probe = [...records]
		.reverse()
		.find((record) => record.type === "request" && record.lastUser === "VERIFY_CONTEXT_REUSE");
	if (probe?.priorThinkingPreserved !== true) {
		fail("the next real provider request did not retain the original Thinking in model context");
	}
}

async function verifyLiveResize(session: TmuxPiSession): Promise<void> {
	for (const { columns, rows } of [
		{ columns: 64, rows: 28 },
		{ columns: 48, rows: 22 },
		{ columns: 32, rows: 18 },
		{ columns: 24, rows: 16 },
		{ columns: 100, rows: 32 },
	]) {
		session.resize(columns, rows);
		await session.waitForDivider(columns);
		const screen = await session.waitForStatusline();
		verifyFreshScreen(screen, columns, rows);
	}
}

function verifyFullWidthDivider(screen: string, columns: number, label: string): void {
	const divider = screen
		.split("\n")
		.find(
			(line) =>
				line.length > 0 && [...line].every((character) => character === "─") && visibleWidth(line) === columns,
		);
	if (!divider) fail(`${label} did not expose a ${String(columns)}-column divider\n${screen}`);
}

async function verifyCodexDialog(session: TmuxPiSession, paths: CasePaths): Promise<void> {
	const settingsPath = join(paths.config, "pi-stuff-codex.json");
	session.sendKey("C-u");
	session.sendLiteral("/codex");
	session.sendKey("Enter");
	let screen = await session.waitForText("gpt-image-2");
	await session.waitForText("Codex usage is unavailable in offline mode.");
	verifySettingValue(screen, "Fast mode", "off");
	if (hasStatusline(screen)) fail("Statusline remained visible while /codex owned the input region");
	verifyNoFloatingFrame(screen, "/codex Command Dialog");
	verifyFullWidthDivider(screen, 100, "/codex Command Dialog");
	verifyTerminalWidth(screen, 100, "/codex Command Dialog");

	session.resize(64, 28);
	screen = await session.waitForText("gpt-image-2");
	verifyNoFloatingFrame(screen, "narrow /codex Command Dialog");
	verifyFullWidthDivider(screen, 64, "narrow /codex Command Dialog");
	verifyTerminalWidth(screen, 64, "narrow /codex Command Dialog");
	session.resize(100, 32);
	await session.waitForText("gpt-image-2");
	session.sendKey("Escape");
	await session.waitForStatusline();

	session.sendKey("C-u");
	session.sendLiteral("/codex fast");
	session.sendKey("Enter");
	// Pi may use the first Enter to accept the exact argument completion.
	await delay(100);
	session.sendKey("Enter");
	await waitForPersistedSetting(settingsPath, "fast", true);
	session.sendLiteral("/codex");
	session.sendKey("Enter");
	screen = await session.waitForText("gpt-image-2");
	verifySettingValue(screen, "Fast mode", "on");
	session.sendKey("Enter");
	await waitForPersistedSetting(settingsPath, "fast", false);
	screen = await session.waitForText("off");
	verifySettingValue(screen, "Fast mode", "off");
	session.sendKey("Escape");
	await session.waitForStatusline();
}

async function verifyTodoOverlay(
	session: TmuxPiSession,
	options: UiPtyVerificationOptions,
	columns: number,
	rows: number,
): Promise<void> {
	session.sendKey("C-u");
	session.sendLiteral(TODO_PTY_PROMPT);
	session.sendKey("Enter");
	await session.waitForText(TODO_PTY_READY);
	let screen = await session.waitForText("4 tasks (0 done, 4 open)");
	for (const subject of TODO_PTY_SUBJECTS) screen = await session.waitForText(`□ ${subject}`);

	const lines = screen.split("\n");
	const summaryIndex = lines.findIndex((line) => line.includes("4 tasks (0 done, 4 open)"));
	if (summaryIndex < 0 || !lines[summaryIndex]?.startsWith("  4 tasks (0 done, 4 open)")) {
		fail(`Todo summary is not aligned two cells from the output edge\n${screen}`);
	}
	for (const [index, subject] of TODO_PTY_SUBJECTS.entries()) {
		const line = lines[summaryIndex + index + 1];
		if (!line?.startsWith(`   □ ${subject}`)) {
			fail(`Todo row ${String(index + 1)} is not adjacent and aligned beneath its summary\n${screen}`);
		}
	}
	verifyTerminalWidth(screen, columns, "expanded Todo checklist");
	await writePtyEvidence(options.artifactDirectory, `pi-0.83-todo-parity-${String(columns)}x${String(rows)}`, session);
}

async function verifyWideInteractions(
	session: TmuxPiSession,
	paths: CasePaths,
	options: UiPtyVerificationOptions,
): Promise<{ readonly liveThought: boolean }> {
	const settingsPath = join(paths.config, "pi-stuff-ui.json");
	const toolSettingsPath = join(paths.config, "pi-stuff-tools.json");

	await verifyCodexDialog(session, paths);

	let screen = await openUi(session);
	await writePtyEvidence(options.artifactDirectory, "pi-0.83-ui-parity-open-100x32", session);
	session.resize(64, 28);
	screen = await session.waitForText("Tool running timer");
	verifyNoFloatingFrame(screen, "narrow /ui Command Dialog");
	verifyFullWidthDivider(screen, 64, "narrow /ui Command Dialog");
	verifyTerminalWidth(screen, 64, "narrow /ui Command Dialog");
	await writePtyEvidence(options.artifactDirectory, "pi-0.83-ui-parity-open-64x28", session);
	session.resize(100, 32);
	await session.waitForText("Tool running timer");
	session.sendLiteral("welcome");
	screen = await session.waitForText("→ Welcome header");
	if (hasStatusline(screen)) fail("Statusline remained visible while /ui owned the input region");
	if (screen.includes("/tool-settings")) fail("removed /tool-settings appeared in /ui");
	verifyNoFloatingFrame(screen, "/ui Command Dialog");
	verifySettingValue(screen, "Welcome header", true);
	session.sendKey("Enter");
	await waitForPersistedSetting(settingsPath, "welcomeHeader", false);
	screen = await session.waitForText("false");
	verifySettingValue(screen, "Welcome header", false);
	session.sendKey("Escape");
	await session.waitForStatusline();
	await session.waitForText("Welcome back!");

	session.sendLiteral("DRAFT_草稿");
	await session.waitForText("DRAFT_草稿");
	session.sendKey("F12");
	screen = await session.waitForText("DRAFT_SURFACE 中文");
	if (screen.includes("DRAFT_草稿")) fail("Command Dialog did not temporarily remove the saved editor draft");
	if (hasStatusline(screen)) fail("Statusline remained visible in a fixture Command Dialog");
	session.sendKey("Escape");
	await session.waitForText("DRAFT_草稿");
	await session.waitForStatusline();

	session.sendKey("C-u");
	session.sendLiteral("/u");
	screen = await session.waitForText("Configure Pi Stuff UI");
	if (hasStatusline(screen)) fail("Statusline remained visible while native autocomplete was open");
	session.sendKey("Escape");
	await session.waitForStatusline();
	if (!session.capture().includes("/u")) fail("native autocomplete Escape did not preserve the editor draft");

	session.sendKey("C-u");
	session.sendLiteral("prefix /u");
	screen = await session.waitForText("Configure Pi Stuff UI");
	if (hasStatusline(screen)) fail("Statusline remained visible while inline slash autocomplete was open");
	session.sendKey("Escape");
	await session.waitForText("prefix /u");
	await session.waitForStatusline();
	session.sendKey("C-u");

	session.sendLiteral(LONG_PROMPT);
	session.sendKey("Enter");
	const finalThought = expectedThoughtProjection(THOUGHT_PHASES.length - 1, 100);
	await session.waitForText(finalThought);
	const liveThought = true;
	await session.waitForText("UI_PTY_DONE 中文结果🧪");
	await session.waitForText("22%");
	await session.waitForText("$0.42");
	await session.waitForText("~1 ?1");
	screen = await session.waitForAbsence("Welcome back!");
	for (const capabilityStatus of ["goal:UI", "mcp:2", "load:full"]) {
		if (screen.includes(capabilityStatus)) {
			fail(`ordinary Statusline exposed capability-owned status: ${capabilityStatus}`);
		}
	}
	const promptLines = rowsBelowEditorDivider(screen).filter((line) => line.includes(LONG_PROMPT_TOKEN));
	if (promptLines.length !== 1) {
		fail(`long prompt occupied ${String(promptLines.length)} Statusline rows instead of exactly one\n${screen}`);
	}
	if (!promptLines[0]?.startsWith("\uF111 中文")) {
		fail(`wide-character Prompt text did not align with the model text through a stable icon gap\n${screen}`);
	}
	if (!promptLines[0].includes(LONG_PROMPT_PREFIX) || promptLines[0].includes(LONG_PROMPT_SUFFIX)) {
		fail(`long prompt did not retain its beginning and truncate its bounded tail\n${screen}`);
	}
	const status = statuslineRow(screen);
	if (!status) fail(`settled long-prompt screen lost the shared Statusline\n${screen}`);
	const orderedMarkers = [
		NERD_MODEL_MARKER,
		"\uF441",
		"\u{F024B}",
		"\uF418",
		"\uF459",
		"\u{F035B}",
		"\u{F01BC}",
		"\uF0E7",
	];
	let priorMarker = -1;
	for (const marker of orderedMarkers) {
		const markerIndex = status.indexOf(marker);
		if (markerIndex < 0) fail(`wide Statusline is missing accepted segment icon ${marker}\n${screen}`);
		if (markerIndex <= priorMarker) fail(`wide Statusline segment order is incorrect\n${screen}`);
		priorMarker = markerIndex;
	}
	if (status.includes("Fast")) fail("disabled Fast mode left a Statusline segment or gap");
	const history = await session.waitForText(finalThought, true);
	if (history.includes("OWNED_TITLE")) fail("Thought rendering exposed a model-provided terminal control payload");
	verifyTerminalWidth(screen, 100, "settled Thought and long-prompt screen");
	await writePtyEvidence(options.artifactDirectory, "pi-0.83-statusline-parity-metered-100x32", session);
	const request = [...(await readFixtureRecords(paths.log))].reverse().find((record) => record.type === "request");
	if (request?.lastUser !== LONG_PROMPT) fail("fixture did not receive the complete long CJK prompt");

	await verifyTodoOverlay(session, options, 100, 32);

	session.sendKey("F11");
	await session.waitForText("SUBSCRIPTION_MODEL_READY");
	await session.waitForText(SUBSCRIPTION_MODEL);
	await session.waitForText("22%");
	screen = session.capture();
	if (screen.includes("$") || screen.includes("(sub)")) {
		fail("API-key kimi-coding subscription exposed cost or a (sub) label");
	}
	const switchRecords = await waitForFixtureRecords(paths.log, "subscription-switch", 1);
	const subscriptionSwitch = [...switchRecords].reverse().find((record) => record.type === "subscription-switch");
	if (
		subscriptionSwitch?.provider !== "kimi-coding" ||
		subscriptionSwitch.model !== SUBSCRIPTION_MODEL ||
		subscriptionSwitch.selected !== true ||
		subscriptionSwitch.usingOAuth !== false
	) {
		fail(`subscription fixture did not select API-key kimi-coding: ${JSON.stringify(subscriptionSwitch)}`);
	}

	screen = await openFilteredUi(session, "density", "Statusline density");
	verifySettingValue(screen, "Statusline density", "auto");
	session.sendKey("Enter");
	await waitForPersistedSetting(settingsPath, "statuslineDensity", "full");
	screen = await session.waitForText("full");
	verifySettingValue(screen, "Statusline density", "full");
	session.sendKey("Escape");
	await session.waitForStatusline();

	screen = await openFilteredUi(session, "latest prompt", "Latest prompt");
	verifySettingValue(screen, "Latest prompt", true);
	session.sendKey("Enter");
	await waitForPersistedSetting(settingsPath, "statuslineLatestPrompt", false);
	screen = await session.waitForText("false");
	verifySettingValue(screen, "Latest prompt", false);
	session.sendKey("Escape");
	await session.waitForStatusline();

	screen = await openFilteredUi(session, "icons", "Statusline icons");
	verifySettingValue(screen, "Statusline icons", "auto");
	session.sendKey("Enter");
	await waitForPersistedSetting(settingsPath, "statuslineIcons", "nerd");
	session.sendKey("Enter");
	await waitForPersistedSetting(settingsPath, "statuslineIcons", "ascii");
	screen = await session.waitForText("ascii");
	verifySettingValue(screen, "Statusline icons", "ascii");
	session.sendKey("Escape");
	screen = await session.waitForStatusline();
	if (!statuslineRow(screen)?.startsWith(`${ASCII_MODEL_MARKER} `)) {
		fail(`Statusline icon preference did not switch the real Footer to ASCII\n${screen}`);
	}

	screen = await openFilteredUi(session, "inline slash", "Inline slash autocomplete");
	verifySettingValue(screen, "Inline slash autocomplete", true);
	session.sendKey("Enter");
	await waitForPersistedSetting(settingsPath, "inlineSlashAutocomplete", false);
	screen = await session.waitForText("false");
	verifySettingValue(screen, "Inline slash autocomplete", false);
	session.sendKey("Escape");
	await session.waitForAbsence("Type to search");
	await session.waitForStatusline();
	session.sendKey("C-u");
	session.sendLiteral("prefix /u");
	await delay(500);
	screen = session.capture();
	if (screen.includes("Configure Pi Stuff UI")) fail("disabled inline autocomplete still opened suggestions");
	if (!screen.includes("prefix /u") || !hasStatusline(screen)) {
		fail("disabled inline autocomplete did not preserve the editor and Statusline");
	}

	screen = await openFilteredUi(session, "timer", "Tool running timer");
	verifySettingValue(screen, "Tool running timer", true);
	session.sendKey("Enter");
	await waitForPersistedSetting(toolSettingsPath, "liveElapsed", false);
	screen = await session.waitForText("false");
	verifySettingValue(screen, "Tool running timer", false);
	session.sendKey("Escape");
	await session.waitForStatusline();

	screen = await openUi(session);
	verifySettingValue(screen, "Statusline", true);
	if (hasStatusline(screen)) fail("Statusline reappeared behind /ui after a completed model turn");
	session.sendKey("Enter");
	await waitForPersistedSetting(settingsPath, "statusline", false);
	screen = await session.waitForText("false");
	verifySettingValue(screen, "Statusline", false);
	session.sendKey("Escape");
	await session.waitForAbsence("Type to search");
	session.sendLiteral("STATUSLINE_OFF_草稿");
	await session.waitForText("STATUSLINE_OFF_草稿");
	if (hasStatusline(session.capture())) fail("disabled Statusline returned after /ui closed");
	session.stop();

	const restarted = new TmuxPiSession(paths, options, 100, 32);
	try {
		restarted.start();
		await waitForFixtureRecords(paths.log, "inventory", 2);
		await delay(150);
		screen = restarted.capture();
		if (screen.includes("Welcome back!")) fail("persisted Welcome=false was ignored on the next launch");
		if (hasStatusline(screen)) fail("persisted Statusline=false was ignored after restart");
		screen = await openUi(restarted);
		verifySettingValue(screen, "Statusline", false);
		verifySettingValue(screen, "Statusline density", "full");
		verifySettingValue(screen, "Latest prompt", false);
		verifySettingValue(screen, "Statusline icons", "ascii");
		verifySettingValue(screen, "Welcome header", false);
		verifySettingValue(screen, "Input highlighting", true);
		verifySettingValue(screen, "Inline slash autocomplete", false);
		verifySettingValue(screen, "Tool running timer", false);
		restarted.sendKey("Escape");
		await restarted.waitForAbsence("Type to search");
	} finally {
		restarted.stop();
	}

	const persistedMode = (await stat(settingsPath)).mode & 0o777;
	if (persistedMode !== 0o600) fail(`UI settings mode is ${persistedMode.toString(8)}, expected 600`);
	const toolPersistedMode = (await stat(toolSettingsPath)).mode & 0o777;
	if (toolPersistedMode !== 0o600) fail(`Tool settings mode is ${toolPersistedMode.toString(8)}, expected 600`);
	return { liveThought };
}

async function readFixtureRecords(path: string): Promise<readonly FixtureRecord[]> {
	const text = await readFile(path, "utf8");
	return text
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as FixtureRecord);
}

function verifyInventory(records: readonly FixtureRecord[]): boolean {
	const inventory = records.filter((record) => record.type === "inventory");
	if (inventory.length === 0) fail("provider fixture did not observe a real session_start inventory");
	for (const record of inventory) {
		if (!Array.isArray(record.commands)) fail("session inventory did not contain public command names");
		if (!record.commands.includes("ui")) fail("Aggregate did not register /ui");
		if (record.commands.includes("tool-settings")) fail("Aggregate still registered removed /tool-settings");
	}
	if (!inventory.every((record) => record.markdownTransformer === true)) {
		fail("Pi Host did not expose the required upstream Markdown-transform API");
	}
	return true;
}

export async function verifyUiPty(options: UiPtyVerificationOptions): Promise<UiPtyEvidence> {
	verifyHostVersion(options.piBinary);
	await verifyPiHostProvenance(options.piBinary);
	commandOutput("tmux", ["-V"]);
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-ui-pty-"));
	const verified: string[] = [];
	let markdownTransformer = false;
	let liveThought = false;
	try {
		for (const { columns, rows } of TARGET_SIZES) {
			const paths = await createCase(temporaryDirectory, `${String(columns)}x${String(rows)}`);
			const session = new TmuxPiSession(paths, options, columns, rows);
			try {
				session.start();
				await session.waitForText("Welcome back!");
				const fresh = await session.waitForStatusline();
				verifyFreshScreen(fresh, columns, rows);
				await writePtyEvidence(
					options.artifactDirectory,
					`pi-0.83-statusline-parity-fresh-${String(columns)}x${String(rows)}`,
					session,
				);
				const initialRecords = await readFixtureRecords(paths.log);
				const caseMarkdownTransformer = verifyInventory(initialRecords);
				markdownTransformer = caseMarkdownTransformer || markdownTransformer;
				verified.push(`fresh Welcome and Statusline ${String(columns)}x${String(rows)}`);
				if (columns === 100) {
					await verifyLiveResize(session);
					await verifyThoughtLifecycle(session, paths, columns, rows);
					await verifyThoughtContextPreservation(session, paths);
					const result = await verifyWideInteractions(session, paths, options);
					liveThought = result.liveThought;
					verified.push(
						"live resize 100x32 -> 64x28 -> 48x22 -> 32x18 -> 24x16 -> 100x32",
						"priority Statusline fields and responsive prompt bounds at all accepted widths",
						"first, replacing, settled, session-preserved, and context-preserved Thought",
						"native and inline autocomplete suppression and restoration",
						"long CJK prompt, Welcome scroll-away, live and settled Thought",
						"metered and API-key subscription Statusline cost behavior",
						"expanded four-task Todo alignment in a real Aggregate turn",
						"responsive /codex controls, Fast persistence, and offline degradation",
						"eight /ui settings, enum changes, and restart persistence",
						"/ui search, immediate Statusline and Inline changes, Welcome next-launch persistence",
					);
				} else {
					await verifyThoughtLifecycle(session, paths, columns, rows);
					verified.push(`live and settled Thought ${String(columns)}x${String(rows)}`);
					if (columns === 64) {
						await verifyTodoOverlay(session, options, columns, rows);
						verified.push("expanded four-task Todo alignment at 64x28");
					}
				}
			} finally {
				session.stop();
			}
			const records = await readFixtureRecords(paths.log);
			markdownTransformer = verifyInventory(records) || markdownTransformer;
		}
		if (!markdownTransformer || !liveThought) fail("upstream Host live Thought projection was not verified");
		return {
			markdownTransformer,
			sizes: TARGET_SIZES.map(({ columns, rows }) => `${String(columns)}x${String(rows)}`),
			verified,
		};
	} finally {
		await rm(temporaryDirectory, { force: true, recursive: true });
	}
}

if (import.meta.main) {
	const { PI_BIN = "/opt/bin/pi", PI_STUFF_UI_PTY_ARTIFACT_DIR } = process.env;
	const evidence = await verifyUiPty({
		...(PI_STUFF_UI_PTY_ARTIFACT_DIR ? { artifactDirectory: PI_STUFF_UI_PTY_ARTIFACT_DIR } : {}),
		piBinary: PI_BIN,
		packagePath: join(root, "packages/pi-stuff"),
	});
	console.log(`Certified production UI in ${evidence.sizes.join(", ")}`);
	console.log(`Host profile: ${CERTIFIED_PI_HOST_PROFILE}`);
	console.log(`Thought transformer: ${evidence.markdownTransformer ? "upstream Host verified" : "missing"}`);
	for (const item of evidence.verified) console.log(`- ${item}`);
}
