import type { AssistantMessage } from "@earendil-works/pi-ai";

/** Extract only final answer text. Thinking and tool calls are never projected. */
export function assistantMessageText(message: AssistantMessage): string {
	return message.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}
