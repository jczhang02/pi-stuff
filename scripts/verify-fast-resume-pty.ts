import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
	createFastResumeCorpus,
	FAST_RESUME_FIXTURE_MODEL,
	FAST_RESUME_FIXTURE_PROVIDER,
	FAST_RESUME_FOLLOWUP_MARKER,
	FAST_RESUME_NEWEST_MARKER,
} from "./fast-resume-pty-corpus.ts";
import { CERTIFIED_PI_VERSION } from "./pi-host-contract.ts";
import { disableSessionNamingForTest } from "./session-naming-test-settings.ts";
import { verifyPiHostProvenance } from "./verify-pi-host-provenance.ts";

const root = resolve(import.meta.dir, "..");
const providerExtension = join(root, "test/fixtures/fast-resume-pty-provider.ts");
const fixtureProvider = FAST_RESUME_FIXTURE_PROVIDER;
const fixtureModel = FAST_RESUME_FIXTURE_MODEL;
const readyMarker = "FAST_RESUME_HOST_READY";
const newestMarker = FAST_RESUME_NEWEST_MARKER;

interface HostRunOptions {
	readonly configDirectory: string;
	readonly cwd: string;
	readonly packagePath?: string;
	readonly piBinary: string;
	readonly rows: number;
	readonly sessionDirectory: string;
	readonly sessionFile: string;
	readonly temporaryDirectory: string;
	readonly theme?: "dark" | "light";
	readonly startupResume?: boolean;
	readonly columns: number;
}

interface HostRun {
	capture(): string;
	captureAnsi(): string;
	keys(...keys: string[]): void;
	literal(value: string): void;
	stop(): Promise<void>;
	waitFor(value: string, timeoutMs?: number): Promise<number>;
}

interface Timing {
	readonly completeMs: number;
}

function fail(message: string): never {
	throw new Error(`Fast Resume PTY verification failed: ${message}`);
}

