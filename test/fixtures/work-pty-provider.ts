import { appendFileSync } from "node:fs";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "pi-stuff-work-pty";
const MODEL = "fixture-model";
let requestNumber = 0;

const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function message(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]): AssistantMessage {
	return {
		api: "openai-completions",
		content,
		model: MODEL,
		provider: PROVIDER,
		role: "assistant",
		stopReason,
		timestamp: Date.now(),
		usage: ZERO_USAGE,
	};
}

function textStream(text: string) {
	const stream = createAssistantMessageEventStream();
	const pending = message([], "pending");
	stream.push({ type: "start", partial: pending });
	stream.push({ type: "text_start", contentIndex: 0, partial: pending });
	stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: pending });
	stream.push({ type: "text_end", contentIndex: 0, content: text, partial: pending });
	stream.push({ type: "done", reason: "stop", message: message([{ type: "text", text }], "stop") });
	return stream;
}

function toolStream(name: string, id: string, arguments_: Record<string, unknown>) {
	const stream = createAssistantMessageEventStream();
	const pending = message([], "pending");
	const toolCall = { arguments: arguments_, id, name, type: "toolCall" as const };
	stream.push({ type: "start", partial: pending });
	stream.push({ type: "toolcall_start", contentIndex: 0, partial: pending });
	stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: pending });
	stream.push({ type: "done", reason: "toolUse", message: message([toolCall], "toolUse") });
	return stream;
}

function fixtureStream(context: Context) {
	const current = requestNumber;
	requestNumber += 1;
	const tools = (context.tools ?? []).map((tool) => tool.name);
	const transcript = JSON.stringify(context.messages ?? []);
	const monitorCompletedNotification =
		transcript.includes('kind=\\"monitor\\"') && transcript.includes('status=\\"completed\\"');
	const logPath = process.env["PI_STUFF_WORK_PTY_LOG"];
	if (logPath) {
		appendFileSync(
			logPath,
			`${JSON.stringify({
				monitorCompletedNotification,
				monitorTimedOutNotification:
					transcript.includes('kind=\\"monitor\\"') && transcript.includes('status=\\"timed_out\\"'),
				request: current,
				tools,
			})}\n`,
		);
	}
	switch (current) {
		case 0:
			return toolStream("bash", "work-foreground", {
				command: "echo $$ > foreground.pid; sleep 30",
				description: "Foreground handoff fixture",
			});
		case 1:
			return textStream("CTRL_B_CONTINUED");
		case 2:
			return toolStream("bash", "work-background", {
				command:
					"echo $$ > background.pid; while [ ! -f release.flag ]; do sleep 0.1; done; printf READY > ready.flag; printf BG_DONE",
				description: "Prepare monitored service",
				run_in_background: true,
			});
		case 3:
			return toolStream("monitor", "work-monitor", {
				description: "Wait for service readiness",
				interval_seconds: 0.1,
				source: "file",
				success_text: "READY",
				target: "ready.flag",
				timeout_seconds: 22,
			});
		case 4:
			return textStream("MAIN_CONTINUES");
		default:
			if (current >= 5) {
				return textStream(monitorCompletedNotification ? "MONITOR_RESUMED" : "DRAINING_PENDING_NOTIFICATION");
			}
			return textStream(`UNEXPECTED_REQUEST_${String(current)}`);
	}
}

export default function workPtyProvider(pi: ExtensionAPI): void {
	pi.registerProvider(PROVIDER, {
		api: "openai-completions",
		apiKey: "fixture",
		baseUrl: "https://fixture.invalid",
		models: [
			{
				contextWindow: 200_000,
				cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
				id: MODEL,
				input: ["text"],
				maxTokens: 4_096,
				name: "Pi Stuff Work PTY fixture",
				reasoning: false,
			},
		],
		name: "Pi Stuff Work PTY fixture",
		streamSimple: (_model: Model<Api>, context: Context, _options?: SimpleStreamOptions) => fixtureStream(context),
	});
}
