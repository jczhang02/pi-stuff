import { expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ToolUiSettingsStore } from "../../packages/pi-stuff-tools/settings.js";

type ContractModule = typeof import("../../packages/pi-stuff-tools/contract.js");

test("physical package copies share one runtime through the stable global registry", async () => {
	const directory = mkdtempSync(join(process.cwd(), ".pi-stuff-tools-duplicates-"));
	const source = join(process.cwd(), "packages/pi-stuff-tools");
	const firstPath = join(directory, "first");
	const secondPath = join(directory, "second");
	cpSync(source, firstPath, { recursive: true });
	cpSync(source, secondPath, { recursive: true });
	try {
		const first = (await import(pathToFileURL(join(firstPath, "contract.ts")).href)) as ContractModule;
		const second = (await import(pathToFileURL(join(secondPath, "contract.ts")).href)) as ContractModule;
		const api = { events: {}, registerTool: () => {} } as unknown as ExtensionAPI;
		const beforeInstall = first.getToolUiRuntime(api);
		const afterInstall = second.installToolUiRuntime(
			api,
			ToolUiSettingsStore.memory({ liveElapsed: false, schemaVersion: 1 }),
		);

		expect(afterInstall).toBe(beforeInstall);
		expect(second.getToolUiRuntime(api)).toBe(beforeInstall);
	} finally {
		rmSync(directory, { force: true, recursive: true });
	}
});
