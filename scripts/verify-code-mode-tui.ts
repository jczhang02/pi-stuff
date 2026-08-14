import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { codeModeHostBinaryPath } from "../packages/pi-stuff/src/code-mode/host/binary.js";
import { CERTIFIED_PI_VERSION } from "./pi-host-contract.js";

const execFileAsync = promisify(execFile);
const PI_BINARY = process.env["PI_BIN"] ?? "/opt/pi-coding-agent/pi";
const TIMEOUT_MS = 30_000;
const SCENARIO_FILTER = process.env["PI_STUFF_CODE_MODE_TUI_SCENARIO"];
const ANSI_ESCAPE = String.fromCharCode(27);
const CONTEXT_USAGE_PATTERN = new RegExp(`((?:󰍛|◔)(?:${ANSI_ESCAPE}\\[[0-9;]*m|\\s)*)\\d+(?:\\.\\d+)?%`, "gu");
const MEDIA_FIXTURE_PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8AAP///0EdNBEAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggKByYdgVHAmQAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyNi0wOC0xMFQwNzozODoyOSswMDowMNCRiLcAAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjYtMDgtMTBUMDc6Mzg6MjkrMDA6MDChzDALAAAAKHRFWHRkYXRlOnRpbWVzdGFtcAAyMDI2LTA4LTEwVDA3OjM4OjI5KzAwOjAw9tkR1AAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==";

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

type Tmux = (args: readonly string[]) => Promise<{ stdout: string }>;

interface ArmCapture {
	readonly activity: string;
	readonly screen: string;
}

async function capture(tmux: Tmux, session: string, styled = false): Promise<string> {
	return (await tmux(["capture-pane", "-p", ...(styled ? ["-e"] : []), "-S", "-", "-t", session])).stdout;
}

async function waitFor(tmux: Tmux, session: string, expected: string): Promise<void> {
	const started = Date.now();
	while (Date.now() - started < TIMEOUT_MS) {
		const text = await capture(tmux, session).catch(() => "");
		if (text.toLowerCase().includes(expected.toLowerCase())) return;
		await Bun.sleep(100);
	}
	throw new Error(
		`TUI did not show ${JSON.stringify(expected)}:\n${await capture(tmux, session).catch(() => "<closed>")}`,
	);
}

function activityBlock(plainScreen: string, styledScreen: string, marker = "read 1 file"): string {
	const plainLines = plainScreen.split("\n");
	const index = plainLines.findIndex((line) => line.toLowerCase().includes(marker));
	if (index < 0) throw new Error(`TUI did not render the multi-Tool Activity row:\n${plainScreen}`);
	const completion = plainLines.findIndex((line, lineIndex) => lineIndex > index && line.includes("VERIFY_COMPLETE"));
	if (completion < 0) throw new Error(`TUI did not render the completion boundary:\n${plainScreen}`);
	return styledScreen.split("\n").slice(index, completion).join("\n").trimEnd();
}

function normalizeRuntimeMetrics(screen: string): string {
	return screen.replace(CONTEXT_USAGE_PATTERN, "$1<context>%");
}

async function assertCertifiedPi(): Promise<void> {
	const version = (await execFileAsync(PI_BINARY, ["--version"])).stdout.trim();
	if (version !== CERTIFIED_PI_VERSION)
		throw new Error(`Code Mode TUI acceptance requires Pi ${CERTIFIED_PI_VERSION}, got ${version || "unknown"}`);
}