function command(
	command: readonly string[],
	options: { readonly cwd?: string; readonly env?: Record<string, string> } = {},
): string {
	const result = Bun.spawnSync([...command], {
		cwd: options.cwd ?? root,
		env: options.env ? { ...process.env, ...options.env } : process.env,
		stderr: "pipe",
		stdout: "pipe",
	});
	if (result.exitCode !== 0) {
		fail(`${command.join(" ")} exited ${String(result.exitCode)}: ${result.stderr.toString().trim()}`);
	}
	return result.stdout.toString();
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

async function waitUntil(predicate: () => boolean, timeoutMs: number, description: string): Promise<number> {
	const started = performance.now();
	while (!predicate()) {
		if (performance.now() - started >= timeoutMs) fail(`timed out waiting for ${description}`);
		await Bun.sleep(5);
	}
	return performance.now() - started;
}

async function launchHost(options: HostRunOptions): Promise<HostRun> {
	const id = `fast-resume-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
	const session = "host";
	const gate = join(options.temporaryDirectory, `${id}.gate`);
	const runner = join(options.temporaryDirectory, `${id}.sh`);
	const themeArgs = options.theme
		? ["--theme", join(dirname(options.piBinary), "theme", `${options.theme}.json`), "--use-theme", options.theme]
		: ["--no-themes"];
	const sessionArgs = options.startupResume ? ["--resume"] : ["--session", options.sessionFile];
	const args = [
		"--offline",
		"--approve",
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		...themeArgs,
		"--no-context-files",
		...(options.packagePath ? ["--extension", options.packagePath] : []),
		"--extension",
		providerExtension,
		"--provider",
		fixtureProvider,
		"--model",
		fixtureModel,
		"--session-dir",
		options.sessionDirectory,
		...sessionArgs,
	];
	await writeFile(
		runner,
		[
			"#!/bin/sh",
			"set -eu",
			`while [ ! -e ${shellQuote(gate)} ]; do sleep 0.01; done`,
			`stty rows ${String(options.rows)} columns ${String(options.columns)}`,
			`exec ${shellQuote(options.piBinary)} ${args.map(shellQuote).join(" ")}`,
			"",
		].join("\n"),
		{ mode: 0o700 },
	);
	const runtimeDirectory = join(options.temporaryDirectory, "runtime");
	await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
	const env = {
		PI_CODING_AGENT_DIR: options.configDirectory,
		PI_CODING_AGENT_SESSION_DIR: options.sessionDirectory,
		SHELL: "/bin/sh",
		TERM: "xterm-256color",
		XDG_RUNTIME_DIR: runtimeDirectory,
	};
	command(
		[
			"tmux",
			"-L",
			id,
			"-f",
			"/dev/null",
			"new-session",
			"-d",
			"-x",
			String(options.columns),
			"-y",
			String(options.rows),
			"-s",
			session,
			runner,
		],
		{ cwd: options.cwd, env },
	);
	command(["tmux", "-L", id, "set-option", "-t", session, "remain-on-exit", "on"]);
	command(["tmux", "-L", id, "set-option", "-g", "extended-keys", "on"]);
	command(["tmux", "-L", id, "set-option", "-g", "extended-keys-format", "csi-u"]);
	await writeFile(gate, "ready\n", { mode: 0o600 });
	const tmux = (...args: string[]): string => command(["tmux", "-L", id, ...args]);
	const capture = (): string => tmux("capture-pane", "-p", "-t", session);
	const captureAnsi = (): string => tmux("capture-pane", "-p", "-e", "-t", session);
	const waitFor = async (value: string, timeoutMs = 15_000): Promise<number> => {
		try {
			return await waitUntil(() => capture().includes(value), timeoutMs, value);
		} catch {
			fail(`timed out waiting for ${value}\nScreen:\n${capture()}`);
		}
	};
	const stop = async (): Promise<void> => {
		try {
			tmux("send-keys", "-t", session, "Escape", "C-d");
			await waitUntil(
				() => tmux("display-message", "-p", "-t", session, "#{pane_dead}").trim() === "1",
				1_500,
				"Pi exit",
			);
			tmux("kill-server");
		} catch {
			Bun.spawnSync(["tmux", "-L", id, "kill-server"], { stderr: "ignore", stdout: "ignore" });
		}
	};
	const host: HostRun = {
		capture,
		captureAnsi,
		keys: (...keys) => {
			tmux("send-keys", "-t", session, ...keys);
		},
		literal: (value) => {
			tmux("send-keys", "-t", session, "-l", value);
		},
		stop,
		waitFor,
	};
	await host.waitFor(options.startupResume ? "Resume Session" : readyMarker);
	return host;
}

async function timeResume(options: HostRunOptions): Promise<Timing> {
	const host = await launchHost(options);
	try {
		host.literal("/resume");
		host.keys("Escape");
		const started = performance.now();
		host.keys("Enter");
		await host.waitFor("(1/75)", 10_000);
		const completeMs = performance.now() - started;
		return { completeMs };
	} finally {
		await host.stop();
	}
}

function median(values: readonly number[]): number {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

function p95(values: readonly number[]): number {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.NaN;
}

function corpusBytes(directory: string): number {
	return readdirSync(directory, { withFileTypes: true }).reduce(
		(total, entry) => total + (entry.isFile() ? statSync(join(directory, entry.name)).size : 0),
		0,
	);
}

async function verifyInteractions(options: HostRunOptions): Promise<void> {
	const host = await launchHost(options);
	try {
		host.literal("/resume");
		host.keys("Escape", "Enter");
		await host.waitFor("Resume Session (Current Folder)");
		host.keys("Tab");
		await host.waitFor("Resume Session (All)");
		host.keys("Tab");
		await host.waitFor("Resume Session (Current Folder)");
		host.keys("C-s");
		await host.waitFor("Sort: Recent");
		host.keys("C-s");
		await host.waitFor("Sort: Fuzzy");
		host.keys("C-s", "C-p");
		await host.waitFor("path (on)");
		host.keys("C-n");
		await host.waitFor("Name: Named");
		host.keys("C-n");
		await host.waitFor("Name: All");
		host.literal(FAST_RESUME_FOLLOWUP_MARKER);
		await waitUntil(
			() => !host.capture().includes(newestMarker) && host.capture().includes("Fast Fixture 000"),
			10_000,
			"follow-up message filter",
		);
		host.keys("C-u");
		host.literal(newestMarker);
		await host.waitFor(`> ${newestMarker}`);
		host.keys("Enter");
		await host.waitFor("Resumed session", 15_000);
	} finally {
		await host.stop();
	}
}

async function verifyMutations(options: HostRunOptions, targetPath: string): Promise<void> {
	const host = await launchHost(options);
	try {
		host.literal("/resume");
		host.keys("Escape", "Enter");
		await host.waitFor("Resume Session (Current Folder)");
		host.keys("C-d");
		await host.waitFor("Cannot delete the currently active session");
		if (!existsSync(options.sessionFile)) fail("active Session protection deleted the current Session");
		host.literal(newestMarker);
		await host.waitFor(`> ${newestMarker}`);
		host.keys("C-r");
		await host.waitFor("Rename Session");
		host.literal("FAST_RESUME_RENAMED");
		host.keys("Enter");
		await host.waitFor("Resume Session (Current Folder)");
		await host.waitFor("FAST_RESUME_RENAMED");
		host.keys("C-d");
		await host.waitFor("Delete session?");
		host.keys("Enter");
		await waitUntil(() => !existsSync(targetPath), 10_000, "renamed Session deletion");
		await waitUntil(() => !host.capture().includes("FAST_RESUME_RENAMED"), 10_000, "post-delete refresh");
	} finally {
		await host.stop();
	}
}

async function openFastResume(host: HostRun): Promise<void> {
	host.literal("/resume");
	host.keys("Escape", "Enter");
	await host.waitFor("(1/75)");
}

interface SelectorFrame {
	readonly ansi: string;
	readonly cells: string;
}

function extractSelectorFrame(cells: string, ansi: string, label: string): SelectorFrame {
	const cellLines = cells.split("\n");
	const ansiLines = ansi.split("\n");
	const anchor = cellLines.findIndex(
		(line) =>
			line.includes("Resume Session (") || line.includes("Current Folder |") || line.trimStart().startsWith("› "),
	);
	if (anchor < 0) fail(`could not locate the native Session selector for ${label}\nScreen:\n${cells}`);
	let start = anchor;
	while (start > 0 && !cellLines[start]?.includes("─")) start -= 1;
	if (!cellLines[start]?.includes("─")) start = anchor;
	let end = anchor + 1;
	while (end < cellLines.length && !cellLines[end]?.includes("─")) end += 1;
	if (end >= cellLines.length) fail(`could not isolate the native Session selector frame for ${label}`);
	const normalize = (lines: readonly string[]) =>
		lines
			.slice(start, end + 1)
			.map((line) => line.trimEnd())
			.join("\n");
	return { ansi: normalize(ansiLines), cells: normalize(cellLines) };
}

async function captureSelectorFrame(options: HostRunOptions): Promise<SelectorFrame> {
	const host = await launchHost(options);
	try {
		host.literal("/resume");
		host.keys("Escape", "Enter");
		await host.waitFor(newestMarker);
		const lines = host.capture().split("\n");
		if (lines.some((line) => line.length > options.columns)) {
			fail(`${options.theme ?? "default"} ${options.columns}x${options.rows} selector exceeded width`);
		}
		const label = `${options.packagePath ? "fast" : "native"} ${options.theme ?? "default"} ${String(options.columns)}x${String(options.rows)}`;
		return extractSelectorFrame(host.capture(), host.captureAnsi(), label);
	} finally {
		await host.stop();
	}
}

async function verifyNativeUiParity(
	options: HostRunOptions,
	packagePath: string,
	columns: number,
	rows: number,
	theme: "dark" | "light",
): Promise<void> {
	const geometry = { ...options, columns, rows, theme };
	const native = await captureSelectorFrame(geometry);
	const fast = await captureSelectorFrame({ ...geometry, packagePath });
	if (fast.cells !== native.cells) {
		const nativeLines = native.cells.split("\n");
		const fastLines = fast.cells.split("\n");
		const line = nativeLines.findIndex((value, index) => value !== fastLines[index]);
		fail(
			`${theme} ${columns}x${rows} selector cells differed on line ${String(line + 1)}: native=${JSON.stringify(nativeLines[line])} fast=${JSON.stringify(fastLines[line])}`,
		);
	}
	if (fast.ansi !== native.ansi) fail(`${theme} ${columns}x${rows} selector styling differed from native Pi`);
}
async function submitReload(host: HostRun): Promise<void> {
	host.literal("/reload");
	host.keys("Escape", "Enter");
	await host.waitFor("Reloading keybindings");
	await host.waitFor("Reloaded keybindings");
	await waitUntil(
		() => host.capture().includes("pi-stuff-fast-resume-pty/fixture-model"),
		15_000,
		"reload editor restoration",
	);
}

async function verifyResumeActionAndReload(options: HostRunOptions): Promise<void> {
	const host = await launchHost(options);
	try {
		await submitReload(host);
		await submitReload(host);
		host.keys("C-r");
		await host.waitFor("Resume Session (Current Folder)");
		const occurrences = host.capture().split("Resume Session (Current Folder)").length - 1;
		if (occurrences !== 1) fail(`reload installed ${String(occurrences)} visible Session selectors`);
	} finally {
		await host.stop();
	}
}

async function writeFastResumeSettings(
	configDirectory: string,
	fastResume: { readonly hijackResume: boolean; readonly shortcut?: string },
): Promise<void> {
	await writeFile(join(configDirectory, "pi-stuff.json"), `${JSON.stringify({ fastResume }, null, "\t")}\n`, {
		mode: 0o600,
	});
}

async function verifyReloadSettingChanges(options: HostRunOptions): Promise<void> {
	const host = await launchHost(options);
	try {
		await writeFastResumeSettings(options.configDirectory, { hijackResume: false });
		await submitReload(host);
		host.literal("/resume");
		host.keys("Escape", "Enter");
		await host.waitFor("(1/75)");

		host.keys("Escape");
		await waitUntil(
			() => !host.capture().includes("Resume Session (Current Folder)"),
			5_000,
			"native selector close after setting reload",
		);
		await writeFastResumeSettings(options.configDirectory, { hijackResume: true });
		await submitReload(host);
		await openFastResume(host);
	} finally {
		await host.stop();
	}
}

async function verifyStartupResumeRemainsNative(options: HostRunOptions): Promise<void> {
	const host = await launchHost({ ...options, startupResume: true });
	try {
		await host.waitFor("(1/75)");
	} finally {
		await host.stop();
	}
}

async function verifyStandaloneMode(options: HostRunOptions): Promise<void> {
	const commandHost = await launchHost(options);
	try {
		commandHost.literal("/resume");
		commandHost.keys("Escape", "Enter");
		await commandHost.waitFor("(1/75)");

		commandHost.keys("Escape");
		await waitUntil(
			() => !commandHost.capture().includes("Resume Session (Current Folder)"),
			5_000,
			"native selector close",
		);
		commandHost.literal(`/fast-resume ${newestMarker}`);
		commandHost.keys("Escape", "Enter");
		await commandHost.waitFor("Resume Session (Current Folder)");
		await commandHost.waitFor(newestMarker);
	} finally {
		await commandHost.stop();
	}
	const shortcutHost = await launchHost(options);
	try {
		shortcutHost.keys("M-u");
		await shortcutHost.waitFor("Resume Session (Current Folder)");
	} finally {
		await shortcutHost.stop();
	}
}

async function writeHostConfig(
	directory: string,
	fastResume?: { readonly hijackResume: boolean; readonly shortcut?: string },
): Promise<void> {
	await mkdir(directory, { recursive: true, mode: 0o700 });
	await disableSessionNamingForTest(directory);
	await writeFile(
		join(directory, "settings.json"),
		`${JSON.stringify({ defaultProjectTrust: "always" }, null, "\t")}\n`,
		{ mode: 0o600 },
	);
	await writeFile(
		join(directory, "keybindings.json"),
		`${JSON.stringify({ "app.session.resume": "ctrl+r" }, null, "\t")}\n`,
		{ mode: 0o600 },
	);
	if (fastResume) await writeFastResumeSettings(directory, fastResume);
}

export async function verifyFastResumePty(options: {
	readonly packagePath: string;
	readonly piBinary: string;
}): Promise<void> {
	const version = command([options.piBinary, "--version"]).trim();
	if (version !== CERTIFIED_PI_VERSION) fail(`expected Pi ${CERTIFIED_PI_VERSION}, received ${version || "nothing"}`);
	await verifyPiHostProvenance(options.piBinary);
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-fast-resume-pty-"));
	const configDirectory = join(temporaryDirectory, "config");
	const projectDirectory = join(temporaryDirectory, "project");
	const sessionDirectory = join(temporaryDirectory, "sessions");
	await mkdir(projectDirectory);
	await writeHostConfig(configDirectory);
	try {
		const active = await createFastResumeCorpus(sessionDirectory, projectDirectory, 75, 432_000_000);
		const measuredCorpusBytes = corpusBytes(sessionDirectory);
		const common = {
			configDirectory,
			cwd: projectDirectory,
			piBinary: options.piBinary,
			rows: 40,
			sessionDirectory,
			sessionFile: active,
			temporaryDirectory,
			columns: 120,
		};
		await timeResume(common);
		await timeResume({ ...common, packagePath: options.packagePath });
		const native: Timing[] = [];
		const fast: Timing[] = [];
		for (let index = 0; index < 20; index += 1) {
			if (index % 2 === 0) native.push(await timeResume(common));
			else fast.push(await timeResume({ ...common, packagePath: options.packagePath }));
		}
		const fastComplete = fast.map((item) => item.completeMs);
		if (p95(fastComplete) > 300) fail(`complete Current list P95 was ${p95(fastComplete).toFixed(1)} ms`);
		const packageOptions = { ...common, packagePath: options.packagePath };
		await verifyInteractions(packageOptions);
		await verifyResumeActionAndReload(packageOptions);
		const reloadConfig = join(temporaryDirectory, "config-reload");
		await writeHostConfig(reloadConfig, { hijackResume: true });
		await verifyReloadSettingChanges({ ...packageOptions, configDirectory: reloadConfig });
		await verifyStartupResumeRemainsNative(packageOptions);
		const standaloneConfig = join(temporaryDirectory, "config-standalone");
		await writeHostConfig(standaloneConfig, { hijackResume: false, shortcut: "alt+u" });
		await verifyStandaloneMode({ ...packageOptions, configDirectory: standaloneConfig });
		const mutationDirectory = join(temporaryDirectory, "mutation-sessions");
		const mutationActive = await createFastResumeCorpus(mutationDirectory, projectDirectory, 3, 0);
		await verifyMutations(
			{ ...packageOptions, sessionDirectory: mutationDirectory, sessionFile: mutationActive },
			join(mutationDirectory, "fixture-002.jsonl"),
		);
		const parityDirectory = join(temporaryDirectory, "parity-sessions");
		const parityActive = await createFastResumeCorpus(parityDirectory, projectDirectory, 12, 0);
		const parityOptions = { ...common, sessionDirectory: parityDirectory, sessionFile: parityActive };
		await verifyNativeUiParity(parityOptions, options.packagePath, 120, 40, "dark");
		await verifyNativeUiParity(parityOptions, options.packagePath, 120, 40, "light");
		await verifyNativeUiParity(parityOptions, options.packagePath, 64, 40, "dark");
		await verifyNativeUiParity(parityOptions, options.packagePath, 120, 16, "dark");
		console.log(
			JSON.stringify(
				{
					corpus: { bytes: measuredCorpusBytes, sessions: 75 },
					fast: {
						completeMedianMs: median(fastComplete),
						completeP95Ms: p95(fastComplete),
					},
					native: {
						medianMs: median(native.map((item) => item.completeMs)),
						p95Ms: p95(native.map((item) => item.completeMs)),
					},
					uiParity: { ansiDiffs: 0, cases: 4, cellDiffs: 0 },
				},
				null,
				2,
			),
		);
	} finally {
		await rm(temporaryDirectory, { force: true, recursive: true });
	}
}

if (import.meta.main) {
	const { PI_BIN = "/opt/pi-coding-agent/pi" } = process.env;
	await verifyFastResumePty({ packagePath: join(root, "packages/pi-stuff"), piBinary: PI_BIN });
}
