import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { win32 } from "node:path";

interface ProcessIdentityCommandResult {
	readonly status: number | null;
	readonly stdout: string;
}

export interface ProcessStartIdentityDependencies {
	readonly platform?: NodeJS.Platform;
	readonly readTextFile?: (path: string) => string;
	readonly run?: (command: string, arguments_: readonly string[]) => ProcessIdentityCommandResult;
	readonly systemRoot?: string;
}

function defaultRun(command: string, arguments_: readonly string[]): ProcessIdentityCommandResult {
	const result = spawnSync(command, arguments_, {
		encoding: "utf8",
		maxBuffer: 64 * 1024,
		timeout: 2_000,
		windowsHide: true,
	});
	return { status: result.status, stdout: result.stdout };
}

function normalizedMarker(value: string, maximumLength = 512): string | undefined {
	const normalized = value.trim().replace(/\s+/gu, " ");
	return normalized.length > 0 && normalized.length <= maximumLength ? normalized : undefined;
}

/** Stable operating-system process-birth identity used together with a PID to reject PID reuse. */
export function readProcessStartIdentity(
	pid: number,
	dependencies: ProcessStartIdentityDependencies = {},
): string | undefined {
	if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
	const platform = dependencies.platform ?? process.platform;
	const readTextFile = dependencies.readTextFile ?? ((path: string) => readFileSync(path, "utf8"));
	const run = dependencies.run ?? defaultRun;
	if (platform === "linux") {
		try {
			const bootId = normalizedMarker(readTextFile("/proc/sys/kernel/random/boot_id"), 128);
			const stat = readTextFile(`/proc/${String(pid)}/stat`);
			const commandEnd = stat.lastIndexOf(")");
			if (!bootId || commandEnd === -1) return undefined;
			const startTicks = stat
				.slice(commandEnd + 1)
				.trim()
				.split(/\s+/u)[19];
			return startTicks && /^\d+$/u.test(startTicks) ? `${bootId}:${startTicks}` : undefined;
		} catch {
			return undefined;
		}
	}
	if (platform === "darwin" || platform === "freebsd") {
		try {
			const result = run("/bin/ps", ["-o", "lstart=", "-p", String(pid)]);
			const started = result.status === 0 ? normalizedMarker(result.stdout) : undefined;
			return started ? `${platform}:${started}` : undefined;
		} catch {
			return undefined;
		}
	}
	if (platform === "win32") {
		try {
			const systemRoot = dependencies.systemRoot ?? process.env["SystemRoot"];
			const powershell = systemRoot
				? win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
				: "powershell.exe";
			const result = run(powershell, [
				"-NoLogo",
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				`(Get-Process -Id ${String(pid)} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`,
			]);
			const ticks = result.status === 0 ? normalizedMarker(result.stdout, 32) : undefined;
			return ticks && /^\d+$/u.test(ticks) ? `win32:${ticks}` : undefined;
		} catch {
			return undefined;
		}
	}
	return undefined;
}
