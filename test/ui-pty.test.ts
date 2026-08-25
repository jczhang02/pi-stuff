import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { verifyUiPty } from "../scripts/verify-ui-pty.ts";

const { PI_BIN = "/opt/bin/pi" } = process.env;
const AGGREGATE_PACKAGE = resolve(import.meta.dir, "../packages/pi-stuff");

test("real Pi renders and restores the integrated production UI at all accepted widths", async () => {
	const evidence = await verifyUiPty({ piBinary: PI_BIN, packagePath: AGGREGATE_PACKAGE });

	expect(evidence.sizes).toEqual(["100x32", "64x28", "48x22", "32x18", "24x16"]);
	expect(evidence.markdownTransformer).toBeTypeOf("boolean");
	for (const required of [
		"live resize 100x32 -> 64x28 -> 48x22 -> 32x18 -> 24x16 -> 100x32",
		"priority Statusline fields and responsive prompt bounds at all accepted widths",
		"native and inline autocomplete suppression and restoration",
		"long CJK prompt, Welcome scroll-away, live and settled Thought",
		"User/Assistant streaming, settled, narrow fallback, wide resize, Provider-canonical, Session-canonical, and resumed fenced visualizations",
		"metered and API-key subscription Statusline cost behavior",
		"responsive /codex controls, Fast persistence, and offline degradation",
		"native /ui settings, Notification exclusion, enum changes, and restart persistence",
		"native /autoname settings completion, responsive controls, immediate writes, and restart persistence",
		"/ui search, immediate Statusline and Inline changes, Welcome next-launch persistence",
	]) {
		expect(evidence.verified).toContain(required);
	}
}, 120_000);
