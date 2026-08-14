import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, renameSync, watch, writeFileSync } from "node:fs";
import { constants as osConstants } from "node:os";

const DEFAULT_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_OUTPUT_BYTES_ENV = "PI_SUBAGENT_CHILD_PROTOCOL_MAX_BYTES";
const MAX_PROTOCOL_LINE_BYTES = 16 * 1024 * 1024;
const POST_EXIT_OUTPUT_IDLE_MS = 2_000;
const POST_EXIT_OUTPUT_HARD_MS = 8_000;

function processStartIdentity(pid) {
	if (process.platform === "linux") {
		try {
			const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
			const commandEnd = stat.lastIndexOf(")");
			if (commandEnd === -1) return undefined;
			const started = stat.slice(commandEnd + 1).trim().split(/\s+/u)[19];
			return started ? `linux:${started}` : undefined;
		} catch {
			return undefined;
		}
	}
	if (process.platform !== "darwin" && process.platform !== "freebsd") return undefined;
	const result = spawnSync("/bin/ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf-8" });
	const started = result.status === 0 ? result.stdout.trim() : "";
	return started ? `${process.platform}:${started}` : undefined;
}

function processExists(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error && typeof error === "object" && error.code === "EPERM";
	}
}

function linuxGroupMembers() {
	if (process.platform !== "linux") return [];
	const members = [];
	for (const entry of readdirSync("/proc", { withFileTypes: true })) {
		if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) continue;
		const pid = Number(entry.name);
		if (pid === process.pid) continue;
		try {
			const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
			const commandEnd = stat.lastIndexOf(")");
			if (commandEnd === -1) continue;
			const fields = stat.slice(commandEnd + 1).trim().split(/\s+/u);
			if (Number(fields[2]) !== process.pid) continue;
			const started = fields[19];
			if (started) members.push({ pid, started: `linux:${started}` });
		} catch (error) {
			// ENOENT means this particular process exited between readdir and stat.
			// Any other failure makes the whole group scan inconclusive.
			if (!error || typeof error !== "object" || (error.code !== "ENOENT" && error.code !== "ESRCH")) throw error;
		}
	}
	return members;
}

function bsdGroupMembers() {
	if (process.platform !== "darwin" && process.platform !== "freebsd") return [];
	const result = spawnSync("/bin/ps", ["-axo", "pid=,pgid=,lstart="], {
		encoding: "utf-8",
		maxBuffer: 8 * 1024 * 1024,
	});
	if (result.error || result.status !== 0) {
		throw result.error ?? new Error(`Unable to inspect Agent writer process group (ps exited ${String(result.status)}).`);
	}
	const members = [];
	for (const line of result.stdout.split(/\r?\n/u)) {
		const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/u.exec(line);
		if (!match) continue;
		const pid = Number(match[1]);
		const pgid = Number(match[2]);
		const started = match[3];
		if (pid === process.pid || pgid !== process.pid || !started) continue;
		members.push({ pid, started: `${process.platform}:${started}` });
	}
	return members;
}

function groupMembers() {
	if (process.platform === "linux") return linuxGroupMembers();
	if (process.platform === "darwin" || process.platform === "freebsd") return bsdGroupMembers();
	return child?.pid && childStarted ? [{ pid: child.pid, started: childStarted }] : [];
}

function signalMembers(signal, source) {
	let members;
	try {
		members = groupMembers();
	} catch {
		return false;
	}
	for (const member of members) {
		if (processStartIdentity(member.pid) !== member.started) continue;
		try {
			process.kill(member.pid, signal);
			rememberManagerSignal(member, signal, source);
		} catch {
			// The member may exit after the final identity check.
		}
	}
	return true;
}

function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function maxOutputBytes() {
	const parsed = Number(process.env[MAX_OUTPUT_BYTES_ENV]);
	return Number.isFinite(parsed) && parsed >= 1
		? Math.min(Math.floor(parsed), Number.MAX_SAFE_INTEGER - 1)
		: DEFAULT_MAX_OUTPUT_BYTES;
}

