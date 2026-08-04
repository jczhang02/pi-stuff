import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { formatCodexToolLines } from "../../packages/pi-stuff-codex/dialog.js";

test("packs complete Codex Tool labels at wide and narrow widths", () => {
	expect(formatCodexToolLines(80)).toEqual(["apply_patch · view_image · imagegen · gpt-image-2"]);
	expect(formatCodexToolLines(46)).toEqual(["apply_patch · view_image", "imagegen · gpt-image-2"]);
	expect(formatCodexToolLines(12)).toEqual(["apply_patch", "view_image", "imagegen"]);
	for (const width of [12, 22, 46, 80]) {
		for (const line of formatCodexToolLines(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
	}
});
