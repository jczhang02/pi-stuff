import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
	StreamableHTTPClientTransport,
	type StreamableHTTPClientTransportOptions,
	StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { isRuntimeFunction } from "../../shared/runtime-type.js";
import { abortable, throwIfAborted } from "./abort.ts";
import { logger } from "./logger.ts";
import type { AuthStorageOptions } from "./mcp-auth.ts";
import { extractOAuthConfig, supportsOAuth } from "./mcp-auth-flow.ts";
import { McpOAuthProvider } from "./mcp-oauth-provider.ts";
import { type McpTraceObserver, wrapTransportWithMcpTrace } from "./mcp-trace.ts";
import type { ServerDefinition, Transport } from "./types.ts";
import { resolveBearerToken, resolveCommandSecret, resolveCommandSecretsRecord, resolveServerUrl } from "./utils.ts";

const abortCleanupPromises = new WeakMap<object, Promise<void>>();

type HttpAuthProviderState =
	| { status: "disabled" }
	| { status: "implicit-deferred" }
	| { status: "explicit"; provider: McpOAuthProvider }
	| { status: "implicit-challenged"; provider: McpOAuthProvider };

interface HttpTransportInput {
	authStorageOptions: AuthStorageOptions;
	definition: ServerDefinition;
	oauthSignal: AbortSignal | undefined;
	requestOptions: RequestOptions | undefined;
	serverName: string;
	signal: AbortSignal | undefined;
	traceObserver: McpTraceObserver | undefined;
}

export function isUnauthorizedHttpError<ErrorValue>(error: ErrorValue): boolean {
	return error instanceof UnauthorizedError || (error instanceof StreamableHTTPError && error.code === 401);
}

function normalizeStreamableTransport(transport: StreamableHTTPClientTransport): Transport {
	// SAFETY: SDK 1.30 implements Transport but models its undefined sessionId differently.
	return transport as Transport;
}

export function getAbortCleanupPromise(transport: Transport): Promise<void> | undefined {
	return abortCleanupPromises.get(transport);
}

export async function connectClientWithAbort(
	client: Pick<Client, "connect">,
	transport: Transport,
	requestOptions?: RequestOptions,
	signal?: AbortSignal,
): Promise<void> {
	throwIfAborted(signal);
	let abortCleanup: Promise<void> | undefined;
	const closeTransport = () => {
		abortCleanup = Promise.resolve().then(() => transport.close());
		abortCleanupPromises.set(transport, abortCleanup);
	};
	signal?.addEventListener("abort", closeTransport, { once: true });
	try {
		await abortable(client.connect(transport, requestOptions), signal);
		await abortCleanup;
	} catch (error) {
		if (abortCleanup) {
			try {
				await abortCleanup;
			} catch (cleanupError) {
				throw new AggregateError([error, cleanupError], "MCP connection abort cleanup failed");
			}
		}
		throw error;
	} finally {
		signal?.removeEventListener("abort", closeTransport);
	}
}

export function createSessionTerminator(transport: Transport, serverName: string): (() => Promise<void>) | undefined {
	if (!("terminateSession" in transport) || !isRuntimeFunction(transport.terminateSession)) return undefined;
	const terminateSession = transport.terminateSession.bind(transport);
	return async () => {
		try {
			await terminateSession();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.debug(`MCP: Failed to terminate HTTP session for ${serverName}: ${message}`);
		}
	};
}

export async function createHttpTransport(input: HttpTransportInput): Promise<Transport> {
	const { authStorageOptions, definition, oauthSignal, requestOptions, serverName, signal, traceObserver } = input;
	throwIfAborted(signal);
	const serverUrl = resolveServerUrl(definition);
	if (!serverUrl) throw new Error(`Server ${serverName} has no HTTP URL`);
	const url = new URL(serverUrl);

	const hasCommandHeader = Object.values(definition.headers ?? {}).some(
		(value) => value.startsWith("!") && !value.startsWith("!!"),
	);
	const headers =
		(await resolveCommandSecretsRecord(
			definition.headers,
			(key) => `MCP server "${serverName}" HTTP header "${key}"`,
			signal,
		)) ?? {};
	const commandBearer =
		definition.bearerToken?.startsWith("!") && !definition.bearerToken.startsWith("!!")
			? definition.bearerToken
			: undefined;
	if (definition.auth === "bearer") {
		const token = commandBearer
			? await resolveCommandSecret(commandBearer, `MCP server "${serverName}" HTTP bearer token`, signal)
			: resolveBearerToken(definition);
		if (token) headers["Authorization"] = `Bearer ${token}`;
	}
	if (hasCommandHeader || commandBearer) {
		try {
			new Headers(headers);
		} catch {
			throw new Error(
				`Failed to resolve MCP server "${serverName}" HTTP command secret: command returned an invalid header value`,
			);
		}
	}

	const requestInit = Object.keys(headers).length > 0 ? { headers } : undefined;
	const createAuthProvider = (): McpOAuthProvider =>
		new McpOAuthProvider(
			serverName,
			serverUrl,
			extractOAuthConfig(definition),
			{ onRedirect: async () => undefined },
			authStorageOptions,
			oauthSignal,
		);
	let authState: HttpAuthProviderState = supportsOAuth(definition)
		? definition.auth === undefined
			? { status: "implicit-deferred" }
			: { status: "explicit", provider: createAuthProvider() }
		: { status: "disabled" };

	for (;;) {
		const authProvider = "provider" in authState ? authState.provider : undefined;
		const transportOptions: StreamableHTTPClientTransportOptions = {};
		if (requestInit !== undefined) transportOptions.requestInit = requestInit;
		if (authProvider !== undefined) transportOptions.authProvider = authProvider;
		const streamableTransport = normalizeStreamableTransport(
			new StreamableHTTPClientTransport(url, transportOptions),
		);
		const probeTransport = traceObserver
			? wrapTransportWithMcpTrace(streamableTransport, serverName, "streamable-http", traceObserver)
			: streamableTransport;
		const testClient = new Client({ name: "pi-mcp-probe", version: "2.1.2" });
		let probeCleanupAttempted = false;
		try {
			await connectClientWithAbort(testClient, probeTransport, requestOptions, signal);
			probeCleanupAttempted = true;
			try {
				await createSessionTerminator(streamableTransport, serverName)?.();
				await testClient.close();
			} catch (cleanupError) {
				throw new AggregateError([cleanupError], "MCP HTTP probe cleanup failed");
			}
			return normalizeStreamableTransport(new StreamableHTTPClientTransport(url, transportOptions));
		} catch (error) {
			if (
				error instanceof AggregateError &&
				(error.message === "MCP connection abort cleanup failed" ||
					error.message === "MCP HTTP probe cleanup failed")
			) {
				throw error;
			}
			if (!probeCleanupAttempted) {
				probeCleanupAttempted = true;
				try {
					await (getAbortCleanupPromise(probeTransport) ?? testClient.close());
				} catch (cleanupError) {
					throw new AggregateError([error, cleanupError], "MCP HTTP probe cleanup failed");
				}
			}
			if (signal?.aborted) throwIfAborted(signal);
			if (authState.status === "implicit-deferred" && isUnauthorizedHttpError(error)) {
				authState = { status: "implicit-challenged", provider: createAuthProvider() };
				continue;
			}
			if (isUnauthorizedHttpError(error)) throw error;
			return new SSEClientTransport(url, transportOptions);
		}
	}
}
