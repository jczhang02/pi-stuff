import { test } from "bun:test";
import { resolve } from "node:path";
import { verifyPiHostSeams } from "../../../scripts/verify-pi-host-seams.ts";

test(
	"Pi public Host seams preserve lifecycle ownership",
	() =>
		verifyPiHostSeams({
			piBinary: process.env["PI_BIN"] ?? "/opt/pi-coding-agent/pi",
			packagePath: resolve(import.meta.dirname, "../../../packages/pi-stuff"),
		}),
	120_000,
);
