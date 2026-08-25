import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_SESSION_NAMING_SETTINGS } from "../packages/pi-stuff/src/session-naming/settings.js";

/** Isolate an unrelated real-Host verifier in its fresh temporary Agent directory. */
export async function disableSessionNamingForTest(agentDirectory: string): Promise<void> {
	await writeFile(
		join(agentDirectory, "pi-stuff.json"),
		`${JSON.stringify({ sessionNaming: { ...DEFAULT_SESSION_NAMING_SETTINGS, enabled: false } }, null, "\t")}\n`,
		{ mode: 0o600 },
	);
}
