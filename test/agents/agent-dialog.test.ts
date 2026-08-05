import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { CommandDialogComponent, CommandDialogViewContext } from "@jczhang02/pi-stuff-ui";
import type {
	AgentControlAction,
	AgentControlResult,
	AgentRow,
	AgentSessionSnapshot,
	AgentStatus,
	CurrentAgents,
} from "../../packages/pi-stuff-agents/src/session/current-agents.js";
import {
	type AgentDialogOptions,
	type AgentTranscriptRequest,
	createAgentDialogView,
} from "../../packages/pi-stuff-agents/src/ui/agent-dialog.js";

const theme = {
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	fg: (_color: string, text: string) => text,
	italic: (text: string) => text,
	strikethrough: (text: string) => text,
	underline: (text: string) => text,
} as unknown as Theme;

interface Deferred<Value> {
	readonly promise: Promise<Value>;
	reject(error: unknown): void;
	resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
	let resolve!: (value: Value) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<Value>((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	return { promise, reject, resolve };
}

class CurrentAgentsHarness {
	readonly actions: AgentControlAction[] = [];
	controlHandler: (action: AgentControlAction) => Promise<AgentControlResult> = async (action) =>
		result(action, true, "accepted");
	private readonly listeners = new Set<(snapshot: AgentSessionSnapshot) => void>();
	private value: AgentSessionSnapshot;

	constructor(rows: readonly AgentRow[]) {
		this.value = snapshot(rows);
	}

	asCurrentAgents(): CurrentAgents {
		return this as unknown as CurrentAgents;
	}

	control(action: AgentControlAction): Promise<AgentControlResult> {
		this.actions.push(action);
		return this.controlHandler(action);
	}

	snapshot(): AgentSessionSnapshot {
		return this.value;
	}

	subscribe(listener: (snapshot: AgentSessionSnapshot) => void): () => void {
		this.listeners.add(listener);
		listener(this.value);
		return () => this.listeners.delete(listener);
	}

	listenerCount(): number {
		return this.listeners.size;
	}

	update(rows: readonly AgentRow[]): void {
		this.value = snapshot(rows, this.value.revision + 1);
		for (const listener of this.listeners) listener(this.value);
	}
}

class DialogContextHarness {
	closed = 0;
	renderRequests = 0;
	readonly controller = new AbortController();
	readonly tui = { terminal: { columns: 64, rows: 28 } } as unknown as TUI;
	private readonly activeTheme: Theme;

	constructor(activeTheme = theme) {
		this.activeTheme = activeTheme;
	}

	context(): CommandDialogViewContext<void> {
		return {
			close: () => {
				this.closed += 1;
			},
			keybindings: {} as CommandDialogViewContext<void>["keybindings"],
			requestRender: () => {
				this.renderRequests += 1;
			},
			signal: this.controller.signal,
			theme: this.activeTheme,
			tui: this.tui,
		};
	}
}

function snapshot(rows: readonly AgentRow[], revision = 1): AgentSessionSnapshot {
	return { revision, rows, sessionId: "session" };
}

function row(key: string, status: AgentStatus, overrides: Partial<Omit<AgentRow, "key" | "status">> = {}): AgentRow {
	return {
		childIndex: 0,
		description: `work assigned to ${key}`,
		endedAt: ["agent_stopped", "completed", "crashed", "failed", "user_cancelled"].includes(status) ? 12_001 : null,
		elapsedMs: 12_000,
		key,
		name: key,
		nestedCount: 0,
		partialResult: null,
		runId: `run-${key}`,
		savedOutputPath: null,
		sessionFile: null,
		sessionId: "session",
		startedAt: 1,
		status,
		task: `work assigned to ${key}`,
		transcriptPath: `/tmp/${key}.jsonl`,
		...overrides,
	};
}

function result(action: AgentControlAction, acknowledged: boolean, message: string): AgentControlResult {
	return { acknowledged, key: action.key, message, status: null, type: action.type };
}

function setup(rows: readonly AgentRow[], options: Partial<AgentDialogOptions> = {}, activeTheme = theme) {
	const current = new CurrentAgentsHarness(rows);
	const context = new DialogContextHarness(activeTheme);
	const requests: AgentTranscriptRequest[] = [];
	const view = createAgentDialogView(current.asCurrentAgents(), {
		readTranscript: (request) => {
			requests.push(request);
			return null;
		},
		...options,
	});
	const component = view.create(context.context());
	return { component, context, current, requests, view };
}

function input(component: CommandDialogComponent, data: string): void {
	component.handleInput?.(data);
}

function text(component: CommandDialogComponent, width = 64): string {
	return component.render(width).join("\n");
}

async function flush(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

describe("Agent Command Dialog", () => {
	test("keeps running identity and state above the tertiary dim token", () => {
		const colors: Array<{ color: string; text: string }> = [];
		const recordingTheme = {
			...theme,
			fg: (color: string, text: string) => {
				colors.push({ color, text });
				return text;
			},
		} as unknown as Theme;
		const { component } = setup([row("reviewer", "running")], {}, recordingTheme);
		component.render(64);
		expect(colors).toContainEqual({ color: "muted", text: "12s" });
		expect(colors).not.toContainEqual({ color: "dim", text: "12s" });
		component.dispose?.();
	});

	test("is a normal full-width view with a bounded 64-column list", () => {
		const rows = Array.from({ length: 9 }, (_, index) =>
			row(`agent-${index + 1}`, index === 0 ? "waiting_supervisor" : "running", {
				task: `task ${index + 1} with a deliberately long explanation that should not escape the terminal width`,
			}),
		);
		const { component, view } = setup(rows);
		const rendered = component.render(64);

		expect(view.priority).toBe("normal");
		expect(rendered[0]).toBe("─".repeat(64));
		expect(rendered.join("\n")).toContain("Agents");
		expect(rendered.join("\n")).toContain("waiting");
		expect(rendered.join("\n")).toContain("later");
		expect(rendered.join("\n")).not.toMatch(/[╭╮╰╯]/u);
		expect(rendered.length).toBeLessThanOrEqual(28);
		expect(rendered.every((line) => visibleWidth(line) <= 64 && !line.includes("\n"))).toBe(true);
	});

	test("uses the short description in the list and preserves the full Task in detail", async () => {
		const fullTask = "Inspect /tmp/pi-run/deep/sample.txt without changing the file";
		const { component } = setup([
			row("reviewer", "completed", {
				description: "Review sample output",
				endedAt: 12_001,
				task: fullTask,
			}),
		]);
		const list = text(component, 64);
		expect(list).toContain("Review sample output");
		expect(list).not.toContain("/tmp/pi-run/deep");
		expect(list).not.toMatch(/\b(?:done|completed)\b/i);

		input(component, "\r");
		await flush();
		expect(text(component, 100)).toContain(fullTask);
	});

	test("keeps timestamp-free legacy completion semantically visible", async () => {
		const { component } = setup([row("legacy", "completed", { elapsedMs: null, endedAt: null, startedAt: null })]);
		expect(text(component, 64)).toContain("✓");
		expect(text(component, 64)).not.toMatch(/\b(?:done|completed)\b/i);
		input(component, "\r");
		await flush();
		expect(text(component, 64)).toContain("completed");
	});

	test("keeps title, selected state, errors, and Escape reachable at very low height", async () => {
		const failure = new Error("transcript disk unavailable");
		const { component, context } = setup([row("reviewer", "running")], {
			readTranscript: async () => {
				throw failure;
			},
		});
		(context.tui.terminal as { rows: number }).rows = 6;
		const list = component.render(64);
		expect(list).toHaveLength(3);
		expect(list.join("\n")).toContain("Agents");
		expect(list.join("\n")).toContain("reviewer");
		expect(list.at(-1)).toContain("Esc close");

		input(component, "\r");
		await flush();
		const detail = component.render(64);
		expect(detail).toHaveLength(3);
		expect(detail.join("\n")).toContain("Agents / reviewer");
		expect(detail.join("\n")).toContain("transcript disk unavailable");
		expect(detail.at(-1)).toContain("Esc back");
		component.dispose?.();
	});

	test("navigates without wrapping and uses Escape as back then close", async () => {
		const { component, context, requests } = setup([
			row("first", "running"),
			row("second", "completed", { nestedCount: 3 }),
		]);
		input(component, "\u001b[A");
		expect(text(component)).toContain("  › first");
		expect(text(component)).toContain("x stop");
		input(component, "\u001b[B");
		input(component, "\u001b[B");
		expect(text(component)).toContain("  › second");
		expect(text(component)).not.toContain("x dismiss");

		input(component, "\r");
		await flush();
		expect(requests.at(-1)?.row.key).toBe("second");
		expect(text(component)).toContain("Agents / second");
		expect(text(component)).toContain("3 nested");

		input(component, "\u001b");
		expect(text(component)).toContain("  › second");
		expect(context.closed).toBe(0);
		input(component, "\u001b");
		expect(context.closed).toBe(1);
	});

	test("keeps CJK rows safe and wraps every action hint instead of clipping Escape", async () => {
		const dangerousName = "编译\u001b]0;renamed\u0007助手";
		const { component } = setup(
			[
				row("cjk", "failed", {
					name: dangerousName,
					task: "检查中文路径与很长的终端输出是否安全换行",
				}),
			],
			{ initialKey: "cjk", readTranscript: () => "第一行\n第二行\n第三行" },
		);
		await flush();

		for (const width of [100, 64, 32]) {
			const rendered = component.render(width);
			const renderedText = rendered.join("\n");
			expect(rendered.every((line) => visibleWidth(line) <= width && !line.includes("\n"))).toBe(true);
			expect(renderedText).not.toContain("\u001b]");
			expect(renderedText).not.toContain("renamed");
			expect(renderedText).toContain("Esc back");
		}

		input(component, "\u001b");
		const list = component.render(32);
		expect(list.join("\n")).toContain("  › 编译助手");
		expect(list.join("\n")).toContain("Esc close");
		expect(list.every((line) => visibleWidth(line) <= 32)).toBe(true);
	});

	test("loads a bounded transcript, strips terminal controls, and scrolls it", async () => {
		const requests: AgentTranscriptRequest[] = [];
		const transcript = [
			"line-1",
			"\u001b[31mline-2-red\u001b[0m",
			"\u001b]8;;https://example.invalid\u0007hidden-link-target\u001b]8;;\u0007",
			"line-4\u202e",
			"line-5",
			"line-6",
			"line-7",
			"line-8",
		].join("\n");
		const { component } = setup(
			[
				row("reader", "running", {
					partialResult: "partial\u001b[2J result",
					task: "inspect\u001b[31m safely\u001b[0m",
				}),
			],
			{
				initialKey: "reader",
				maxTranscriptChars: 400,
				readTranscript: (request) => {
					requests.push(request);
					return transcript;
				},
			},
		);
		await flush();
		const before = text(component);

		expect(requests).toHaveLength(1);
		expect(requests[0]?.maxChars).toBe(400);
		expect(requests[0]?.signal).toBeInstanceOf(AbortSignal);
		expect(before).toContain("line-2-red");
		expect(before).toContain("hidden-link-target");
		expect(before).toContain("State  running · 12s · 0 nested");
		expect(before).not.toContain("\u001b");
		expect(before).not.toContain("https://example.invalid");
		expect(before).not.toContain("\u202e");
		expect(before).toContain("later lines");

		input(component, "\u001b[6~");
		const after = text(component);
		expect(after).toContain("earlier lines");
		expect(after).toContain("partial result");
		expect(after).not.toBe(before);
		expect(component.render(64).length).toBeLessThanOrEqual(28);
		expect(component.render(64).every((line) => visibleWidth(line) <= 64)).toBe(true);

		const fallback = setup([row("fallback", "completed", { partialResult: "ONLY_PARTIAL_9X" })], {
			initialKey: "fallback",
			readTranscript: () => "ONLY_PARTIAL_9X",
		});
		await flush();
		const fallbackText = text(fallback.component);
		expect(fallbackText).toContain("Transcript unavailable.");
		expect(fallbackText).toContain("Partial result");
		expect(fallbackText.match(/ONLY_PARTIAL_9X/g)).toHaveLength(1);
	});

	test("shows pending and rejected stop results without inventing success", async () => {
		const pending = deferred<AgentControlResult>();
		const { component, current } = setup([row("worker", "running")]);
		current.controlHandler = (action) =>
			pending.promise.then((value) => ({ ...value, key: action.key, type: action.type }));

		input(component, "x");
		expect(text(component)).toContain("Stopping… waiting for acknowledgement.");
		expect(text(component)).not.toContain("Acknowledged:");
		input(component, "\r");
		expect(text(component)).toContain("Stopping… waiting for acknowledgement.");
		await flush();
		expect(current.actions).toEqual([{ key: "worker", type: "stop" }]);

		pending.resolve({
			acknowledged: false,
			key: "worker",
			message: "process refused",
			status: "running",
			type: "stop",
		});
		await flush();
		expect(text(component)).toContain("Not acknowledged: process refused");
		expect(text(component)).not.toContain("Acknowledged: process refused");

		current.controlHandler = async () => {
			throw new Error("control bridge offline");
		};
		input(component, "x");
		await flush();
		expect(text(component)).toContain("Request failed: control bridge offline");
	});

	test("steers with required text and reports positive acknowledgement", async () => {
		const pending = deferred<AgentControlResult>();
		const { component, current } = setup([row("worker", "running")], { initialKey: "worker" });
		current.controlHandler = () => pending.promise;

		input(component, "s");
		input(component, "\r");
		expect(text(component)).toContain("Enter a steering message.");
		expect(current.actions).toEqual([]);
		input(component, "g");
		input(component, "o");
		input(component, "!");
		input(component, "\u007f");
		input(component, "\r");
		expect(text(component)).toContain("Sending guidance… waiting for acknowledgement.");
		await flush();
		expect(current.actions).toEqual([{ key: "worker", message: "go", type: "steer" }]);

		pending.resolve({
			acknowledged: true,
			key: "worker",
			message: "guidance received",
			status: "running",
			type: "steer",
		});
		await flush();
		expect(text(component)).toContain("Acknowledged: guidance received");
	});

	test("resumes only resumable terminal states and keeps their details durable", async () => {
		const failed = setup([row("failed", "failed")], { initialKey: "failed" });
		input(failed.component, "r");
		input(failed.component, "\r");
		await flush();
		expect(failed.current.actions[0]).toEqual({ key: "failed", type: "resume" });
		input(failed.component, "x");
		await flush();
		expect(failed.current.actions).toEqual([{ key: "failed", type: "resume" }]);
		expect(text(failed.component)).toContain("Agents / failed");

		const cancelled = setup([row("cancelled", "user_cancelled")], { initialKey: "cancelled" });
		input(cancelled.component, "r");
		expect(cancelled.current.actions).toEqual([]);
		expect(text(cancelled.component)).not.toContain("Resume message");
	});

	test("tracks snapshots and unsubscribes on disposal", () => {
		const { component, current } = setup([row("first", "running")]);
		expect(current.listenerCount()).toBe(1);
		current.update([row("second", "completed")]);
		expect(text(component)).toContain("second");
		expect(text(component)).not.toContain("first");

		component.dispose?.();
		expect(current.listenerCount()).toBe(0);
		current.update([row("third", "running")]);
		expect(text(component)).not.toContain("third");
	});
});
