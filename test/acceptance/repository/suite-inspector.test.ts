import { test } from "bun:test";
import { resolve } from "node:path";
import { verifySuiteSurface } from "../../../scripts/verify-package.ts";

test(
	"Suite Tool inspectors and configuration purity through RPC",
	() =>
		verifySuiteSurface(
			process.env["PI_BIN"] ?? "/opt/pi-coding-agent/pi",
			resolve(import.meta.dirname, "../../../packages/pi-stuff"),
		),
	90_000,
);
