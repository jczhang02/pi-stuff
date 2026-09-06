import { test } from "bun:test";
import { resolve } from "node:path";
import { verifyMcpPty } from "../../../scripts/verify-mcp-pty.ts";

test(
	"MCP setup and Tool interaction in the real terminal",
	() =>
		verifyMcpPty({
			piBinary: process.env["PI_BIN"] ?? "/opt/pi-coding-agent/pi",
			packagePath: resolve(import.meta.dirname, "../../../packages/pi-stuff"),
			columns: 64,
			rows: 28,
		}),
	120_000,
);
