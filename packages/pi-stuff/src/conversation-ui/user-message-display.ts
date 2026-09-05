import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	getMarkdownTheme,
	InteractiveMode,
	type MarkdownTransformer,
	parseSkillBlock,
	SkillInvocationMessageComponent,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Container, type MarkdownTheme, Spacer } from "@earendil-works/pi-tui";
import { isRuntimeBoolean, isRuntimeFunction, isRuntimeNumber, isRuntimeObject } from "../shared/runtime-type.js";
import { DiagnosticChannel } from "./diagnostics.js";
import { UserMessageCard } from "./user-message-card.js";

const USER_MESSAGE_PATCH = Symbol.for("@jczhang02/pi-stuff:user-message-patch/v1");

interface HostPresentation {
	chatContainer: Container;
	outputPad: number;
	toolOutputExpanded: boolean;
	markdownTheme: MarkdownTheme;
	transformers: readonly MarkdownTransformer[];
}

interface InsertOptions {
	populateHistory?: boolean;
}

type InsertMessage = (this: InteractiveMode, message: AgentMessage, options?: InsertOptions) => void;

interface PatchState {
	original: InsertMessage;
	patched: InsertMessage;
	owners: number;
	enabled: boolean;
	diagnostics: DiagnosticChannel | undefined;
	descriptor: PropertyDescriptor;
}

function hostPresentation(host: InteractiveMode): HostPresentation {
	const chat: unknown = Object.getOwnPropertyDescriptor(host, "chatContainer")?.value;
	const padding: unknown = Object.getOwnPropertyDescriptor(host, "outputPad")?.value;
	const expanded: unknown = Object.getOwnPropertyDescriptor(host, "toolOutputExpanded")?.value;
	if (
		!(chat instanceof Container) ||
		!isRuntimeNumber(padding) ||
		!Number.isSafeInteger(padding) ||
		padding < 0 ||
		!isRuntimeBoolean(expanded)
	) {
		throw new Error("User Message presentation requires the certified Pi InteractiveMode layout");
	}
	const getTheme: unknown = Object.getOwnPropertyDescriptor(
		InteractiveMode.prototype,
		"getMarkdownThemeWithSettings",
	)?.value;
	const getTransformers: unknown = Object.getOwnPropertyDescriptor(
		InteractiveMode.prototype,
		"getMarkdownTransformers",
	)?.value;
	if (!isRuntimeFunction(getTheme) || !isRuntimeFunction(getTransformers)) {
		throw new Error("User Message presentation requires the certified Pi Markdown accessors");
	}
	// SAFETY: these callable accessors have the certified Host signatures; they are invoked on its real instance.
	const readTheme = getTheme as (this: InteractiveMode) => MarkdownTheme;
	// SAFETY: the callable accessor returns the native user Markdown transformers in the certified Host.
	const readTransformers = getTransformers as (this: InteractiveMode) => readonly MarkdownTransformer[];
	return {
		chatContainer: chat,
		outputPad: padding,
		toolOutputExpanded: expanded,
		markdownTheme: readTheme.call(host),
		transformers: readTransformers.call(host),
	};
}

function projectMessage(
	host: HostPresentation,
	start: number,
	message: AgentMessage,
	fail: (error: Error) => void,
): void {
	if (message.role !== "user") return;
	const text = message.content;
	const source = Array.isArray(text)
		? text
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("")
		: text;
	if (!source) return;
	const skill = parseSkillBlock(source);
	const children = host.chatContainer.children;
	const first = start + (start > 0 ? 1 : 0);
	const native = children.slice(first);
	const expected = skill?.userMessage ? 3 : 1;
	if (
		(start > 0 && !(children[start] instanceof Spacer)) ||
		native.length !== expected ||
		(skill
			? !(native[0] instanceof SkillInvocationMessageComponent)
			: !(native[0] instanceof UserMessageComponent)) ||
		(expected === 3 && (!(native[1] instanceof Spacer) || !(native[2] instanceof UserMessageComponent)))
	) {
		throw new Error("User Message presentation found unexpected appended Host components");
	}
	const fallback = new Container();
	for (const child of native) fallback.addChild(child);
	const card = new UserMessageCard(skill ? (skill.userMessage ?? "") : source, {
		markdownTheme: host.markdownTheme,
		outputPad: host.outputPad,
		transformers: host.transformers,
		skill,
		fallback,
		fail,
	});
	card.setExpanded(host.toolOutputExpanded);
	children.splice(first, native.length, card);
}

