import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
	createFastResumeCorpus,
	FAST_RESUME_FIXTURE_MODEL,
	FAST_RESUME_FIXTURE_PROVIDER,
	FAST_RESUME_NEWEST_MARKER,
} from "./fast-resume-pty-corpus.ts";
import { CERTIFIED_PI_VERSION } from "./pi-host-contract.ts";
import { disableSessionNamingForTest } from "./session-naming-test-settings.ts";

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
	readonly firstMs: number;
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

async function timeResume(options: HostRunOptions, fast: boolean): Promise<Timing> {
	const host = await launchHost(options);
	try {
		host.literal("/resume");
		host.keys("Escape");
		const started = performance.now();
		host.keys("Enter");
		await host.waitFor(fast ? "Fast Resume (Current Folder)" : "(1/75)", 10_000);
		const firstMs = performance.now() - started;
		if (!fast) return { completeMs: firstMs, firstMs };
		await host.waitFor("75 Sessions", 10_000);
		return { completeMs: performance.now() - started, firstMs };
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

async function verifyInteractions(options: HostRunOptions): Promise<void> {
	const host = await launchHost(options);
	try {
		host.literal("/resume");
		host.keys("Escape", "Enter");
		await host.waitFor("Fast Resume (Current Folder)");
		host.keys("C-s");
		await host.waitFor("Sort: Rec");
		host.keys("C-s");
		await host.waitFor("Sort: Fu");
		host.keys("C-s", "C-n", "C-p");
		await host.waitFor("Path on");
		host.literal("re:[");
		await host.waitFor("Invalid regex");
		host.keys("C-u", "C-n");
		await host.waitFor("Name: All");
		host.literal(newestMarker);
		await host.waitFor("1 Sessions");
		host.keys("Enter");
		await host.waitFor(newestMarker, 15_000);
	} finally {
		await host.stop();
	}
}

async function openFastResume(host: HostRun): Promise<void> {
	host.literal("/resume");
	host.keys("Escape", "Enter");
	await host.waitFor("Fast Resume (Current Folder)");
}

async function verifyGeometry(
	options: HostRunOptions,
	columns: number,
	rows: number,
	theme: "dark" | "light",
): Promise<string> {
	const host = await launchHost({ ...options, columns, rows, theme });
	try {
		await openFastResume(host);
		await waitUntil(
			() => host.capture().includes("(1/75)") && !host.capture().includes("Loading"),
			10_000,
			"complete themed Current list",
		);
		const lines = host.capture().split("\n");
		if (lines.some((line) => line.length > columns)) fail(`${theme} ${columns}x${rows} Dialog exceeded width`);
		const ansi = host.captureAnsi();
		if (!ansi.includes("\u001b[")) fail(`${theme} ${columns}x${rows} Dialog had no themed ANSI output`);
		return ansi;
	} finally {
		await host.stop();
	}
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
		await host.waitFor("Fast Resume (Current Folder)");
		const occurrences = host.capture().split("Fast Resume (Current Folder)").length - 1;
		if (occurrences !== 1) fail(`reload installed ${String(occurrences)} visible Fast Resume selectors`);
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
		if (host.capture().includes("Fast Resume (Current Folder)")) fail("reload did not disable resume interception");
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
		if (host.capture().includes("Fast Resume")) fail("interactive --resume was intercepted before Host startup");
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
		if (commandHost.capture().includes("Fast Resume (Current Folder)"))
			fail("disabled hijack still intercepted /resume");
		commandHost.keys("Escape");
		await waitUntil(
			() => !commandHost.capture().includes("Resume Session (Current Folder)"),
			5_000,
			"native selector close",
		);
		commandHost.literal(`/fast-resume ${newestMarker}`);
		commandHost.keys("Escape", "Enter");
		await commandHost.waitFor("Fast Resume (Current Folder)");
		await commandHost.waitFor("1 Sessions");
	} finally {
		await commandHost.stop();
	}
	const shortcutHost = await launchHost(options);
	try {
		shortcutHost.keys("M-u");
		await shortcutHost.waitFor("Fast Resume (Current Folder)");
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
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-fast-resume-pty-"));
	const configDirectory = join(temporaryDirectory, "config");
	const projectDirectory = join(temporaryDirectory, "project");
	const sessionDirectory = join(temporaryDirectory, "sessions");
	await mkdir(projectDirectory);
	await writeHostConfig(configDirectory);
	try {
		const active = await createFastResumeCorpus(sessionDirectory, projectDirectory, 75, 432_000_000);
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
		await timeResume(common, false);
		await timeResume({ ...common, packagePath: options.packagePath }, true);
		const native: Timing[] = [];
		const fast: Timing[] = [];
		for (let index = 0; index < 20; index += 1) {
			if (index % 2 === 0) native.push(await timeResume(common, false));
			else fast.push(await timeResume({ ...common, packagePath: options.packagePath }, true));
		}
		const fastFirst = fast.map((item) => item.firstMs);
		const fastComplete = fast.map((item) => item.completeMs);
		if (p95(fastFirst) > 100) fail(`first selectable list P95 was ${p95(fastFirst).toFixed(1)} ms`);
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
		const darkWide = await verifyGeometry(packageOptions, 120, 40, "dark");
		const lightWide = await verifyGeometry(packageOptions, 120, 40, "light");
		if (darkWide === lightWide) fail("light and dark Host themes produced identical Dialog output");
		await verifyGeometry(packageOptions, 64, 40, "dark");
		await verifyGeometry(packageOptions, 120, 16, "dark");
		console.log(
			JSON.stringify(
				{
					corpus: { bytes: 432_000_000, sessions: 75 },
					fast: {
						completeMedianMs: median(fastComplete),
						completeP95Ms: p95(fastComplete),
						firstMedianMs: median(fastFirst),
						firstP95Ms: p95(fastFirst),
					},
					native: {
						medianMs: median(native.map((item) => item.firstMs)),
						p95Ms: p95(native.map((item) => item.firstMs)),
					},
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
