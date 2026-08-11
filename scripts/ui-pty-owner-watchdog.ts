import { randomBytes } from "node:crypto";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readProcessStartIdentity } from "../packages/pi-stuff/src/subagents/src/shared/process-identity.js";

const POLL_INTERVAL_MS = 50;
const CLEANUP_TIMEOUT_MS = 2_000;
const OWNER_GONE_CONFIRMATIONS = 5;
const SCRIPT_PATH = fileURLToPath(import.meta.url);

export interface UiPtyOwnerWatchdog {
	readonly leasePath: string;
	readonly pid: number;
	readonly readyPath: string;
}

export type UiPtyOwnerState = "gone" | "match" | "unknown";

interface ProcessProof {
	readonly pid: number;
	readonly processStartIdentity: string;
}

function validPid(value: string | undefined): number | undefined {
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 1 ? parsed : undefined;
}

function processExists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

export function uiPtyOwnerState(
	pid: number,
	processStartIdentity: string,
	readIdentity: (targetPid: number) => string | undefined = readProcessStartIdentity,
	probeExists: (targetPid: number) => boolean = processExists,
): UiPtyOwnerState {
	const current = readIdentity(pid);
	if (current !== undefined) return current === processStartIdentity ? "match" : "gone";
	return probeExists(pid) ? "unknown" : "gone";
}

export function uiPtyOwnerMatches(pid: number, processStartIdentity: string): boolean {
	return uiPtyOwnerState(pid, processStartIdentity) === "match";
}

function tmuxHasSession(socket: string, tmuxBinary: string): boolean {
	return (
		Bun.spawnSync([tmuxBinary, "-S", socket, "has-session"], {
			stderr: "ignore",
			stdout: "ignore",
		}).exitCode === 0
	);
}

function tmuxProcessProof(
	socket: string,
	tmuxBinary: string,
	format: "#{pane_pid}" | "#{pid}",
): ProcessProof | undefined {
	const result = Bun.spawnSync([tmuxBinary, "-S", socket, "display-message", "-p", format], {
		stderr: "ignore",
		stdout: "pipe",
	});
	if (result.exitCode !== 0) return undefined;
	const pid = Number(result.stdout.toString().trim());
	if (!Number.isSafeInteger(pid) || pid <= 1) return undefined;
	const processStartIdentity = readProcessStartIdentity(pid);
	return processStartIdentity ? { pid, processStartIdentity } : undefined;
}

function proofStillMatches(proof: ProcessProof): boolean {
	return readProcessStartIdentity(proof.pid) === proof.processStartIdentity;
}

function signalProvenProcess(proof: ProcessProof, signal: NodeJS.Signals): boolean {
	if (!proofStillMatches(proof)) return false;
	try {
		process.kill(proof.pid, signal);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
		throw error;
	}
}

async function terminateProvenProcess(proof: ProcessProof | undefined): Promise<void> {
	if (!proof || !signalProvenProcess(proof, "SIGTERM")) return;
	const termDeadline = Date.now() + 500;
	while (proofStillMatches(proof) && Date.now() < termDeadline) await Bun.sleep(POLL_INTERVAL_MS);
	if (!proofStillMatches(proof)) return;
	if (!signalProvenProcess(proof, "SIGKILL")) return;
	const killDeadline = Date.now() + 1_000;
	while (proofStillMatches(proof) && Date.now() < killDeadline) await Bun.sleep(POLL_INTERVAL_MS);
	if (proofStillMatches(proof)) throw new Error(`process ${String(proof.pid)} survived UI PTY owner-death cleanup`);
}

async function terminateIsolatedTmux(socket: string, tmuxBinary: string): Promise<void> {
	const server = tmuxProcessProof(socket, tmuxBinary, "#{pid}");
	const pane = tmuxProcessProof(socket, tmuxBinary, "#{pane_pid}");
	const deadline = Date.now() + CLEANUP_TIMEOUT_MS;
	do {
		Bun.spawnSync([tmuxBinary, "-S", socket, "kill-server"], {
			stderr: "ignore",
			stdout: "ignore",
		});
		if (!tmuxHasSession(socket, tmuxBinary)) break;
		await Bun.sleep(POLL_INTERVAL_MS);
	} while (Date.now() < deadline);
	if (tmuxHasSession(socket, tmuxBinary)) await terminateProvenProcess(server);
	await terminateProvenProcess(pane);
	if (tmuxHasSession(socket, tmuxBinary)) {
		throw new Error(`isolated tmux server at ${socket} survived owner-death cleanup`);
	}
	rmSync(socket, { force: true });
}

