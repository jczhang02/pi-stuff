import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { UiSettings } from "../../packages/pi-stuff-ui/settings.js";
import { UiSettingsStore } from "../../packages/pi-stuff-ui/settings.js";

const [settingsPath, barrierPath, activeWriterPath, overlapPath, workerId] = process.argv.slice(2);
if (!settingsPath || !barrierPath || !activeWriterPath || !overlapPath || !workerId) {
	throw new Error("expected settings race worker arguments");
}

const store = await UiSettingsStore.load(settingsPath, async (path: string, settings: UiSettings) => {
	let ownsMarker = false;
	try {
		await mkdir(activeWriterPath);
		ownsMarker = true;
	} catch (error) {
		if (!(error instanceof Error) || !Reflect.has(error, "code") || Reflect.get(error, "code") !== "EEXIST") {
			throw error;
		}
		await writeFile(overlapPath, `overlap observed by worker ${workerId}\n`);
	}
	try {
		await Bun.sleep(40);
		await writeFile(path, `${JSON.stringify(settings, null, "\t")}\n`, { mode: 0o600 });
	} finally {
		if (ownsMarker) await rm(activeWriterPath, { force: true, recursive: true });
	}
});

await writeFile(join(barrierPath, `${workerId}.ready`), "ready\n");
while (!(await Bun.file(join(barrierPath, "go")).exists())) await Bun.sleep(1);

const setting = Number(workerId) % 2 === 0 ? "statusline" : "inputHighlighting";
await store.set(setting, false);
