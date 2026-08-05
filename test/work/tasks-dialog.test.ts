import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { CommandDialogViewContext } from "@jczhang02/pi-stuff-ui";
import { CurrentWorkSources } from "../../packages/pi-stuff-work/src/current-work.js";
import type {
	BackgroundWorkOutcome,
	BackgroundWorkRuntime,
	BackgroundWorkSnapshot,
} from "../../packages/pi-stuff-work/src/runtime.js";
import { createTasksDialogView } from "../../packages/pi-stuff-work/src/tasks-dialog.js";

const theme = {
	bold: (value: string) => value,
	fg: (_color: string, value: string) => value,
} as unknown as Theme;

class RuntimeHarness {
	readonly listeners = new Set<() => void>();
	readonly stopped: string[] = [];
	rows: BackgroundWorkSnapshot[] = [
		{
			command: "bun test --watch with a very long target that must remain a distinct field",
			id: "b-shell",
			kind: "shell",
			recentOutput: "first line\nsecond line",
			startedAt: Date.now() - 5_000,
			status: "running",
			title: "Run the complete verification command without blocking the main Agent",
		},
	];

	snapshot(): readonly BackgroundWorkSnapshot[] {
		return this.rows;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async stop(id: string): Promise<BackgroundWorkOutcome> {
		this.stopped.push(id);
		const row = this.rows.find((item) => item.id === id);
		this.rows = this.rows.filter((item) => item.id !== id);
		for (const listener of this.listeners) listener();
		return {
			endedAt: Date.now(),
			id,
			kind: row?.kind ?? "shell",
			startedAt: row?.startedAt ?? Date.now(),
			status: "stopped",
			summary: `Stopped ${id}`,
			title: row?.title ?? id,
		};
	}
}

function harness(rows = 24): {
	readonly closed: () => number;
	readonly context: CommandDialogViewContext<void>;
	readonly renders: () => number;
} {
	let closed = 0;
	let renders = 0;
	return {
		closed: () => closed,
		context: {
			close: () => {
				closed += 1;
			},
			keybindings: {},
			requestRender: () => {
				renders += 1;
			},
			signal: new AbortController().signal,
			theme,
			tui: { terminal: { rows } },
		} as unknown as CommandDialogViewContext<void>,
		renders: () => renders,
	};
}

function sources(): CurrentWorkSources {
	const sources = new CurrentWorkSources();
	sources.register({
		id: "agents",
		snapshot: () => [
			{
				description: "Review the entire implementation independently and report only actionable findings",
				id: "agent-1",
				kind: "agent",
				startedAt: Date.now() - 2_000,
				status: "running",
				title: "Independent implementation review",
			},
		],
		subscribe: () => () => {},
	});
	return sources;
}

describe("/tasks Command Dialog", () => {
	test("renders owned work and read-only Agents as one full-width bounded list", () => {
		const runtime = new RuntimeHarness();
		const ui = harness();
		const component = createTasksDialogView(runtime as unknown as BackgroundWorkRuntime, sources()).create(
			ui.context,
		);
		const normal = component.render(92);
		expect(normal[0]).toBe("─".repeat(92));
		expect(normal.join("\n")).toContain("Tasks · 2 current");
		expect(normal.join("\n")).toContain("Shell");
		expect(normal.join("\n")).toContain("x stop");
		expect(normal.join("\n")).not.toMatch(/[╭╮╰╯]/u);

		const narrow = component.render(28);
		expect(narrow.every((line) => visibleWidth(line) <= 28)).toBe(true);
		expect(narrow.join("\n")).not.toContain("running · 5s");
		expect(narrow.join("\n")).toContain("Esc return");
		component.dispose?.();
	});

	test("shows bounded details and directs Agent control back to /agents", async () => {
		const runtime = new RuntimeHarness();
		const ui = harness();
		const component = createTasksDialogView(runtime as unknown as BackgroundWorkRuntime, sources()).create(
			ui.context,
		);
		component.handleInput?.("\u001b[B");
		component.handleInput?.("x");
		await Bun.sleep(0);
		expect(component.render(64).join("\n")).toContain("Open /agents to control an Agent.");
		expect(runtime.stopped).toHaveLength(0);
		component.handleInput?.("\r");
		const detail = component.render(40);
		expect(detail.every((line) => visibleWidth(line) <= 40)).toBe(true);
		expect(detail.join("\n")).toContain("Task details · Agent");
		expect(detail.join("\n")).toContain("Use /agents");
		component.handleInput?.("\u001b");
		component.handleInput?.("\u001b");
		expect(ui.closed()).toBe(1);
		component.dispose?.();
	});

	test("stops only owned Shell or Monitor activities", async () => {
		const runtime = new RuntimeHarness();
		const ui = harness();
		const component = createTasksDialogView(runtime as unknown as BackgroundWorkRuntime, sources()).create(
			ui.context,
		);
		component.handleInput?.("x");
		await Bun.sleep(0);
		expect(runtime.stopped).toEqual(["b-shell"]);
		expect(component.render(72).join("\n")).not.toContain("Run the complete verification");
		expect(ui.renders()).toBeGreaterThan(0);
		component.dispose?.();
	});

	test("preserves controls in a short terminal", () => {
		const runtime = new RuntimeHarness();
		const ui = harness(9);
		const component = createTasksDialogView(runtime as unknown as BackgroundWorkRuntime, sources()).create(
			ui.context,
		);
		const lines = component.render(38);
		expect(lines.length).toBeLessThanOrEqual(6);
		expect(lines.at(-1)).toContain("Esc return");
		component.dispose?.();
	});
});