async function runWatchdog(
	ownerPid: number,
	ownerProcessStartIdentity: string,
	socket: string,
	leasePath: string,
	readyPath: string,
	tmuxBinary: string,
): Promise<void> {
	if (!existsSync(leasePath) || !uiPtyOwnerMatches(ownerPid, ownerProcessStartIdentity)) process.exit(125);
	writeFileSync(readyPath, `${String(process.pid)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });

	let goneOwnerChecks = 0;
	while (existsSync(leasePath)) {
		const ownerState = uiPtyOwnerState(ownerPid, ownerProcessStartIdentity);
		if (ownerState === "gone") {
			goneOwnerChecks += 1;
			if (goneOwnerChecks >= OWNER_GONE_CONFIRMATIONS) {
				await terminateIsolatedTmux(socket, tmuxBinary);
				return;
			}
		} else {
			goneOwnerChecks = 0;
		}
		await Bun.sleep(POLL_INTERVAL_MS);
	}
}

export async function armUiPtyOwnerWatchdog(socket: string, tmuxBinary = "tmux"): Promise<UiPtyOwnerWatchdog> {
	const ownerProcessStartIdentity = readProcessStartIdentity(process.pid);
	if (!ownerProcessStartIdentity) throw new Error("UI PTY verification requires a stable host process identity");
	const token = randomBytes(8).toString("hex");
	const leasePath = `${socket}.owner-${token}.lease`;
	const readyPath = `${socket}.owner-${token}.ready`;
	writeFileSync(leasePath, `${String(process.pid)} ${ownerProcessStartIdentity}\n`, {
		encoding: "utf8",
		flag: "wx",
		mode: 0o600,
	});

	let child: ReturnType<typeof Bun.spawn> | undefined;
	try {
		child = Bun.spawn(
			[
				process.execPath,
				SCRIPT_PATH,
				"--watch",
				String(process.pid),
				ownerProcessStartIdentity,
				socket,
				leasePath,
				readyPath,
				tmuxBinary,
			],
			{ stderr: "ignore", stdin: "ignore", stdout: "ignore" },
		);
		child.unref();
		const deadline = Date.now() + CLEANUP_TIMEOUT_MS;
		while (!existsSync(readyPath) && Date.now() < deadline) {
			if (child.exitCode !== null) throw new Error(`UI PTY owner watchdog exited ${String(child.exitCode)}`);
			await Bun.sleep(POLL_INTERVAL_MS);
		}
		if (!existsSync(readyPath)) throw new Error("UI PTY owner watchdog did not become ready");
		return { leasePath, pid: child.pid, readyPath };
	} catch (error) {
		rmSync(leasePath, { force: true });
		rmSync(readyPath, { force: true });
		if (child?.exitCode === null) child.kill("SIGTERM");
		throw error;
	}
}

export function disarmUiPtyOwnerWatchdog(watchdog: UiPtyOwnerWatchdog | undefined): void {
	if (!watchdog) return;
	rmSync(watchdog.leasePath, { force: true });
	rmSync(watchdog.readyPath, { force: true });
}

if (import.meta.main) {
	const [mode, ownerPidText, ownerProcessStartIdentity, socket, leasePath, readyPath, tmuxBinary] = Bun.argv.slice(2);
	const ownerPid = validPid(ownerPidText);
	if (
		mode !== "--watch" ||
		ownerPid === undefined ||
		!ownerProcessStartIdentity ||
		!socket ||
		!leasePath ||
		!readyPath ||
		!tmuxBinary
	) {
		process.exit(64);
	}
	try {
		await runWatchdog(ownerPid, ownerProcessStartIdentity, socket, leasePath, readyPath, tmuxBinary);
	} finally {
		rmSync(leasePath, { force: true });
		rmSync(readyPath, { force: true });
	}
}
