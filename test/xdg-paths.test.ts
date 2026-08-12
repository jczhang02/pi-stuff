import { afterEach, describe, expect, test } from "bun:test";
import { getCodeModeHostCachePath } from "../packages/pi-stuff/src/code-mode/host/binary.js";
import { resolveUiSettingsLockPath } from "../packages/pi-stuff/src/conversation-ui/settings.js";
import { xdgCacheHome, xdgConfigHome, xdgRuntimeHome, xdgStateHome } from "../packages/pi-stuff/src/xdg/index.js";

const ORIGINAL_ENVIRONMENT = {
	XDG_CACHE_HOME: process.env["XDG_CACHE_HOME"],
	XDG_CONFIG_HOME: process.env["XDG_CONFIG_HOME"],
	XDG_RUNTIME_DIR: process.env["XDG_RUNTIME_DIR"],
	XDG_STATE_HOME: process.env["XDG_STATE_HOME"],
};

function restoreEnvironment(): void {
	for (const [name, value] of Object.entries(ORIGINAL_ENVIRONMENT)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
}

afterEach(restoreEnvironment);

describe.serial("Pi Stuff XDG paths", () => {
	test("XDG roots accept only absolute environment paths", () => {
		const environment = {
			XDG_CACHE_HOME: "",
			XDG_CONFIG_HOME: "relative/config",
			XDG_RUNTIME_DIR: "relative/runtime",
			XDG_STATE_HOME: " /srv/pi-state ",
		};

		expect(xdgConfigHome(environment, "/users/example")).toBe("/users/example/.config");
		expect(xdgStateHome(environment, "/users/example")).toBe("/srv/pi-state");
		expect(xdgCacheHome(environment, "/users/example")).toBe("/users/example/.cache");
		expect(xdgRuntimeHome(environment)).toBeUndefined();
	});

	test("Code Mode cache uses the Pi Stuff XDG namespace", () => {
		process.env["XDG_CACHE_HOME"] = "/srv/cache";
		expect(getCodeModeHostCachePath("linux", "x64")).toBe(
			"/srv/cache/pi-stuff/code-mode/rust-v0.145.0/linux-x64/codex-code-mode-host",
		);
	});

	test("the default UI lock uses XDG_RUNTIME_DIR while custom stores keep a sibling lock", () => {
		const environment = { XDG_RUNTIME_DIR: "/run/user/1000" };
		expect(resolveUiSettingsLockPath("/srv/config/pi/pi-stuff-ui.json", environment, "/srv/config/pi")).toBe(
			"/run/user/1000/pi-stuff/pi-stuff-ui.json.lock",
		);
		expect(resolveUiSettingsLockPath("/tmp/settings.json", environment, "/srv/config/pi")).toBe(
			"/tmp/settings.json.lock",
		);
	});
});
