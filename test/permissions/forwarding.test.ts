import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ParentAuthorizer } from "../../packages/pi-stuff-permissions/src/authority/approval-escalator.js";
import { ForwardedRequestServer } from "../../packages/pi-stuff-permissions/src/authority/forwarded-request-server.js";
import type { ForwarderContext } from "../../packages/pi-stuff-permissions/src/authority/forwarder-context.js";
import { createPermissionForwardingLocation } from "../../packages/pi-stuff-permissions/src/authority/permission-forwarding.js";
import type { PromptPermissionDetails } from "../../packages/pi-stuff-permissions/src/authority/permission-prompter.js";
import { SubagentSessionRegistry } from "../../packages/pi-stuff-permissions/src/authority/subagent-registry.js";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function context(sessionId: string, hasUI: boolean): ForwarderContext {
	return {
		hasUI,
		cwd: "/workspace/project",
		ui: {
			select: async () => undefined,
			input: async () => undefined,
		},
		sessionManager: {
			getSessionId: () => sessionId,
			getSessionDir: () => "/tmp/session",
			getEntries: () => [],
		},
	};
}

const logger = {
	debug: () => {},
	review: () => {},
};

async function waitForRequest(requestsDir: string): Promise<string> {
	for (let attempt = 0; attempt < 100; attempt++) {
		const files = await readdir(requestsDir).catch(() => []);
		const request = files.find((file) => file.endsWith(".json"));
		if (request) return join(requestsDir, request);
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("Forwarded permission request was not created");
}

describe("permission forwarding", () => {
	test("forwards one direct child ask to the root with identity and owner-only artifacts", async () => {
		const forwardingDir = await mkdtemp(join(tmpdir(), "pi-stuff-forwarding-"));
		roots.push(forwardingDir);
		const registry = new SubagentSessionRegistry();
		registry.register("child-session", { parentSessionId: "root-session" });
		const child = new ParentAuthorizer(context("child-session", false), {
			forwardingDir,
			registry,
			logger,
		});
		const location = createPermissionForwardingLocation(forwardingDir, "root-session");
		const pending = child.authorize({
			requestId: "child-tripwire",
			source: "tool_call",
			agentName: "worker",
			message: "Delete an outside target",
			toolName: "bash",
			command: "rm ../outside.txt",
			exactCallOnly: true,
			tripwire: {
				command: "rm ../outside.txt",
				cwd: "/workspace/project",
				operation: "rm",
				reason: "outside cwd",
				targets: ["/workspace/outside.txt"],
			},
			accessIntent: {
				surface: "bash",
				matchValues: ["rm ../outside.txt"],
				boundaryValue: null,
			},
		});

		const requestPath = await waitForRequest(location.requestsDir);
		expect((await stat(location.sessionRootDir)).mode & 0o777).toBe(0o700);
		expect((await stat(location.requestsDir)).mode & 0o777).toBe(0o700);
		expect((await stat(requestPath)).mode & 0o777).toBe(0o600);

		let escalated: PromptPermissionDetails | undefined;
		let resolvedPrincipal: { sessionId: string; agentName: string } | undefined;
		const server = new ForwardedRequestServer({
			forwardingDir,
			registry,
			logger,
			policy: {
				resolve: (intent) => {
					resolvedPrincipal = intent.principal;
					return { state: "ask", toolName: "bash", source: "bash", origin: "builtin" };
				},
			},
			escalator: {
				escalate: async (details) => {
					escalated = details;
					return { approved: true, state: "approved" };
				},
			},
			recorder: { recordSessionApproval: () => {} },
		});

		await server.processInbox(context("root-session", true));
		expect(await pending).toMatchObject({
			approved: true,
			state: "approved",
			responderSessionId: "root-session",
		});
		expect(resolvedPrincipal).toEqual({ sessionId: "child-session", agentName: "unknown" });
		expect(escalated).toMatchObject({
			exactCallOnly: true,
			forwarding: { requesterSessionId: "child-session" },
			tripwire: { command: "rm ../outside.txt", cwd: "/workspace/project" },
		});
		expect(existsSync(location.sessionRootDir)).toBe(false);
	});

	test("denies a nested child immediately without creating a forwarding request", async () => {
		const forwardingDir = await mkdtemp(join(tmpdir(), "pi-stuff-nested-forwarding-"));
		roots.push(forwardingDir);
		const registry = new SubagentSessionRegistry();
		registry.register("parent-child", { parentSessionId: "root-session" });
		registry.register("grandchild", { parentSessionId: "parent-child" });
		const nested = new ParentAuthorizer(context("grandchild", false), {
			forwardingDir,
			registry,
			logger,
		});

		const decision = await nested.authorize({
			requestId: "nested-tripwire",
			source: "tool_call",
			agentName: "nested-worker",
			message: "Nested destructive call",
		});

		expect(decision).toMatchObject({ approved: false, state: "denied_with_reason" });
		expect(decision.denialReason).toContain("Nested-Agent approval is not yet root-routed");
		expect(existsSync(join(forwardingDir, "sessions"))).toBe(false);
	});
});
