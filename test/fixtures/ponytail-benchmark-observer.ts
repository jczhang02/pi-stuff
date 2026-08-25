import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CONTRIBUTION_START = "<!-- pi-stuff:prompt-contribution:ponytail:start -->";
const CONTRIBUTION_END = "<!-- pi-stuff:prompt-contribution:ponytail:end -->";
const PONYTAIL_SKILL = /<name>ponytail(?:-[^<]+)?<\/name>/gu;

function count(text: string, marker: string): number {
	return text.split(marker).length - 1;
}

export default function ponytailBenchmarkObserver(pi: ExtensionAPI): void {
	pi.on("before_provider_request", (event) => {
		const logPath = process.env["PI_STUFF_PONYTAIL_BENCHMARK_LOG"];
		if (!logPath) return;
		const payload = JSON.stringify(event.payload);
		const start = payload.indexOf(CONTRIBUTION_START);
		const end = start < 0 ? -1 : payload.indexOf(CONTRIBUTION_END, start);
		const contribution = start < 0 || end < 0 ? "" : payload.slice(start, end + CONTRIBUTION_END.length);
		appendFileSync(
			logPath,
			`${JSON.stringify({
				type: "provider-request",
				markerCount: count(payload, CONTRIBUTION_START),
				contributionCharacters: contribution.length,
				hasModePolicy: payload.includes("PONYTAIL MODE ACTIVE — level:"),
				hasUpstreamLongForm: payload.includes("HARD RULE: branch or loop only when each leaf has a test"),
				skillNames: [...new Set(payload.match(PONYTAIL_SKILL) ?? [])].sort(),
			})}\n`,
		);
	});
}