function preflight(): void {
	for (const method of ["getMarkdownThemeWithSettings", "getMarkdownTransformers"]) {
		if (!isRuntimeFunction(Object.getOwnPropertyDescriptor(InteractiveMode.prototype, method)?.value)) {
			throw new Error(`User Message presentation requires InteractiveMode.${method}()`);
		}
	}
	const sample = new UserMessageComponent("User Message preflight", getMarkdownTheme(), 1);
	sample.render(40);
	const fallback = new Container();
	fallback.addChild(sample);
	const card = new UserMessageCard("User Message preflight", {
		markdownTheme: getMarkdownTheme(),
		outputPad: 1,
		transformers: [],
		skill: null,
		fallback,
		fail: (error) => {
			throw error;
		},
	});
	card.render(40);
}

function isPatchState<Value>(value: Value): value is Value & PatchState {
	return (
		value !== null &&
		isRuntimeObject(value) &&
		"original" in value &&
		isRuntimeFunction(value.original) &&
		"patched" in value &&
		isRuntimeFunction(value.patched) &&
		"owners" in value &&
		isRuntimeNumber(value.owners) &&
		Number.isSafeInteger(value.owners) &&
		value.owners > 0 &&
		"enabled" in value &&
		isRuntimeBoolean(value.enabled) &&
		"diagnostics" in value &&
		(value.diagnostics === undefined || value.diagnostics instanceof DiagnosticChannel) &&
		"descriptor" in value &&
		value.descriptor !== null &&
		isRuntimeObject(value.descriptor)
	);
}

function disable(state: PatchState, error: Error): void {
	if (!state.enabled) return;
	state.enabled = false;
	state.diagnostics?.report({
		capability: "Conversation UI",
		key: "user-message-display",
		summary: "User Message styling is unavailable; native messages are preserved.",
		action: "Use /reload to retry; inspect /diagnostics for details.",
		visibility: "notice",
		error,
	});
}

function createPatch(
	original: InsertMessage,
	descriptor: PropertyDescriptor,
	diagnostics: DiagnosticChannel,
): PatchState {
	const state: PatchState = { original, descriptor, patched: original, owners: 0, enabled: true, diagnostics };
	state.patched = function (message, options): void {
		if (!state.enabled || message.role !== "user") {
			original.call(this, message, options);
			return;
		}
		let presentation: HostPresentation;
		try {
			presentation = hostPresentation(this);
		} catch (error) {
			disable(state, error instanceof Error ? error : new Error("User Message Host layout is unavailable"));
			original.call(this, message, options);
			return;
		}
		const start = presentation.chatContainer.children.length;
		original.call(this, message, options);
		try {
			projectMessage(presentation, start, message, (error) => disable(state, error));
		} catch (error) {
			disable(state, error instanceof Error ? error : new Error("User Message projection failed"));
		}
	};
	return state;
}

/** Install a display-only adapter at the one native user insertion and replay seam. */
export function installUserMessageDisplay(diagnostics: DiagnosticChannel): () => void {
	// ponytail: Pi 0.85.0 has no public User Message renderer; replace this patch when the Host exposes one.
	const prototype = InteractiveMode.prototype;
	const descriptor = Object.getOwnPropertyDescriptor(prototype, "addMessageToChat");
	const method: unknown = descriptor?.value;
	if (!descriptor?.configurable || !descriptor.writable || !isRuntimeFunction(method)) {
		throw new Error("User Message presentation requires writable InteractiveMode.addMessageToChat()");
	}
	const existing: unknown = Object.getOwnPropertyDescriptor(prototype, USER_MESSAGE_PATCH)?.value;
	let state: PatchState;
	if (existing !== undefined) {
		if (!isPatchState(existing) || method !== existing.patched) {
			throw new Error("User Message presentation found an incompatible Host adapter");
		}
		state = existing;
	} else {
		preflight();
		// SAFETY: the certified Host method is callable and its insertion signature is fixed by Pi 0.85.0.
		state = createPatch(method as InsertMessage, descriptor, diagnostics);
		Object.defineProperty(prototype, USER_MESSAGE_PATCH, { configurable: true, value: state });
		Object.defineProperty(prototype, "addMessageToChat", { ...descriptor, value: state.patched });
	}
	state.owners += 1;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		state.owners -= 1;
		if (state.owners > 0) return;
		state.enabled = false;
		state.diagnostics = undefined;
		if (Object.getOwnPropertyDescriptor(prototype, "addMessageToChat")?.value === state.patched) {
			Object.defineProperty(prototype, "addMessageToChat", state.descriptor);
		}
		if (Object.getOwnPropertyDescriptor(prototype, USER_MESSAGE_PATCH)?.value === state)
			Reflect.deleteProperty(prototype, USER_MESSAGE_PATCH);
	};
}
