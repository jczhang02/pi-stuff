import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PermissionPromptDecision } from "../../packages/pi-stuff-permissions/src/authority/permission-dialog.js";
import {
	PermissionPromptComponent,
	requestPermissionDecision,
	sanitizeTerminalText,
} from "../../packages/pi-stuff-permissions/src/authority/permission-prompt-component.js";
import type { PromptModelConfig } from "../../packages/pi-stuff-permissions/src/authority/permission-prompt-decision.js";
import type {
	CommandDialogComponent,
	CommandDialogCoordinator,
	CommandDialogView,
} from "../../packages/pi-stuff-ui/index.js";

const CONFIG: PromptModelConfig = {
	doublePressToConfirm: false,
	exactCallOnly: true,
	sessionLabel: "Yes, for this session",
};

const THEME = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

function createPrompt(command: string, initialRows = 28) {
	let rows = initialRows;
	let renderRequests = 0;
	let decision: PermissionPromptDecision | undefined;
	const component = new PermissionPromptComponent(
		THEME,
		CONFIG,
		"Bash command · from worker",
		"fallback message",
		3,
		{
			requester: "worker",
			command,
			reason: "outside the current project",
			operation: "rm",
			cwd: "/workspace/project",
			targets: ["/var/tmp/output"],
		},
		() => rows,
		() => false,
		() => {
			renderRequests += 1;
		},
		(result) => {
			decision = result;
		},
	);
	return {
		component,
		decision: () => decision,
		renderRequests: () => renderRequests,
		setRows: (value: number) => {
			rows = value;
		},
	};
}

describe("exact-call permission prompt", () => {
	test("keeps title and both decisions fixed while evidence scrolls", () => {
		const command = Array.from(
			{ length: 80 },
			(_, index) => `line-${String(index).padStart(2, "0")} ${"x".repeat(40)}`,
		).join("\n");
		const harness = createPrompt(command);
		const first = harness.component.render(64);

		expect(first).toHaveLength(24);
		expect(first.join("\n")).toContain("Bash command · from worker");
		expect(first.join("\n")).toContain("1 of 3 pending");
		expect(first.join("\n")).toContain("Evidence 1–");
		expect(first.join("\n")).toContain("Allow this exact call once");
		expect(first.join("\n")).toContain("Deny");

		harness.component.handleInput("\x1b[6~");
		expect(harness.component.render(64).join("\n")).toContain("line-14");
		harness.component.handleInput("\x1b[F");
		const last = harness.component.render(64).join("\n");
		expect(last).toContain("line-79");
		expect(last).toContain("Targets:");
		expect(last).toContain("Allow this exact call once");
	});

	test("never exceeds the terminal height in normal and compact layouts", () => {
		const harness = createPrompt("rm /var/tmp/output", 12);
		expect(harness.component.render(64)).toHaveLength(12);
		harness.setRows(8);
		expect(harness.component.render(64)).toHaveLength(8);
	});

	test("disables approval when the terminal is too small and recovers on resize", () => {
		const harness = createPrompt("rm /var/tmp/output", 7);
		const paused = harness.component.render(64).join("\n");
		expect(paused).toContain("Terminal too small to review safely");

		harness.component.handleInput("y");
		harness.component.handleInput("\r");
		expect(harness.decision()).toBeUndefined();

		harness.setRows(8);
		expect(harness.component.render(64).join("\n")).toContain("Allow this exact call once");
		harness.component.handleInput("\r");
		expect(harness.decision()).toEqual({ approved: true, state: "approved" });
	});

	test("still permits an immediate deny on the resize surface", () => {
		const harness = createPrompt("rm /var/tmp/output", 7);
		harness.component.render(64);
		harness.component.handleInput("\x1b");
		expect(harness.decision()).toEqual({ approved: false, state: "denied" });
	});

	test("renders terminal controls and bidi controls as inert visible text", () => {
		const dangerous = "rm \u001b[2J\u009b31m\u202Etarget";
		const harness = createPrompt(dangerous);
		const rendered = harness.component.render(64).join("\n");
		expect(rendered).not.toContain("\u001b");
		expect(rendered).not.toContain("\u009b");
		expect(rendered).not.toContain("\u202e");
		expect(rendered).toContain("\\x1B[2J\\x9B31m\\u{202E}target");
		expect(sanitizeTerminalText("a\tb\rc")).toBe("a  b\\x0Dc");
	});

	test("updates the live pending count without changing the decision", () => {
		const harness = createPrompt("rm /var/tmp/output");
		harness.component.render(64);
		harness.component.setPendingCount(2);
		expect(harness.component.render(64).join("\n")).toContain("1 of 2 pending");
		expect(harness.renderRequests()).toBe(1);
	});

	test("serves simultaneous requests FIFO with a truthful live count", async () => {
		const mounted: Array<{
			component: CommandDialogComponent;
			title: string;
		}> = [];
		const coordinator = {
			registerChrome: () => () => {},
			whenIdle: async () => {},
			show: <Result>(_ctx: ExtensionContext, view: CommandDialogView<Result>): Promise<Result | undefined> =>
				new Promise((resolve) => {
					const component = view.create({
						keybindings: { matches: () => false } as never,
						signal: new AbortController().signal,
						theme: THEME as never,
						tui: { terminal: { rows: 24 }, requestRender: () => {} } as never,
						close: resolve,
						requestRender: () => {},
					});
					mounted.push({ component, title: component.render(64).join("\n") });
				}),
		} satisfies CommandDialogCoordinator;
		const ctx = {
			mode: "tui",
			ui: {
				getToolsExpanded: () => false,
				setToolsExpanded: () => {},
			},
		} as unknown as ExtensionContext;
		const request = (title: string) =>
			requestPermissionDecision({ ctx, coordinator, doublePressToConfirm: false }, title, `${title} evidence`, {
				exactCallOnly: true,
			});

		const first = request("first");
		const second = request("second");
		const third = request("third");
		expect(mounted).toHaveLength(1);
		expect(mounted[0]?.component.render(64).join("\n")).toContain("1 of 3 pending");

		mounted[0]?.component.handleInput?.("\r");
		expect(await first).toEqual({ approved: true, state: "approved" });
		await Promise.resolve();
		expect(mounted).toHaveLength(2);
		expect(mounted[1]?.title).toContain("second");
		expect(mounted[1]?.component.render(64).join("\n")).toContain("1 of 2 pending");

		mounted[1]?.component.handleInput?.("\r");
		expect(await second).toEqual({ approved: true, state: "approved" });
		await Promise.resolve();
		expect(mounted).toHaveLength(3);
		expect(mounted[2]?.title).toContain("third");
		mounted[2]?.component.handleInput?.("\x1b");
		expect(await third).toEqual({ approved: false, state: "denied" });
	});
});
