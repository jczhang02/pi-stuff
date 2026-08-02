import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ParentAuthorizer } from "../../packages/pi-stuff-permissions/src/authority/approval-escalator.js";
import { ForwardedRequestServer } from "../../packages/pi-stuff-permissions/src/authority/forwarded-request-server.js";
import type { ForwarderContext } from "../../packages/pi-stuff-permissions/src/authority/forwarder-context.js";
import {
	createPermissionForwardingLocation,
	resolvePermissionForwardingRootSessionId,
} from "../../packages/pi-stuff-permissions/src/authority/permission-forwarding.js";
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

async function waitForJsonFile(directory: string): Promise<string> {
	for (let attempt = 0; attempt < 100; attempt++) {
		const files = await readdir(directory).catch(() => []);
		const file = files.find((entry) => entry.endsWith(".json"));
		if (file) return join(directory, file);
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error(`JSON file was not created in ${directory}`);
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

	test("routes a nested child directly to the registered root session", async () => {
		const forwardingDir = await mkdtemp(join(tmpdir(), "pi-stuff-nested-forwarding-"));
		roots.push(forwardingDir);
		const registry = new SubagentSessionRegistry();
		registry.register("parent-child", { parentSessionId: "root-session" });
		registry.register("grandchild", { parentSessionId: "parent-child" });
		expect(resolvePermissionForwardingRootSessionId(registry, "grandchild")).toBe("root-session");
		const nested = new ParentAuthorizer(context("grandchild", false), {
			forwardingDir,
			registry,
			logger,
		});
		const location = createPermissionForwardingLocation(forwardingDir, "root-session");

		const pending = nested.authorize({
			requestId: "nested-tripwire",
			source: "tool_call",
			agentName: "nested-worker",
			message: "Nested destructive call",
		});
		await waitForRequest(location.requestsDir);

		const server = new ForwardedRequestServer({
			forwardingDir,
			registry,
			logger,
			policy: { resolve: () => ({ state: "ask", toolName: "bash", source: "bash", origin: "builtin" }) },
			escalator: { escalate: async () => ({ approved: true, state: "approved" }) },
			recorder: { recordSessionApproval: () => {} },
		});
		await server.processInbox(context("root-session", true));

		expect(await pending).toMatchObject({
			approved: true,
			state: "approved",
			responderSessionId: "root-session",
		});
		expect(existsSync(location.sessionRootDir)).toBe(false);
	});

	test("fails closed when the in-process parent registry contains a cycle", () => {
		const registry = new SubagentSessionRegistry();
		registry.register("child-a", { parentSessionId: "child-b" });
		registry.register("child-b", { parentSessionId: "child-a" });

		expect(resolvePermissionForwardingRootSessionId(registry, "child-a")).toBeNull();
	});

	test("fails closed quickly when no root broker acknowledges the request", async () => {
		const forwardingDir = await mkdtemp(join(tmpdir(), "pi-stuff-unavailable-forwarding-"));
		roots.push(forwardingDir);
		const unavailable = new ParentAuthorizer(context("child-session", false), {
			forwardingDir,
			logger,
			acknowledgementTimeoutMs: 20,
			responseTimeoutMs: 100,
			pollIntervalMs: 5,
			registry: (() => {
				const registry = new SubagentSessionRegistry();
				registry.register("child-session", { parentSessionId: "root-session" });
				return registry;
			})(),
		});
		const location = createPermissionForwardingLocation(forwardingDir, "root-session");

		const decision = await unavailable.authorize({
			requestId: "unavailable-tripwire",
			source: "tool_call",
			agentName: "worker",
			message: "Delete an outside target",
		});

		expect(decision).toEqual({
			approved: false,
			state: "denied_with_reason",
			denialReason: "The root permission broker was unavailable, so the destructive call was denied.",
		});
		expect(existsSync(location.sessionRootDir)).toBe(false);
	});

	test("keeps an acknowledged request alive while the root dialog waits for a person", async () => {
		const forwardingDir = await mkdtemp(join(tmpdir(), "pi-stuff-acknowledged-forwarding-"));
		roots.push(forwardingDir);
		const registry = new SubagentSessionRegistry();
		registry.register("child-session", { parentSessionId: "root-session" });
		const child = new ParentAuthorizer(context("child-session", false), {
			forwardingDir,
			registry,
			logger,
			acknowledgementTimeoutMs: 20,
			responseTimeoutMs: 500,
			pollIntervalMs: 5,
		});
		const location = createPermissionForwardingLocation(forwardingDir, "root-session");
		const pending = child.authorize({
			requestId: "slow-human-tripwire",
			source: "tool_call",
			agentName: "worker",
			message: "Delete an outside target",
		});
		await waitForRequest(location.requestsDir);

		let decide!: (decision: { approved: boolean; state: "approved" }) => void;
		const human = new Promise<{ approved: boolean; state: "approved" }>((resolve) => {
			decide = resolve;
		});
		const server = new ForwardedRequestServer({
			forwardingDir,
			registry,
			logger,
			policy: { resolve: () => ({ state: "ask", toolName: "bash", source: "bash", origin: "builtin" }) },
			escalator: { escalate: () => human },
			recorder: { recordSessionApproval: () => {} },
		});
		const serving = server.processInbox(context("root-session", true));
		const acknowledgementPath = await waitForJsonFile(location.acknowledgementsDir);
		expect((await stat(acknowledgementPath)).mode & 0o777).toBe(0o600);

		let settled = false;
		void pending.finally(() => {
			settled = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(settled).toBe(false);

		decide({ approved: true, state: "approved" });
		await serving;
		expect(await pending).toMatchObject({ approved: true, responderSessionId: "root-session" });
	});

	test("does not accept a response before the target root acknowledges the request", async () => {
		const forwardingDir = await mkdtemp(join(tmpdir(), "pi-stuff-unacknowledged-response-"));
		roots.push(forwardingDir);
		const registry = new SubagentSessionRegistry();
		registry.register("child-session", { parentSessionId: "root-session" });
		const child = new ParentAuthorizer(context("child-session", false), {
			forwardingDir,
			registry,
			logger,
			acknowledgementTimeoutMs: 30,
			responseTimeoutMs: 100,
			pollIntervalMs: 5,
		});
		const location = createPermissionForwardingLocation(forwardingDir, "root-session");
		const pending = child.authorize({
			requestId: "spoof",
			source: "tool_call",
			message: "dangerous call",
			agentName: "general-purpose",
		});
		const requestPath = await waitForRequest(location.requestsDir);
		const request = JSON.parse(await readFile(requestPath, "utf-8")) as { id: string };
		await writeFile(
			join(location.responsesDir, `${request.id}.json`),
			JSON.stringify({
				requestId: request.id,
				targetSessionId: "root-session",
				approved: true,
				state: "approved",
				responderSessionId: "root-session",
				respondedAt: Date.now(),
			}),
			"utf-8",
		);

		expect(await pending).toMatchObject({
			approved: false,
			state: "denied_with_reason",
			denialReason: "The root permission broker was unavailable, so the destructive call was denied.",
		});
	});

	test("rejects an acknowledged response bound to a different root", async () => {
		const forwardingDir = await mkdtemp(join(tmpdir(), "pi-stuff-mismatched-response-"));
		roots.push(forwardingDir);
		const registry = new SubagentSessionRegistry();
		registry.register("child-session", { parentSessionId: "root-session" });
		const child = new ParentAuthorizer(context("child-session", false), {
			forwardingDir,
			registry,
			logger,
			acknowledgementTimeoutMs: 50,
			responseTimeoutMs: 30,
			pollIntervalMs: 5,
		});
		const location = createPermissionForwardingLocation(forwardingDir, "root-session");
		const pending = child.authorize({
			requestId: "misroute",
			source: "tool_call",
			message: "dangerous call",
			agentName: "general-purpose",
		});
		const requestPath = await waitForRequest(location.requestsDir);
		const request = JSON.parse(await readFile(requestPath, "utf-8")) as { id: string };
		await writeFile(
			join(location.acknowledgementsDir, `${request.id}.json`),
			JSON.stringify({ requestId: request.id, targetSessionId: "root-session", acknowledgedAt: Date.now() }),
			"utf-8",
		);
		await writeFile(
			join(location.responsesDir, `${request.id}.json`),
			JSON.stringify({
				requestId: request.id,
				targetSessionId: "other-root",
				approved: true,
				state: "approved",
				responderSessionId: "other-root",
				respondedAt: Date.now(),
			}),
			"utf-8",
		);

		expect(await pending).toMatchObject({
			approved: false,
			state: "denied_with_reason",
			denialReason: "The root permission request expired before a decision.",
		});
	});
});