async function runArm(
	root: string,
	temporary: string,
	mode: "code" | "direct",
	scenario: "cancel" | "failure" | "group" | "media",
	width: number,
	height: number,
	launchMode: "resume" | "start",
): Promise<ArmCapture> {
	const session = `pi-stuff-code-mode-${scenario}-${mode}-${String(width)}-${String(process.pid)}`;
	const socket = join(temporary, `${session}.sock`);
	const env = {
		COLORTERM: "truecolor",
		PI_CODING_AGENT_DIR: join(temporary, "agent"),
		PI_OFFLINE: "1",
		PI_STUFF_CODE_MODE_DEFAULT: mode === "code" ? "on" : "off",
		PI_STUFF_CODE_MODE_FIXTURE_DIRECT: mode === "direct" ? "1" : "0",
		PI_STUFF_CODE_MODE_FIXTURE_HIDE_RESULT: "1",
		PI_STUFF_CODE_MODE_FIXTURE_LOG: join(temporary, `provider-${scenario}-${mode}-${String(width)}.jsonl`),
		PI_STUFF_CODE_MODE_FIXTURE_SCENARIO: scenario,
		PI_STUFF_CODE_MODE_HOST: codeModeHostBinaryPath(),
		PI_TELEMETRY: "0",
		TERM: "xterm-256color",
		XDG_CACHE_HOME: join(temporary, "cache"),
		XDG_CONFIG_HOME: join(temporary, "config"),
		XDG_DATA_HOME: join(temporary, "data"),
		XDG_STATE_HOME: join(temporary, "state"),
	};
	const scenarioId = scenario === "group" ? "8" : scenario === "failure" ? "9" : scenario === "media" ? "a" : "b";
	const sessionId = `019fdc00-0000-7000-${scenarioId}000-${mode === "code" ? "1" : "2"}${String(width).padStart(11, "0")}`;
	const arguments_ = [
		PI_BINARY,
		"--session-dir",
		join(temporary, "sessions"),
		launchMode === "start" ? "--session-id" : "--session",
		sessionId,
		"--model",
		"pi-stuff-code-mode-fixture/fixture",
		"--tui-mode",
		"fullscreen",
		"--no-extensions",
		"--extension",
		join(root, "packages", "pi-stuff", "index.ts"),
		"--extension",
		join(root, "test", "fixtures", "code-mode-provider.ts"),
		"--no-skills",
		"--no-prompt-templates",
		"--no-context-files",
		"--no-themes",
		"--offline",
		"--approve",
	];
	const command = [
		"env",
		...Object.entries(env).map(([name, value]) => `${name}=${shellQuote(value)}`),
		...arguments_.map(shellQuote),
	].join(" ");
	const tmux = (args: readonly string[]) => execFileAsync("tmux", ["-S", socket, ...args]);
	await tmux([
		"-f",
		"/dev/null",
		"new-session",
		"-d",
		"-s",
		session,
		"-x",
		String(width),
		"-y",
		String(height),
		"-c",
		join(temporary, "project"),
		command,
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
	]);
	const serverOptions = (await tmux(["show-options", "-s"])).stdout;
	if (/^extended-keys-format\b/m.test(serverOptions)) {
		await tmux(["set-option", "-s", "extended-keys-format", "csi-u"]);
	}
	const submit = async (retryFocusHandoff = true): Promise<void> => {
		await tmux(["send-keys", "-t", session, "Enter"]);
		// The first Enter may accept Pi's native slash completion or land while
		// the fullscreen editor is finishing its focus handoff.
		if (retryFocusHandoff) {
			await Bun.sleep(150);
			await tmux(["send-keys", "-t", session, "Enter"]);
		}
	};
	try {
		await waitFor(tmux, session, "Pi Stuff Code Mode fixture");
		await Bun.sleep(750);
		const activityMarker = scenario === "cancel" ? "bash(" : scenario === "media" ? "read 3 files" : "read 1 file";
		if (launchMode === "resume") {
			await waitFor(tmux, session, activityMarker);
			const plain = await capture(tmux, session);
			const styled = await capture(tmux, session, true);
			return { activity: activityBlock(plain, styled, activityMarker), screen: styled };
		}
		await tmux(["send-keys", "-t", session, "-l", "--", "VERIFY_TOOL_UI"]);
		await submit(scenario !== "cancel");
		await waitFor(tmux, session, "VERIFY_COMPLETE");
		const plain = await capture(tmux, session);
		const styled = await capture(tmux, session, true);
		return { activity: activityBlock(plain, styled, activityMarker), screen: styled };
	} finally {
		Bun.spawnSync(["tmux", "-S", socket, "kill-session", "-t", session], {
			stderr: "ignore",
			stdout: "ignore",
		});
	}
}