function projectProtocolLine(line) {
	let event;
	try {
		event = JSON.parse(line.toString("utf8"));
	} catch {
		return line;
	}
	if (!event || typeof event !== "object" || Array.isArray(event) || typeof event.type !== "string") return line;
	if (event.type === "message_start" || event.type === "message_update" || event.type === "turn_end") {
		return Buffer.from(JSON.stringify({ type: event.type }));
	}
	if (event.type === "agent_end") {
		return Buffer.from(JSON.stringify({ type: event.type, ...(event.willRetry === true ? { willRetry: true } : {}) }));
	}
	if (event.type === "tool_execution_update" || event.type === "tool_execution_end") {
		return Buffer.from(
			JSON.stringify({
				type: event.type,
				...(typeof event.toolCallId === "string" ? { toolCallId: event.toolCallId } : {}),
				...(typeof event.toolName === "string" ? { toolName: event.toolName } : {}),
				...(typeof event.isError === "boolean" ? { isError: event.isError } : {}),
			}),
		);
	}
	return line;
}

function createBoundedPipeForwarder(source, destination, onLimit, projectProtocol = false) {
	const limitBytes = maxOutputBytes();
	const lineLimitBytes = Math.min(MAX_PROTOCOL_LINE_BYTES, limitBytes);
	let observedBytes = 0;
	let forwardedBytes = 0;
	let limitReported = false;
	let lastReadAt = Date.now();
	const forward = async (chunk) => {
		observedBytes += chunk.length;
		if (observedBytes > limitBytes && !limitReported) {
			limitReported = true;
			onLimit(observedBytes);
		}
		// Forward one byte beyond the configured bound so the runner's own
		// protocol authority deterministically observes overflow. Continue
		// draining and discarding after that point so neither memory nor disk is
		// an unbounded buffer while the process group is being reaped.
		const remaining = Math.max(0, limitBytes + 1 - forwardedBytes);
		if (remaining === 0) return;
		const forwarded = chunk.subarray(0, Math.min(chunk.length, remaining));
		forwardedBytes += forwarded.length;
		await new Promise((resolve, reject) => {
			destination.write(forwarded, (error) => {
				if (error) reject(error);
				else resolve();
			});
		});
	};
	const done = (async () => {
		if (!projectProtocol) {
			for await (const value of source) {
				lastReadAt = Date.now();
				await forward(Buffer.isBuffer(value) ? value : Buffer.from(value));
			}
			return;
		}

		let pending = [];
		let pendingBytes = 0;
		const flushLine = async (terminated) => {
			const line = pendingBytes > 0 ? Buffer.concat(pending, pendingBytes) : Buffer.alloc(0);
			pending = [];
			pendingBytes = 0;
			const projected = projectProtocolLine(line);
			await forward(terminated ? Buffer.concat([projected, Buffer.from("\n")], projected.length + 1) : projected);
		};
		const append = async (segment) => {
			if (segment.length === 0) return true;
			const nextBytes = pendingBytes + segment.length;
			if (nextBytes <= lineLimitBytes) {
				pending.push(segment);
				pendingBytes = nextBytes;
				return true;
			}
			const accepted = Math.max(0, lineLimitBytes + 1 - pendingBytes);
			if (accepted > 0) {
				pending.push(segment.subarray(0, accepted));
				pendingBytes += accepted;
			}
			limitReported = true;
			onLimit(nextBytes);
			await forward(Buffer.concat(pending, pendingBytes));
			pending = [];
			pendingBytes = 0;
			return false;
		};

		for await (const value of source) {
			lastReadAt = Date.now();
			if (limitReported) continue;
			const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
			let start = 0;
			for (let index = 0; index < chunk.length; index++) {
				if (chunk[index] !== 0x0a) continue;
				if (!(await append(chunk.subarray(start, index)))) break;
				await flushLine(true);
				start = index + 1;
			}
			if (!limitReported) await append(chunk.subarray(start));
		}
		if (!limitReported && pendingBytes > 0) await flushLine(false);
	})();
	return {
		close() {
			try {
				source.destroy();
			} catch {
				// The read side may already be terminal.
			}
		},
		done,
		lastReadAt: () => lastReadAt,
	};
}

