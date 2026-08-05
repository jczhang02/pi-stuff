import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, readFileSync } from "node:fs";

function processStartIdentity(pid) {
	if (process.platform === "linux") {
		try {
			const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
			const commandEnd = stat.lastIndexOf(")");
			if (commandEnd === -1) return undefined;
			const startTicks = stat
				.slice(commandEnd + 1)
				.trim()
				.split(/\s+/u)[19];
			return startTicks ? `linux:${startTicks}` : undefined;
		} catch {
			return undefined;
		}
	}
	if (process.platform !== "darwin" && process.platform !== "freebsd") return undefined;
	const result = spawnSync("/bin/ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf-8" });
	const started = result.status === 0 ? result.stdout.trim() : "";
	return started ? `${process.platform}:${started}` : undefined;
}

function signalGroup(pid, signal) {
	if (!Number.isSafeInteger(pid) || pid <= 0) return;
	try {
		process.kill(process.platform === "win32" ? pid : -pid, signal);
	} catch {
		try {
			process.kill(pid, signal);
		} catch {
			// Already gone.
		}
	}
}

function groupExists(pid) {
	if (!Number.isSafeInteger(pid) || pid <= 0) return false;
	try {
		process.kill(process.platform === "win32" ? pid : -pid, 0);
		return true;
	} catch (error) {
		return error && typeof error === "object" && error.code === "EPERM";
	}
}

function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function stdinText() {
	const chunks = [];
	for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks).toString("utf-8");
}

const [, , encoded] = process.argv;
if (!encoded) throw new Error("Pi Stuff Work supervisor requires a launch envelope");
const envelope = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8"));
const command = await stdinText();
const control = createWriteStream(null, { fd: 3 });

const args = [...envelope.shellArgs];
if (envelope.commandTransport !== "stdin") args.push(command);
const child = spawn(envelope.shell, args, {
	cwd: envelope.cwd,
	detached: process.platform !== "win32",
	env: process.env,
	stdio: [envelope.commandTransport === "stdin" ? "pipe" : "ignore", "inherit", "inherit"],
	windowsHide: true,
});

let stopping = false;
let settled = false;
let controlAvailable = true;
let forceTimer;
let parentTimer;

control.on("error", () => {
	controlAvailable = false;
});

function report(value) {
	if (!controlAvailable || control.destroyed) return;
	try {
		control.write(`${JSON.stringify(value)}\n`);
	} catch {
		controlAvailable = false;
	}
}

function stopChild(reason) {
	if (stopping) return;
	stopping = true;
	report({ type: "stopping", reason });
	if (child.pid) signalGroup(child.pid, "SIGTERM");
	forceTimer = setTimeout(() => {
		if (child.pid) signalGroup(child.pid, "SIGKILL");
	}, 1_500);
}

async function settle(code, signal) {
	if (settled) return;
	settled = true;
	if (parentTimer) clearInterval(parentTimer);
	if (forceTimer) clearTimeout(forceTimer);
	if (child.pid && groupExists(child.pid)) {
		signalGroup(child.pid, "SIGTERM");
		await delay(150);
		if (groupExists(child.pid)) signalGroup(child.pid, "SIGKILL");
	}
	report({ type: "exit", code, signal });
	const exitCode = typeof code === "number" ? code : signal ? 128 : 1;
	process.exitCode = exitCode;
	if (controlAvailable && !control.destroyed) control.end();
	setTimeout(() => process.exit(exitCode), 25);
}

function parentStillOwnsUs() {
	return processStartIdentity(envelope.parentPid) === envelope.parentStarted;
}

child.once("spawn", () => {
	if (envelope.commandTransport === "stdin") {
		child.stdin?.on("error", () => {});
		child.stdin?.end(command);
	}
	report({
		type: "started",
		pid: child.pid,
		started: child.pid ? processStartIdentity(child.pid) : undefined,
	});
	if (stopping && child.pid) signalGroup(child.pid, "SIGTERM");
	parentTimer = setInterval(() => {
		if (!parentStillOwnsUs()) stopChild("parent-exited");
	}, 250);
});

child.once("error", (error) => {
	report({ type: "spawn-error", message: error instanceof Error ? error.message : String(error) });
	void settle(null, null);
});

child.once("exit", (code, signal) => {
	void settle(code, signal);
});

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
	process.on(signal, () => stopChild(`supervisor-${signal.toLowerCase()}`));
}

if (!parentStillOwnsUs()) stopChild("parent-exited-before-launch");
