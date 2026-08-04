import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { visibleWidth } from "@earendil-works/pi-tui";
import { compactRtkBinaryPath } from "../../packages/pi-stuff-rtk/rtk-dialog.js";

describe("RTK dialog path presentation", () => {
	test("keeps a long managed binary path on one meaningful narrow line", () => {
		const path = `${homedir()}/.local/share/mise/installs/cargo-https-github-com-rtk-ai-rtk/ref-8a7dd7e5570d7744d4b6508479a3674fe8c49286/bin/rtk`;
		const rendered = compactRtkBinaryPath(path, 38);
		expect(rendered).toBe("~/.local/…/bin/rtk");
		expect(visibleWidth(rendered)).toBeLessThanOrEqual(38);
	});

	test("preserves an already compact path verbatim", () => {
		expect(compactRtkBinaryPath("/usr/local/bin/rtk", 38)).toBe("/usr/local/bin/rtk");
	});
});