function armPostExitOutputDrain(forwarders) {
	const exitedAt = Date.now();
	const hardDeadline = exitedAt + POST_EXIT_OUTPUT_HARD_MS;
	let cancelled = false;
	let timer;
	void (async () => {
		for (;;) {
			if (cancelled) return;
			const now = Date.now();
			const lastActivity = Math.max(exitedAt, ...forwarders.map((forwarder) => forwarder.lastReadAt()));
			if (now >= hardDeadline || now - lastActivity >= POST_EXIT_OUTPUT_IDLE_MS) {
				for (const forwarder of forwarders) forwarder.close();
				return;
			}
			await new Promise((resolve) => {
				timer = setTimeout(
					resolve,
					Math.min(100, hardDeadline - now, POST_EXIT_OUTPUT_IDLE_MS - (now - lastActivity)),
				);
				timer.unref?.();
			});
		}
	})();
	return () => {
		cancelled = true;
		if (timer) clearTimeout(timer);
	};
}

function createControlChannel(input) {
	const lines = [];
	const waiters = [];
	let buffer = "";
	let ended = false;
	const deliver = () => {
		while (lines.length > 0 && waiters.length > 0) {
			const resolve = waiters.shift();
			resolve({ done: false, value: lines.shift() });
		}
		if (!ended) return;
		while (waiters.length > 0) waiters.shift()({ done: true, value: undefined });
	};
	const finish = () => {
		if (ended) return;
		ended = true;
		if (buffer) lines.push(buffer);
		buffer = "";
		deliver();
	};
	input.setEncoding("utf8");
	input.on("data", (chunk) => {
		if (ended) return;
		buffer += chunk;
		if (buffer.length > 4_096) {
			finish();
			return;
		}
		for (;;) {
			const newline = buffer.indexOf("\n");
			if (newline < 0) break;
			lines.push(buffer.slice(0, newline).replace(/\r$/u, ""));
			buffer = buffer.slice(newline + 1);
		}
		deliver();
	});
	input.once("end", finish);
	input.once("close", finish);
	input.once("error", finish);
	input.resume();
	return {
		next() {
			if (lines.length > 0) return Promise.resolve({ done: false, value: lines.shift() });
			if (ended) return Promise.resolve({ done: true, value: undefined });
			return new Promise((resolve) => waiters.push(resolve));
		},
		close() {
			finish();
			input.pause();
			input.destroy();
		},
	};
}

function createFileControlChannel(filePath, token, parentPid, parentStarted) {
	let lineCursor = 0;
	let lastSequence = 0;
	let closed = false;
	let changed = true;
	let wake;
	let watcher;
	try {
		watcher = watch(filePath, () => {
			changed = true;
			wake?.();
			wake = undefined;
		});
	} catch {
		// The bounded liveness fallback below also observes appended commands.
	}
	const waitForChange = async () => {
		if (changed) {
			changed = false;
			return;
		}
		await Promise.race([
			new Promise((resolve) => {
				wake = resolve;
			}),
			delay(250),
		]);
		wake = undefined;
	};
	const invalid = () => {
		closed = true;
		watcher?.close();
		return { done: false, value: "invalid" };
	};
	return {
		async next() {
			while (!closed) {
				if (processStartIdentity(parentPid) !== parentStarted) return { done: true, value: undefined };
				try {
					const content = readFileSync(filePath, "utf8");
					if (content.length > 64 * 1024) return invalid();
					const lines = content.split("\n");
					const completeLineCount = lines.length - 1;
					while (lineCursor < completeLineCount) {
						const line = lines[lineCursor++];
						let record;
						try {
							record = JSON.parse(line);
						} catch {
							return invalid();
						}
						if (
							record?.version !== 1 ||
							record.token !== token ||
							!Number.isSafeInteger(record.sequence) ||
							record.sequence <= lastSequence ||
							typeof record.command !== "string"
						) {
							return invalid();
						}
						lastSequence = record.sequence;
						return { done: false, value: record.command };
					}
				} catch (error) {
					if (!error || typeof error !== "object" || error.code !== "ENOENT") {
						return invalid();
					}
				}
				await waitForChange();
			}
			return { done: true, value: undefined };
		},
		close() {
			closed = true;
			watcher?.close();
			wake?.();
			wake = undefined;
		},
	};
}

async function captureStartIdentity(pid, timeoutMs = 250) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const identity = processStartIdentity(pid);
		if (identity) return identity;
		if (!processExists(pid) || Date.now() >= deadline) return undefined;
		await delay(20);
	}
}

