// session-recovery.ts
//
// Streamable HTTP session recovery.
//
// Per the MCP spec (Streamable HTTP transport):
//   "When a client receives HTTP 404 in response to a request containing an
//   Mcp-Session-Id, it MUST start a new session by sending a new
//   InitializeRequest without a session ID attached."
//
// A 404 for a request that carried a session ID is therefore the spec's own
// definition of "this session no longer exists" (e.g. the remote server
// process restarted and lost its in-memory session table). Because the spec
// requires the server to reject the request *before* processing it, retrying
// the same call against a freshly initialized session cannot double-execute
// the original request.
//
// This module intentionally does NOT:
//   - match broad error messages without a prior session id
//   - match generic HTTP 400 responses, which are ambiguous and can mean
//     many things other than "your session is gone"
//   - treat generic -32000/ConnectionClosed errors as session expiry
//   - treat AbortError/cancellation as a session failure
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { logger } from "./logger.ts";
import type { McpServerManager, ServerConnection } from "./server-manager.ts";
import { isServerDisabled, type McpConfig } from "./types.ts";

/**
 * True when `err` is a stale Streamable HTTP session signal for a request
 * sent while carrying an `Mcp-Session-Id`: the spec's 404 transport
 * response, or the narrowly-known `-32000 Server not initialized` protocol
 * gate response some servers emit before dispatching to a handler.
 *
 * `hadSessionId` must reflect the transport's session id from *before* the
 * call that produced `err` was made. The installed SDK (1.30.0) does not
 * clear `transport.sessionId` on a 404 response, so callers must capture it
 * before the call rather than rely on catch-time transport state.
 */
const SERVER_NOT_INITIALIZED_MCP_MESSAGES = new Set([
	`MCP error ${ErrorCode.ConnectionClosed}: Server not initialized`,
	`MCP error ${ErrorCode.ConnectionClosed}: Bad Request: Server not initialized`,
]);

export function isTerminatedSession<ErrorValue>(err: ErrorValue, hadSessionId: boolean): boolean {
	if (!hadSessionId) return false;
	if (err instanceof StreamableHTTPError) {
		return (
			err.code === 404 ||
			(err.code === 400 &&
				/"code"\s*:\s*-32000/.test(err.message) &&
				/"message"\s*:\s*"Bad Request: Server not initialized"/.test(err.message))
		);
	}
	return (
		err instanceof McpError &&
		err.code === ErrorCode.ConnectionClosed &&
		SERVER_NOT_INITIALIZED_MCP_MESSAGES.has(err.message)
	);
}

function hasSessionId(connection: ServerConnection): boolean {
	// Only StreamableHTTPClientTransport exposes `sessionId`; stdio/SSE
	// transports (and test doubles that omit `transport` entirely) simply
	// read as `undefined` here.
	const transport = connection.transport;
	return !!transport && "sessionId" in transport && transport.sessionId != null;
}

export class SessionRecoveryAuthRequiredError extends Error {
	readonly serverName: string;
	readonly authMessage: string | undefined;

	constructor(serverName: string, authMessage?: string) {
		super(authMessage ?? `MCP server "${serverName}" requires OAuth authentication after reconnect.`);
		this.name = "SessionRecoveryAuthRequiredError";
		this.serverName = serverName;
		this.authMessage = authMessage;
	}
}

export interface SessionRecoveryDeps {
	manager: McpServerManager;
	config: McpConfig;
	signal?: AbortSignal;
	onNeedsAuth?: (serverName: string) => Effect.Effect<ServerConnection | undefined, Error>;
}

function checkSignal(signal?: AbortSignal): Effect.Effect<void, Error> {
	return Effect.try({
		try: () => signal?.throwIfAborted(),
		catch: (error) => (error instanceof Error ? error : new Error(String(error))),
	});
}

/**
 * Runs `fn` against the current connection for `serverName`. If it fails
 * with a terminated Streamable HTTP session (see `isTerminatedSession`),
 * reconnects exactly once via `McpServerManager.reconnect` (single-flight,
 * identity-guarded — see server-manager.ts) and retries `fn` exactly once
 * against the fresh connection.
 *
 * Any other failure — including a second failure after reconnecting, or the
 * server having been removed from config in the meantime — propagates
 * unchanged through the caller's existing error handling.
 */
export function withSessionRecovery<T>(
	deps: SessionRecoveryDeps,
	serverName: string,
	fn: (conn: ServerConnection) => Effect.Effect<T, Error>,
): Effect.Effect<T, Error> {
	return Effect.gen(function* () {
		if (isServerDisabled(deps.config.mcpServers[serverName])) {
			return yield* Effect.fail(new Error(`MCP server "${serverName}" is disabled`));
		}
		const connection = deps.manager.getConnection(serverName);
		if (!connection) return yield* Effect.fail(new Error(`Server "${serverName}" is not connected`));

		const hadSessionId = hasSessionId(connection);
		const first = yield* Effect.exit(fn(connection));
		if (Exit.isSuccess(first)) return first.value;
		const original = Cause.squash(first.cause);
		const error = original instanceof Error ? original : new Error(String(original));
		if (!isTerminatedSession(original, hadSessionId)) return yield* Effect.fail(error);

		// Re-read the live definition rather than reusing the stale
		// connection's definition, in case config changed since connect.
		const definition = deps.config.mcpServers[serverName];
		if (!definition) return yield* Effect.fail(error);

		yield* checkSignal(deps.signal);
		logger.debug(`MCP session for "${serverName}" expired; reconnecting`, { server: serverName });
		let freshConnection = yield* deps.manager.reconnectEffect(serverName, definition, connection, deps.signal);
		yield* checkSignal(deps.signal);

		if (freshConnection.status === "needs-auth") {
			const recovered = deps.onNeedsAuth ? yield* deps.onNeedsAuth(serverName) : undefined;
			freshConnection = recovered ?? freshConnection;
			yield* checkSignal(deps.signal);
		}
		if (freshConnection.status === "needs-auth") {
			return yield* Effect.fail(new SessionRecoveryAuthRequiredError(serverName));
		}
		if (freshConnection.status !== "connected") return yield* Effect.fail(error);
		return yield* fn(freshConnection);
	});
}
