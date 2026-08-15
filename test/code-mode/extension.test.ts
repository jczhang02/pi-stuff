import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import piStuffCodeMode from "../../packages/pi-stuff/src/code-mode/extension.js";
import {
	readCodeModeProjectEnabled,
	writeCodeModeProjectEnabled,
} from "../../packages/pi-stuff/src/code-mode/settings.js";
import type {
	SuiteToolDefinitionRegistry,
	SuiteToolSurfaceController,
} from "../../packages/pi-stuff/src/tool-display/contract.js";

type Command = {
	getArgumentCompletions?: (prefix: string) => Array<{ label: string; value: string }> | null;
	handler(args: string, context: ExtensionContext): Promise<void>;
};

type EventHandler = (event: unknown, context: ExtensionContext) => unknown;

const roots: string[] = [];

const registry: SuiteToolDefinitionRegistry = {
	catalog: () => [],
	compensate: async () => false,
	get: () => undefined,
	invoke: async () => ({ isError: false, result: { content: [], details: {} } }),
	isActive: () => false,
	list: () => [],
};

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function project(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "pi-stuff-code-mode-extension-"));
	roots.push(root);
	return root;
}

function loadExtension(surface: SuiteToolSurfaceController): {
	commands: Map<string, Command>;
	events: Map<string, EventHandler[]>;
} {
	const commands = new Map<string, Command>();
	const events = new Map<string, EventHandler[]>();
	const api = {
		events: {},
		on: (name: string, handler: EventHandler) => events.set(name, [...(events.get(name) ?? []), handler]),
		registerCommand: (name: string, command: Command) => commands.set(name, command),
		registerTool: () => {},
	} as unknown as ExtensionAPI;
	piStuffCodeMode(api, { registry, surface });
	return { commands, events };
}

function context(cwd: string, trusted = true): ExtensionContext & { notifications: string[] } {
	const notifications: string[] = [];
	return {
		cwd,
		hasUI: false,
		isProjectTrusted: () => trusted,
		notifications,
		ui: { notify: (message: string) => notifications.push(message) },
	} as unknown as ExtensionContext & { notifications: string[] };
}

async function sessionStart(events: Map<string, EventHandler[]>, ctx: ExtensionContext): Promise<void> {
	for (const handler of events.get("session_start") ?? []) {
		await handler({ reason: "startup", type: "session_start" }, ctx);
	}
}

test("bare /codemode owns the interactive dialog path and status is no longer a command", async () => {
	const surface: SuiteToolSurfaceController = {
		disableEnvelope: () => {},
		enableEnvelope: () => {},
		isEnvelopeEnabled: () => false,
	};
	const { commands } = loadExtension(surface);
	const command = commands.get("codemode");
	if (!command) throw new Error("missing /codemode command");
	const completions = command.getArgumentCompletions?.("") ?? [];
	expect(completions.map(({ value }) => value)).not.toContain("status");

	const notifications: string[] = [];
	const context = {
		hasUI: false,
		ui: { notify: (message: string) => notifications.push(message) },
	} as unknown as ExtensionContext;
	await command.handler("", context);
	expect(notifications.at(-1)).toBe("/codemode requires interactive TUI mode; use /codemode on or /codemode off.");
	await command.handler("status", context);
	expect(notifications.at(-1)).toStartWith("Usage: /codemode [on|off|history|");
	expect(notifications.at(-1)).not.toContain("status");
});

test("Code Mode follows trusted project settings, persists explicit toggles, and rolls back failed writes", async () => {
	const previousDefault = process.env["PI_STUFF_CODE_MODE_DEFAULT"];
	const previousFrozen = process.env["PI_STUFF_CODE_MODE_FROZEN"];
	delete process.env["PI_STUFF_CODE_MODE_DEFAULT"];
	delete process.env["PI_STUFF_CODE_MODE_FROZEN"];
	try {
		const first = await project();
		const second = await project();
		await writeCodeModeProjectEnabled(first, true);
		let enabled = false;
		const surface: SuiteToolSurfaceController = {
			disableEnvelope: () => {
				enabled = false;
			},
			enableEnvelope: () => {
				enabled = true;
			},
			isEnvelopeEnabled: () => enabled,
		};
		const loaded = loadExtension(surface);
		await sessionStart(loaded.events, context(first));
		expect(enabled).toBe(true);
		await sessionStart(loaded.events, context(second));
		expect(enabled).toBe(false);

		const secondContext = context(second);
		const command = loaded.commands.get("codemode");
		if (!command) throw new Error("missing /codemode command");
		await command.handler("on", secondContext);
		expect(enabled).toBe(true);
		expect(await readCodeModeProjectEnabled(second)).toBe(true);

		let reloaded = false;
		const next = loadExtension({
			disableEnvelope: () => {
				reloaded = false;
			},
			enableEnvelope: () => {
				reloaded = true;
			},
			isEnvelopeEnabled: () => reloaded,
		});
		await sessionStart(next.events, context(second));
		expect(reloaded).toBe(true);

		process.env["PI_STUFF_CODE_MODE_FROZEN"] = "off";
		let childEnabled = true;
		const child = loadExtension({
			disableEnvelope: () => {
				childEnabled = false;
			},
			enableEnvelope: () => {
				childEnabled = true;
			},
			isEnvelopeEnabled: () => childEnabled,
		});
		await sessionStart(child.events, context(second));
		expect(childEnabled).toBe(false);
		delete process.env["PI_STUFF_CODE_MODE_FROZEN"];

		await rm(join(second, ".pi"), { force: true, recursive: true });
		await writeFile(join(second, ".pi"), "not a directory");
		await command.handler("off", secondContext);
		expect(enabled).toBe(true);
		expect(secondContext.notifications.at(-1)).toContain("Unable to read Code Mode project settings");

		await sessionStart(loaded.events, context(first, false));
		expect(enabled).toBe(false);
	} finally {
		if (previousDefault === undefined) delete process.env["PI_STUFF_CODE_MODE_DEFAULT"];
		else process.env["PI_STUFF_CODE_MODE_DEFAULT"] = previousDefault;
		if (previousFrozen === undefined) delete process.env["PI_STUFF_CODE_MODE_FROZEN"];
		else process.env["PI_STUFF_CODE_MODE_FROZEN"] = previousFrozen;
	}
});