const root = resolve(import.meta.dir, "..");
const temporary = await mkdtemp(join(tmpdir(), "pi-stuff-code-mode-tui-"));
try {
	await assertCertifiedPi();
	await Promise.all([
		mkdir(join(temporary, "agent"), { recursive: true }),
		mkdir(join(temporary, "project"), { recursive: true }),
		mkdir(join(temporary, "sessions"), { recursive: true }),
	]);
	await writeFile(
		join(temporary, "agent", "settings.json"),
		`${JSON.stringify({ enableInstallTelemetry: false, quietStartup: true, theme: "dark" })}\n`,
	);
	await writeFile(join(temporary, "project", "README.md"), '<div align="center">\nCode Mode fixture\n');
	await writeFile(join(temporary, "project", "pixel.png"), Buffer.from(MEDIA_FIXTURE_PNG, "base64"));
	await writeFile(join(temporary, "project", "pixel-copy.png"), Buffer.from(MEDIA_FIXTURE_PNG, "base64"));
	const scenarios = ["group", "failure", "media", "cancel"] as const;
	if (SCENARIO_FILTER && !scenarios.includes(SCENARIO_FILTER as (typeof scenarios)[number])) {
		throw new Error(`Unknown Code Mode TUI scenario: ${SCENARIO_FILTER}`);
	}
	const selectedScenarios = SCENARIO_FILTER ? scenarios.filter((scenario) => scenario === SCENARIO_FILTER) : scenarios;
	for (const scenario of selectedScenarios.filter((candidate) => candidate !== "cancel")) {
		for (const [width, height] of [
			[100, 32],
			[64, 28],
		] as const) {
			const code = await runArm(root, temporary, "code", scenario, width, height, "start");
			const direct = await runArm(root, temporary, "direct", scenario, width, height, "start");
			if (
				code.activity !== direct.activity ||
				normalizeRuntimeMetrics(code.screen) !== normalizeRuntimeMetrics(direct.screen)
			) {
				throw new Error(
					`Code Mode changed ${scenario} TUI at ${String(width)} columns:\nCODE:\n${code.screen}\nDIRECT:\n${direct.screen}`,
				);
			}
			const resumedCode = await runArm(root, temporary, "code", scenario, width, height, "resume");
			const resumedDirect = await runArm(root, temporary, "direct", scenario, width, height, "resume");
			if (
				resumedCode.activity !== resumedDirect.activity ||
				resumedCode.activity !== code.activity ||
				normalizeRuntimeMetrics(resumedCode.screen) !== normalizeRuntimeMetrics(resumedDirect.screen)
			) {
				throw new Error(
					`Code Mode changed ${scenario} TUI after session resume at ${String(width)} columns:\nCODE:\n${resumedCode.screen}\nDIRECT:\n${resumedDirect.screen}`,
				);
			}
		}
	}
	if (selectedScenarios.includes("cancel")) {
		for (const [width, height] of [
			[100, 32],
			[64, 28],
		] as const) {
			const code = await runArm(root, temporary, "code", "cancel", width, height, "start");
			const direct = await runArm(root, temporary, "direct", "cancel", width, height, "start");
			if (
				code.activity !== direct.activity ||
				normalizeRuntimeMetrics(code.screen) !== normalizeRuntimeMetrics(direct.screen)
			) {
				throw new Error(
					`Code Mode changed cancelled TUI at ${String(width)} columns:\nCODE:\n${code.screen}\nDIRECT:\n${direct.screen}`,
				);
			}
			const resumedCode = await runArm(root, temporary, "code", "cancel", width, height, "resume");
			const resumedDirect = await runArm(root, temporary, "direct", "cancel", width, height, "resume");
			if (
				resumedCode.activity !== resumedDirect.activity ||
				resumedCode.activity !== code.activity ||
				normalizeRuntimeMetrics(resumedCode.screen) !== normalizeRuntimeMetrics(resumedDirect.screen)
			) {
				throw new Error(
					`Code Mode changed cancelled TUI after session resume at ${String(width)} columns:\nCODE:\n${resumedCode.screen}\nDIRECT:\n${resumedDirect.screen}`,
				);
			}
		}
	}
	const reportScenario = selectedScenarios.includes("group") ? "group" : selectedScenarios[0];
	if (!reportScenario) throw new Error("Code Mode TUI acceptance selected no scenarios");
	const firstRequest = async (mode: "code" | "direct") => {
		const line = (await readFile(join(temporary, `provider-${reportScenario}-${mode}-100.jsonl`), "utf8"))
			.trim()
			.split("\n")[0];
		if (!line) throw new Error(`Missing ${mode} provider capture`);
		return JSON.parse(line) as {
			estimatedInputTokens: number;
			messageTokens: number;
			schemaChars: number;
			systemPromptChars: number;
			toolNames: string[];
		};
	};
	const codeRequest = await firstRequest("code");
	const directRequest = await firstRequest("direct");
	if (codeRequest.toolNames.length !== 1 || codeRequest.toolNames[0] !== "codemode") {
		throw new Error(`Code Mode exposed an unexpected provider surface: ${JSON.stringify(codeRequest.toolNames)}`);
	}
	if (codeRequest.schemaChars >= directRequest.schemaChars) {
		throw new Error(
			`Code Mode did not reduce provider Tool schema: ${String(codeRequest.schemaChars)} >= ${String(directRequest.schemaChars)}`,
		);
	}
	if (codeRequest.estimatedInputTokens >= directRequest.estimatedInputTokens) {
		throw new Error(
			`Code Mode did not reduce estimated first-request input: ${String(codeRequest.estimatedInputTokens)} >= ${String(directRequest.estimatedInputTokens)}`,
		);
	}
	if (selectedScenarios.includes("media")) {
		const codeMediaRequests = (await readFile(join(temporary, "provider-media-code-100.jsonl"), "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as { hasResult?: boolean; resultImageCount?: number });
		if (!codeMediaRequests.some((request) => request.hasResult && request.resultImageCount === 2)) {
			throw new Error(
				`Code Mode did not restore both normalized nested images in provider context: ${JSON.stringify(codeMediaRequests)}`,
			);
		}
	}
	const reportPath = process.env["PI_STUFF_CODE_MODE_TUI_REPORT"];
	if (reportPath) {
		await writeFile(reportPath, `${JSON.stringify({ code: codeRequest, direct: directRequest }, null, "\t")}\n`);
	}
	console.log(
		`Real Pi TUI ${selectedScenarios.join("/")} layout and Tool Activity are identical with Code Mode on and off, before and after resume, at 100 and 64 columns (excluding the truthful context-usage value)`,
	);
	console.log(
		`Provider Tool schema: ${String(directRequest.toolNames.length)} Tools / ${String(directRequest.schemaChars)} chars direct -> 1 Tool / ${String(codeRequest.schemaChars)} chars with Code Mode`,
	);
	console.log(
		`Estimated first-request input: ${String(directRequest.estimatedInputTokens)} tokens direct -> ${String(codeRequest.estimatedInputTokens)} tokens with Code Mode`,
	);
} finally {
	if (process.env["PI_STUFF_CODE_MODE_TUI_KEEP_TEMP"] === "1") console.error(`Kept TUI fixture at ${temporary}`);
	else await rm(temporary, { force: true, recursive: true });
}
