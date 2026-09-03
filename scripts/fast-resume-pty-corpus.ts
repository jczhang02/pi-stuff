import { mkdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const FAST_RESUME_FIXTURE_PROVIDER = "pi-stuff-fast-resume-pty";
export const FAST_RESUME_FIXTURE_MODEL = "fixture-model";
export const FAST_RESUME_NEWEST_MARKER = "FAST_RESUME_BENCHMARK_NEWEST";
export const FAST_RESUME_FOLLOWUP_MARKER = "FAST_RESUME_FOLLOWUP_SEARCH";

function sessionText(
	id: string,
	cwd: string,
	firstMessage: string,
	timestamp: string,
	fillerBytes: number,
	name?: string,
	followupMessage?: string,
): string {
	const lines = [
		JSON.stringify({ type: "session", version: 3, id, timestamp, cwd }),
		JSON.stringify({ type: "message", timestamp, message: { role: "user", content: firstMessage } }),
	];
	if (fillerBytes > 0) {
		lines.push(
			JSON.stringify({
				type: "message",
				timestamp,
				message: {
					role: "assistant",
					content: [{ type: "text", text: "x".repeat(fillerBytes) }],
					api: "openai-completions",
					provider: FAST_RESUME_FIXTURE_PROVIDER,
					model: FAST_RESUME_FIXTURE_MODEL,
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "stop",
					timestamp: Date.parse(timestamp),
				},
			}),
		);
	}
	if (followupMessage) {
		lines.push(
			JSON.stringify({
				type: "message",
				timestamp: new Date(Date.parse(timestamp) + 60_000).toISOString(),
				message: { role: "user", content: followupMessage },
			}),
		);
	}
	if (name) lines.push(JSON.stringify({ type: "session_info", name }));
	return `${lines.join("\n")}\n`;
}

export async function createFastResumeCorpus(
	directory: string,
	cwd: string,
	count: number,
	totalBytes: number,
): Promise<string> {
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const fillerBytes = Math.max(0, Math.floor(totalBytes / Math.max(1, count - 1)) - 512);
	let active = "";
	for (let index = 0; index < count; index += 1) {
		const id = `fixture-${String(index).padStart(3, "0")}`;
		const path = join(directory, `${id}.jsonl`);
		const first =
			index === count - 1 ? FAST_RESUME_NEWEST_MARKER : `FAST_RESUME_FIXTURE_${String(index).padStart(3, "0")}`;
		const name = index === count - 1 ? undefined : `Fast Fixture ${String(index).padStart(3, "0")}`;
		const time = index === 0 ? new Date() : new Date(1_700_000_000_000 + index * 1_000);
		await writeFile(
			path,
			sessionText(
				id,
				cwd,
				first,
				time.toISOString(),
				index === 0 ? 0 : fillerBytes,
				name,
				index === 0 ? FAST_RESUME_FOLLOWUP_MARKER : undefined,
			),
			{ mode: 0o600 },
		);
		await utimes(path, time, time);
		if (index === 0) active = path;
	}
	return active;
}
