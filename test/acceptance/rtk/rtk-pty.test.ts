import { test } from "bun:test";
import { resolve } from "node:path";
import { verifyRtkPty } from "../../../scripts/verify-rtk-pty.ts";

test(
	"RTK settings and command projection in the real terminal",
	() =>
		verifyRtkPty({
			piBinary: process.env["PI_BIN"] ?? "/opt/pi-coding-agent/pi",
			packagePath: resolve(import.meta.dirname, "../../../packages/pi-stuff"),
		}),
	120_000,
);