const encoded = process.argv[2];
if (!encoded) throw new Error("Agent writer supervisor requires a launch envelope.");
const envelope = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8"));
const controlLines =
	typeof envelope.controlPath === "string" && typeof envelope.controlToken === "string"
		? createFileControlChannel(
				envelope.controlPath,
				envelope.controlToken,
				envelope.parentPid,
				envelope.parentStarted,
			)
		: createControlChannel(process.stdin);
const controlIterator = controlLines;
const startupControl = await controlIterator.next();
if (startupControl.done || startupControl.value.trim() !== "proceed") process.exit(125);
if (processStartIdentity(envelope.parentPid) !== envelope.parentStarted) process.exit(125);

let child;
let childStarted;
let childExit;
let childOutputForwarding = Promise.resolve();
let childOutputError;
let terminationSignal;
let pendingStop;
let settled = false;
let parentTimer;
let terminationForceTimer;
let finalizationForceTimer;
let finalizationActive = false;
const managerSignalsByMember = new Map();

function memberKey(member) {
	return `${member.pid}:${member.started}`;
}

function rememberManagerSignal(member, signal, source) {
	const key = memberKey(member);
	const signals = managerSignalsByMember.get(key) ?? new Map();
	const sources = signals.get(signal) ?? new Set();
	sources.add(source);
	signals.set(signal, sources);
	managerSignalsByMember.set(key, signals);
}

function forgetManagerSignalSource(source) {
	for (const [key, signals] of managerSignalsByMember) {
		for (const [signal, sources] of signals) {
			sources.delete(source);
			if (sources.size === 0) signals.delete(signal);
		}
		if (signals.size === 0) managerSignalsByMember.delete(key);
	}
}

function managerSignalSourceForChild(signal) {
	if (!child?.pid || !childStarted || typeof signal !== "string") return undefined;
	const sources = managerSignalsByMember
		.get(memberKey({ pid: child.pid, started: childStarted }))
		?.get(signal);
	// Same-signal deliveries cannot be causally disambiguated from the eventual
	// exit tuple. Fail closed: if an external delivery ever preceded or raced a
	// manager delivery to this exact process identity, preserve it as a crash.
	if (sources?.has("external")) return "external";
	if (sources?.has("termination")) return "termination";
	if (sources?.has("finalization")) return "finalization";
	return undefined;
}

function signalFromExitCode(code) {
	if (typeof code !== "number" || code <= 128 || code > 255) return undefined;
	const signalNumber = code - 128;
	return Object.entries(osConstants.signals).find(([, value]) => value === signalNumber)?.[0];
}

