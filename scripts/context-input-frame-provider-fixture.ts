import {
	isJsonInputObject,
	type JsonInputObject,
	type JsonInputValue,
	parseJsonValue,
} from "../packages/pi-stuff/src/shared/json-value.js";
import { isRuntimeString } from "../packages/pi-stuff/src/shared/runtime-type.js";

export const CONTEXT_RESUME_REQUEST = "CONTEXT_RESUME_REQUEST";
export const CONTEXT_RESUME_DONE = "CONTEXT_RESUME_DONE";
export const PROVIDER_CONTEXT_WINDOW = "8000000";

export function createBuiltinOpenAiServer(requestBodies: string[]) {
	return Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: async (request) => {
			const body = await request.text();
			const parsedBody: JsonInputValue | undefined = (() => {
				try {
					return parseJsonValue(body);
				} catch {
					return undefined;
				}
			})();
			const messages =
				isJsonInputObject(parsedBody) && Array.isArray(parsedBody["messages"]) ? parsedBody["messages"] : [];
			const lastUserContent = [...messages]
				.reverse()
				.find((message) => isJsonInputObject(message) && message["role"] === "user");
			const lastUser =
				isJsonInputObject(lastUserContent) && isRuntimeString(lastUserContent["content"])
					? lastUserContent["content"]
					: isJsonInputObject(lastUserContent) && Array.isArray(lastUserContent["content"])
						? lastUserContent["content"]
								.flatMap((part) =>
									isJsonInputObject(part) && part["type"] === "text" && isRuntimeString(part["text"])
										? [part["text"]]
										: [],
								)
								.join("")
						: "";
			const isResume = lastUser.includes(CONTEXT_RESUME_REQUEST);
			const isDrain = lastUser.includes("CONTEXT_DRAIN");
			if (isResume) requestBodies.push(body);
			if (!isResume && !isDrain) return new Response("not found", { status: 404 });
			const attempt = requestBodies.length;
			const chunk = (value: JsonInputObject): string => `data: ${JSON.stringify(value)}\n\n`;
			const response = isDrain
				? [
						chunk({
							id: "context-input-frame",
							object: "chat.completion.chunk",
							created: 1,
							model: "fixture-model",
							choices: [
								{ index: 0, delta: { role: "assistant", content: "CONTEXT_DRAIN_DONE" }, finish_reason: null },
							],
						}),
						chunk({
							id: "context-input-frame",
							object: "chat.completion.chunk",
							created: 1,
							model: "fixture-model",
							choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
						}),
						"data: [DONE]\n\n",
					].join("")
				: attempt === 1
					? chunk({
							id: "context-input-frame",
							object: "chat.completion.chunk",
							created: 1,
							model: "fixture-model",
							choices: [{ index: 0, delta: { role: "assistant", content: "partial" }, finish_reason: null }],
						})
					: [
							chunk({
								id: "context-input-frame",
								object: "chat.completion.chunk",
								created: 1,
								model: "fixture-model",
								choices: [
									{
										index: 0,
										delta: { role: "assistant", content: CONTEXT_RESUME_DONE },
										finish_reason: null,
									},
								],
							}),
							chunk({
								id: "context-input-frame",
								object: "chat.completion.chunk",
								created: 1,
								model: "fixture-model",
								choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
							}),
							"data: [DONE]\n\n",
						].join("");
			return new Response(response, {
				headers: { "content-type": "text/event-stream", connection: "keep-alive" },
			});
		},
	});
}
