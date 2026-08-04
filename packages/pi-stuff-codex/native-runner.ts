import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type NativeToolName = "apply_patch" | "imagegen" | "view_image";

export interface NativeToolResult {
	readonly status: number | null;
	readonly stderr: string;
	readonly stdout: string;
}

export interface NativeToolInvocation {
	readonly arguments?: readonly string[] | undefined;
	readonly cwd: string;
	readonly env?: NodeJS.ProcessEnv | undefined;
	readonly input?: string | undefined;
	readonly signal?: AbortSignal | undefined;
	readonly tool: NativeToolName;
}

const BINARY_DIRECTORIES: Readonly<Record<NativeToolName, string>> = {
	apply_patch: "apply-patch",
	imagegen: "imagegen",
	view_image: "view-image",
};
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const PACKAGE_DIRECTORY = dirname(fileURLToPath(import.meta.url));

function binaryName(tool: NativeToolName, platform: NodeJS.Platform): string {
	return platform === "win32" ? `${tool}.exe` : tool;
}

export function resolveNativeBinary(
	tool: NativeToolName,
	target: { readonly arch?: string; readonly platform?: NodeJS.Platform } = {},
): string | undefined {
	const platform = target.platform ?? process.platform;
	const arch = target.arch ?? process.arch;
	const path = join(
		PACKAGE_DIRECTORY,
		"native",
		BINARY_DIRECTORIES[tool],
		`${platform}-${arch}`,
		binaryName(tool, platform),
	);
	return existsSync(path) ? path : undefined;
}

export function parseNativeJson<T>(stdout: string, label: string): T {
	const lines = stdout.trimEnd().split("\n");
	let line: string | undefined;
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		if (lines[index]?.trimStart().startsWith("{")) {
			line = lines[index];
			break;
		}
	}
	if (!line) throw new Error(`${label} returned no structured result.`);
	try {
		return JSON.parse(line) as T;
	} catch {
		throw new Error(`${label} returned invalid structured JSON.`);
	}
}

export function runNativeTool(invocation: NativeToolInvocation): Promise<NativeToolResult> {
	const binary = resolveNativeBinary(invocation.tool);
	if (!binary) {
		return Promise.reject(
			new Error(
				`${invocation.tool} is unavailable on ${process.platform}-${process.arch}; Pi remains usable without this Tool.`,
			),
		);
	}
	if (invocation.signal?.aborted) return Promise.reject(new Error(`${invocation.tool} was cancelled.`));

	return new Promise((resolve, reject) => {
		let settled = false;
		let stdout = "";
		let stderr = "";
		let outputBytes = 0;
		const child = spawn(binary, [...(invocation.arguments ?? [])], {
			cwd: invocation.cwd,
			env: invocation.env ?? process.env,
			stdio: [invocation.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
		});

		const cleanup = (): void => invocation.signal?.removeEventListener("abort", abort);
		const finish = (action: () => void): void => {
			if (settled) return;
			settled = true;
			cleanup();
			action();
		};
		const append = (stream: "stderr" | "stdout", chunk: Buffer | string): void => {
			const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
			outputBytes += Buffer.byteLength(text);
			if (outputBytes > MAX_OUTPUT_BYTES) {
				child.kill();
				finish(() => reject(new Error(`${invocation.tool} output exceeded ${String(MAX_OUTPUT_BYTES)} bytes.`)));
				return;
			}
			if (stream === "stdout") stdout += text;
			else stderr += text;
		};
		const abort = (): void => {
			child.kill();
			finish(() => reject(new Error(`${invocation.tool} was cancelled.`)));
		};

		child.stdout?.setEncoding("utf8");
		child.stderr?.setEncoding("utf8");
		child.stdout?.on("data", (chunk) => append("stdout", chunk));
		child.stderr?.on("data", (chunk) => append("stderr", chunk));
		child.on("error", (error) => {
			finish(() => reject(new Error(`${invocation.tool} could not start: ${error.message}`)));
		});
		child.on("close", (status) => finish(() => resolve({ status, stderr, stdout })));
		invocation.signal?.addEventListener("abort", abort, { once: true });
		if (invocation.input !== undefined) child.stdin?.end(invocation.input);
	});
}