function writeTerminalDisposition(value) {
	if (typeof envelope.dispositionPath !== "string" || !envelope.dispositionPath) return;
	const temporary = `${envelope.dispositionPath}.${process.pid}.${randomUUID()}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf-8", mode: 0o600, flag: "wx" });
	renameSync(temporary, envelope.dispositionPath);
}

function writeGroupMemberProof() {
	if (
		typeof envelope.groupMemberProofPath !== "string" ||
		!envelope.groupMemberProofPath ||
		!child?.pid ||
		!childStarted
	) {
		return;
	}
	const leaderStarted = processStartIdentity(process.pid);
	if (!leaderStarted) throw new Error("Agent writer supervisor lost its process-start identity.");
	const temporary = `${envelope.groupMemberProofPath}.${process.pid}.${randomUUID()}.tmp`;
	writeFileSync(
		temporary,
		`${JSON.stringify({
			version: 1,
			groupLeaderPid: process.pid,
			groupLeaderProcessStartIdentity: leaderStarted,
			memberPid: child.pid,
			memberProcessStartIdentity: childStarted,
		})}\n`,
		{ encoding: "utf-8", mode: 0o600, flag: "wx" },
	);
	renameSync(temporary, envelope.groupMemberProofPath);
}

function requestStop(signal, source = "termination") {
	const childSignal = signal === "SIGINT" ? "SIGINT" : "SIGTERM";
	if (source === "termination" && !terminationSignal) terminationSignal = childSignal;
	if (!child?.pid || !childStarted) {
		// A bare signal can arrive after the supervisor installs handlers but
		// before the child identity is captured. Preserve it and fail closed;
		// otherwise the subsequently spawned Pi process would run un-stopped.
		if (!pendingStop || source === "external") pendingStop = { signal: childSignal, source };
		return;
	}
	finalizationActive = false;
	if (finalizationForceTimer) clearTimeout(finalizationForceTimer);
	finalizationForceTimer = undefined;
	forgetManagerSignalSource("finalization");
	signalMembers(childSignal, source);
	if (!terminationForceTimer) {
		terminationForceTimer = setTimeout(() => signalMembers("SIGKILL", source), 3_000);
		terminationForceTimer.unref?.();
	}
}

function requestFinalization() {
	if (terminationSignal || finalizationActive || settled) return;
	finalizationActive = true;
	signalMembers("SIGTERM", "finalization");
	finalizationForceTimer = setTimeout(() => {
		finalizationForceTimer = undefined;
		if (finalizationActive && !settled) signalMembers("SIGKILL", "finalization");
	}, 3_000);
	finalizationForceTimer.unref?.();
}

function cancelFinalization() {
	if (terminationSignal || settled) return;
	finalizationActive = false;
	if (finalizationForceTimer) clearTimeout(finalizationForceTimer);
	finalizationForceTimer = undefined;
	// Cancellation stops the future hard-kill, but cannot erase a SIGTERM that
	// was already delivered to this exact process identity. Retaining that
	// causal history distinguishes a delayed response to our signal from an
	// unrelated external signal of a different kind.
}

async function consumeControls() {
	for (;;) {
		const next = await controlIterator.next();
		if (next.done) return;
		const command = next.value.trim();
		if (command === "finalize") requestFinalization();
		else if (command === "cancel-finalize") cancelFinalization();
		else if (command === "terminate-sigint") requestStop("SIGINT", "termination");
		else if (command === "terminate-sigterm") requestStop("SIGTERM", "termination");
		else requestStop("SIGTERM", "external");
	}
}

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
	// Only the private stdin control channel grants manager provenance. A bare
	// OS signal may come from a user, OOM supervisor, or unrelated process and
	// must remain an external crash even though we still reap the child safely.
	process.on(signal, () => requestStop(signal, "external"));
}

async function reapMembers() {
	let termRequested = false;
	let nextKillAt = 0;
	for (;;) {
		let members;
		try {
			members = groupMembers();
		} catch {
			// Never turn a transient group scan failure into false proof of exit.
			// The live supervisor remains the authenticated PGID anchor and retries.
			await delay(250);
			continue;
		}
		if (members.length === 0) return true;
		if (!termRequested) {
			signalMembers("SIGTERM", "reap");
			termRequested = true;
			await delay(150);
			continue;
		}
		if (Date.now() >= nextKillAt) {
			signalMembers("SIGKILL", "reap");
			nextKillAt = Date.now() + 1_000;
		}
		await delay(100);
	}
}

async function settle(code, signal) {
	if (settled) return;
	settled = true;
	if (parentTimer) clearInterval(parentTimer);
	if (terminationForceTimer) clearTimeout(terminationForceTimer);
	if (finalizationForceTimer) clearTimeout(finalizationForceTimer);
	controlLines.close();
	// `readline.close()` stops line parsing but does not close the inherited pipe.
	// Keeping that stdin handle referenced prevents Bun/Node from exiting after
	// the writer has settled, so the parent runner never observes `close`.
	if (typeof envelope.controlPath !== "string") {
		process.stdin.pause();
		process.stdin.destroy();
	}
	const reaped = await reapMembers();
	await childOutputForwarding;
	const observedSignal = signal ?? signalFromExitCode(code);
	// Preserve an unexpected external signal. A prior manager SIGTERM does not
	// authorize us to relabel a later external SIGKILL as manager-owned. Only a
	// signal actually sent to this exact child process identity establishes that
	// provenance; when it does, report the initiating manager signal so the
	// parent can recognize its own final-drain sequence.
	const managerSource = managerSignalSourceForChild(observedSignal);
	const signalCode =
		managerSource === "termination"
			? (terminationSignal ?? observedSignal)
			: managerSource === "finalization"
				? "SIGTERM"
				: observedSignal;
	const signalNumber = typeof signalCode === "string" ? osConstants.signals[signalCode] : undefined;
	try {
		writeTerminalDisposition({
			version: 1,
			supervisorPid: process.pid,
			supervisorProcessStartIdentity: processStartIdentity(process.pid),
			childPid: child?.pid,
			childProcessStartIdentity: childStarted,
			exitCode: typeof code === "number" ? code : null,
			// Keep the child's raw exit tuple authoritative. `observedSignal` may be
			// inferred from an explicit 128+N exit code solely for provenance.
			signal: signal ?? null,
			origin:
				managerSource === "termination"
					? "manager-request"
					: managerSource === "finalization"
						? "manager-final-drain"
						: observedSignal
							? "external"
							: null,
			reaped,
			...(childOutputError
				? {
						outputForwardingError: String(
							childOutputError instanceof Error ? childOutputError.message : childOutputError,
						).slice(0, 1_000),
					}
				: {}),
		});
	} catch (error) {
		process.stderr.write(
			`Agent writer supervisor failed to persist terminal disposition: ${error instanceof Error ? error.message : String(error)}\n`,
		);
	}
	const supervisorExitCode =
		!reaped || childOutputError ? 1 : signalNumber ? 128 + signalNumber : typeof code === "number" ? code : 1;
	// Let inherited stdout/stderr drain after the child exit. Calling
	// `process.exit()` here can close the shared pipe before a fast Pi writer's
	// final JSON frames reach the parent runner.
	process.exitCode = supervisorExitCode;
}

try {
	child = spawn(envelope.command, envelope.args, {
		cwd: process.cwd(),
		detached: false,
		env: process.env,
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	});
	if (!child.stdout || !child.stderr) throw new Error("Agent writer supervisor failed to open child output pipes.");
	let outputForwarders = [];
	let childExitTuple;
	let cancelPostExitDrain = () => {};
	childExit = new Promise((resolve) => {
		child.once("error", (error) => {
			cancelPostExitDrain();
			cancelPostExitDrain = armPostExitOutputDrain(outputForwarders);
			resolve({ code: 1, error, signal: null });
		});
		// Start a bounded drain only after process exit. A normal child reaches
		// `close` immediately and retains every final output byte; an escaped
		// descendant that inherited the pipes cannot block completion forever.
		child.once("exit", (code, signal) => {
			childExitTuple = { code, signal };
			cancelPostExitDrain();
			cancelPostExitDrain = armPostExitOutputDrain(outputForwarders);
		});
		child.once("close", (code, signal) => {
			cancelPostExitDrain();
			resolve(childExitTuple ?? { code, signal });
		});
	});
	const stdoutForwarder = createBoundedPipeForwarder(
		child.stdout,
		process.stdout,
		() => requestStop("SIGTERM", "termination"),
		true,
	);
	const stderrForwarder = createBoundedPipeForwarder(child.stderr, process.stderr, () =>
		requestStop("SIGTERM", "termination"),
	);
	outputForwarders = [stdoutForwarder, stderrForwarder];
	childOutputForwarding = Promise.all([stdoutForwarder.done, stderrForwarder.done]).then(
		() => undefined,
		(error) => {
			childOutputError = error;
			requestStop("SIGTERM", "external");
		},
	);
	childStarted = child.pid ? await captureStartIdentity(child.pid) : undefined;
	if (!child.pid || !childStarted) {
		try {
			child.kill("SIGKILL");
		} catch {}
		await settle(1, "SIGKILL");
	} else {
		writeGroupMemberProof();
		void consumeControls();
		if (pendingStop) {
			const stop = pendingStop;
			pendingStop = undefined;
			requestStop(stop.signal, stop.source);
		} else if (terminationSignal) requestStop(terminationSignal);
		parentTimer = setInterval(() => {
			if (processStartIdentity(envelope.parentPid) !== envelope.parentStarted) requestStop("SIGTERM", "external");
		}, 250);
			parentTimer.unref?.();
			const result = await childExit;
		if (result.error) process.stderr.write(`Agent writer spawn failed: ${result.error.message}\n`);
		await settle(result.code, result.signal);
	}
} catch (error) {
	process.stderr.write(`Agent writer supervisor failed: ${error instanceof Error ? error.message : String(error)}\n`);
	await settle(1, null);
}
