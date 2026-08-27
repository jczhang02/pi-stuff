import {
	isJsonInputObject,
	type JsonInputValue,
	requireJsonInputValue,
} from "../../../packages/pi-stuff/src/shared/json-value.js";
import { isRuntimeBoolean, isRuntimeString } from "../../../packages/pi-stuff/src/shared/runtime-type.js";

export interface AnthropicMessageBlock {
	content?: JsonInputValue;
	name?: string;
	text?: string;
	type?: string;
}

export interface AnthropicMessage {
	content?: AnthropicMessageBlock[] | string;
}

export interface AnthropicMessagesRequest {
	messages?: AnthropicMessage[];
	model?: string;
	stream?: boolean;
	tools?: Array<{ name?: string }>;
}

function optionalString(value: JsonInputValue, label: string): string | undefined {
	if (value === undefined) return undefined;
	if (!isRuntimeString(value)) throw new TypeError(`${label} must be a string`);
	return value;
}

function parseMessageBlock(value: JsonInputValue): AnthropicMessageBlock {
	if (!isJsonInputObject(value)) throw new TypeError("Anthropic message blocks must be objects");
	const block: AnthropicMessageBlock = {};
	const type = optionalString(value["type"], "Anthropic message block type");
	const text = optionalString(value["text"], "Anthropic message block text");
	const name = optionalString(value["name"], "Anthropic message block name");
	if (type !== undefined) block.type = type;
	if (text !== undefined) block.text = text;
	if (name !== undefined) block.name = name;
	if (value["content"] !== undefined) block.content = value["content"];
	return block;
}

function parseMessage(value: JsonInputValue): AnthropicMessage {
	if (!isJsonInputObject(value)) throw new TypeError("Anthropic messages must be objects");
	const content = value["content"];
	if (content === undefined) return {};
	if (isRuntimeString(content)) return { content };
	if (!Array.isArray(content)) throw new TypeError("Anthropic message content must be text or blocks");
	return { content: content.map(parseMessageBlock) };
}

function parseTool(value: JsonInputValue): { name?: string } {
	if (!isJsonInputObject(value)) throw new TypeError("Anthropic Tool schemas must be objects");
	const name = optionalString(value["name"], "Anthropic Tool name");
	return name === undefined ? {} : { name };
}

export function parseAnthropicMessagesRequest<Value>(value: Value): AnthropicMessagesRequest {
	if (!isJsonInputObject(value)) throw new TypeError("Anthropic Messages request must be an object");
	const request: AnthropicMessagesRequest = {};
	const messages = value["messages"];
	if (messages !== undefined) {
		if (!Array.isArray(messages)) throw new TypeError("Anthropic messages must be an array");
		request.messages = messages.map(parseMessage);
	}
	const tools = value["tools"];
	if (tools !== undefined) {
		if (!Array.isArray(tools)) throw new TypeError("Anthropic Tools must be an array");
		request.tools = tools.map(parseTool);
	}
	const model = optionalString(value["model"], "Anthropic model");
	if (model !== undefined) request.model = model;
	const stream = value["stream"];
	if (stream !== undefined) {
		if (!isRuntimeBoolean(stream)) throw new TypeError("Anthropic stream must be a boolean");
		request.stream = stream;
	}
	return request;
}

export function extractAnthropicText(messages: readonly AnthropicMessage[]): string {
	return messages
		.flatMap((message) => {
			if (!Array.isArray(message.content)) return message.content === undefined ? [] : [message.content];
			return message.content.filter((block) => block.type === "text").map((block) => block.text ?? "");
		})
		.join("\n");
}

export function anthropicMessageBlocks(messages: readonly AnthropicMessage[]): AnthropicMessageBlock[] {
	return messages.flatMap((message) => (Array.isArray(message.content) ? message.content : []));
}

export function anthropicEvent<Payload>(name: string, payload: Payload): string {
	const data = requireJsonInputValue(payload, `Anthropic '${name}' event`);
	return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}
