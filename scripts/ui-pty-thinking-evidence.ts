import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isJsonInputObject, type JsonInputValue, parseJsonValue } from "../packages/pi-stuff/src/shared/json-value.js";
import { isRuntimeFunction } from "../packages/pi-stuff/src/shared/runtime-type.js";
import { FIXTURE_THINKING } from "../test/fixtures/ui-pty-provider.js";
import * as pty from "./ui-pty-session.js";

export const EXPANDED_THINKING_PREFIX = "• thoughts: ";
export const HIDDEN_THINKING_LABEL = "• thoughts";

function containsValue(value: JsonInputValue, target: string): boolean {
	if (value === target) return true;
	if (Array.isArray(value)) return value.some((item) => containsValue(item, target));
	if (!isJsonInputObject(value)) return false;
	return Object.values(value).some((item) => containsValue(item, target));
}

export async function waitForPersistedSessionValue(
	sessionDirectory: string,
	target: string,
	description: string,
): Promise<void> {
	const deadline = Date.now() + pty.WAIT_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const sessionFiles = (await readdir(sessionDirectory)).filter((entry) => entry.endsWith(".jsonl"));
		for (const sessionFile of sessionFiles) {
			const records = (await readFile(join(sessionDirectory, sessionFile), "utf8"))
				.trim()
				.split("\n")
				.filter(Boolean)
				.map(parseJsonValue);
			if (records.some((record) => containsValue(record, target))) return;
		}
		await pty.delay(pty.POLL_INTERVAL_MS);
	}
	pty.fail(`settled session JSONL did not retain ${description}`);
}

export async function verifyThinkingHtmlExport(sessionDirectory: string): Promise<void> {
	const sessionFiles = (await readdir(sessionDirectory)).filter((entry) => entry.endsWith(".jsonl"));
	let sessionFile: string | undefined;
	for (const entry of sessionFiles) {
		const candidate = join(sessionDirectory, entry);
		const records = (await readFile(candidate, "utf8")).trim().split("\n").filter(Boolean).map(parseJsonValue);
		if (records.some((record) => containsValue(record, FIXTURE_THINKING))) {
			sessionFile = candidate;
			break;
		}
	}
	if (!sessionFile) pty.fail("Thinking Session was unavailable for HTML export");

	const piEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
	const exportModule = await import(pathToFileURL(join(dirname(piEntry), "core/export-html/index.js")).href);
	if (!isRuntimeFunction(exportModule.exportFromFile)) pty.fail("certified Pi HTML exporter is unavailable");
	const outputPath = join(sessionDirectory, "thinking-session.html");
	await exportModule.exportFromFile(sessionFile, { outputPath });
	const html = await readFile(outputPath, "utf8");
	const encoded = /<script id="session-data" type="application\/json">([^<]+)<\/script>/u.exec(html)?.[1];
	if (!encoded) pty.fail("Pi HTML export omitted canonical Session data");
	const exportedSession = parseJsonValue(Buffer.from(encoded, "base64").toString("utf8"));
	if (!containsValue(exportedSession, FIXTURE_THINKING)) {
		pty.fail("Pi HTML export did not retain the original Thinking content");
	}
	if (JSON.stringify(exportedSession).includes(EXPANDED_THINKING_PREFIX)) {
		pty.fail("display-only Thinking label leaked into Pi HTML export data");
	}
}

export function normalizeRenderedText(screen: string): string {
	return screen.replaceAll(/\s+/gu, " ").trim();
}

export async function waitForThoughtText(session: pty.TmuxPiSession, text: string, history = false): Promise<string> {
	const deadline = Date.now() + pty.WAIT_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const screen = session.capture(history);
		if (normalizeRenderedText(screen).includes(text)) return screen;
		await pty.delay(pty.POLL_INTERVAL_MS);
	}
	pty.fail(`timed out waiting for rendered Thinking text ${JSON.stringify(text)}`);
}
