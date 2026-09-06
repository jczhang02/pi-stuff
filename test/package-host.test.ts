import { test } from "bun:test";
import { resolve } from "node:path";
import { verifyGoalLifecycle } from "../scripts/verify-goal-lifecycle.ts";
import { verifyMcpPty } from "../scripts/verify-mcp-pty.ts";
import { verifyNotificationPty } from "../scripts/verify-notification-pty.ts";
import { verifySuiteSurface } from "../scripts/verify-package.ts";
import { verifyPiHostSeams } from "../scripts/verify-pi-host-seams.ts";
import { verifyRtkPty } from "../scripts/verify-rtk-pty.ts";
import { verifyWebIntegration } from "../scripts/verify-web-integration.ts";

const piBinary = process.env["PI_BIN"] ?? "/opt/pi-coding-agent/pi";
const packagePath = resolve(import.meta.dirname, "../packages/pi-stuff");

test(
	"Suite Tool inspectors and configuration purity through RPC",
	() => verifySuiteSurface(piBinary, packagePath),
	90_000,
);
test("Web integrates with local HTTP fixtures", () => verifyWebIntegration({ packagePath }), 120_000);
test("Goal lifecycle through the complete Suite", () => verifyGoalLifecycle({ piBinary, packagePath }), 120_000);
test(
	"Notification interactions in the real terminal",
	() => verifyNotificationPty({ piBinary, packagePath, columns: 64, rows: 28 }),
	120_000,
);
test("Pi public Host seams preserve lifecycle ownership", () => verifyPiHostSeams({ piBinary, packagePath }), 120_000);
test(
	"RTK settings and command projection in the real terminal",
	() => verifyRtkPty({ piBinary, packagePath }),
	120_000,
);
test(
	"MCP setup and Tool interaction in the real terminal",
	() => verifyMcpPty({ piBinary, packagePath, columns: 64, rows: 28 }),
	120_000,
);
