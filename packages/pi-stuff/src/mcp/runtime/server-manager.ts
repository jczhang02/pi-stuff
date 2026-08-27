import { Client, type ClientOptions } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, type StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { Resource, Tool } from "@modelcontextprotocol/sdk/types.js";
import { isJsonInputObject, type JsonInputObject, requireJsonInputValue } from "../../shared/json-value.js";
import { isRuntimeNumber, isRuntimeString } from "../../shared/runtime-type.js";
import { abortable, throwIfAborted } from "./abort.ts";
import { createJsonSchemaValidator } from "./json-schema-validator.ts";
import { logger } from "./logger.ts";
import type { AuthStorageOptions } from "./mcp-auth.ts";
import { type McpOAuthRuntime, supportsOAuth } from "./mcp-auth-flow.ts";
import {
	connectClientWithAbort,
	createHttpTransport,
	createSessionTerminator,
	getAbortCleanupPromise,
	isUnauthorizedHttpError,
} from "./mcp-http-transport.ts";
import { probeMcpEndpoint } from "./mcp-probe.ts";
import {
	createMcpTraceWriter,
	isMcpTraceEnabled,
	type McpTraceObserver,
	type McpTraceWriter,
	traceTransportKind,
	wrapTransportWithMcpTrace,
} from "./mcp-trace.ts";
import { resolveNpxBinary } from "./npx-resolver.ts";
import { combineAbortSignals } from "./runtime-owner.ts";
import {
	isServerDisabled,
	type McpResource,
	type McpTool,
	type McpTraceSettings,
	type ServerDefinition,
	type Transport,
} from "./types.ts";
import { UnixSocketClientTransport } from "./unix-socket-transport.ts";
import { resolveCommandSecretsRecord, resolveConfigPath, resolveServerUrl } from "./utils.ts";

const MAX_CAPTURED_STDERR_BYTES = 8 * 1024;
const MAX_CAPTURED_STDERR_LINES = 3;
function optionalJsonObject<Value>(value: Value, description: string): JsonInputObject | undefined {
	if (value === undefined) return undefined;
	if (!isJsonInputObject(value)) throw new TypeError(`${description} must contain only JSON values`);
	return value;
}

function normalizeTool(tool: Tool): McpTool {
	const normalized: McpTool = {
		name: tool.name,
		inputSchema: requireJsonInputValue(tool.inputSchema, `MCP tool "${tool.name}" input schema`),
	};
	if (tool.title !== undefined) normalized.title = tool.title;
	if (tool.description !== undefined) normalized.description = tool.description;
	const metadata = optionalJsonObject(tool._meta, `MCP tool "${tool.name}" metadata`);
	if (metadata !== undefined) normalized._meta = metadata;
	return normalized;
}

function normalizeResource(resource: Resource): McpResource {
	const normalized: McpResource = {
		uri: resource.uri,
		name: resource.name,
	};
	if (resource.description !== undefined) normalized.description = resource.description;
	if (resource.mimeType !== undefined) normalized.mimeType = resource.mimeType;
	const metadata = optionalJsonObject(resource._meta, `MCP resource "${resource.name}" metadata`);
	if (metadata !== undefined) normalized._meta = metadata;
	return normalized;
}

function boundedStderrChunk(chunk: Buffer | string): Buffer {
	if (Buffer.isBuffer(chunk)) {
		const start = Math.max(0, chunk.byteLength - MAX_CAPTURED_STDERR_BYTES);
		return Buffer.from(chunk.subarray(start));
	}

	// Limit string conversion before encoding; Buffer.from(largeString) would
	// otherwise allocate the entire stderr event before applying the cap.
	const suffix = chunk.length > MAX_CAPTURED_STDERR_BYTES ? chunk.slice(-MAX_CAPTURED_STDERR_BYTES) : chunk;
	const bytes = Buffer.from(suffix, "utf8");
	return bytes.byteLength > MAX_CAPTURED_STDERR_BYTES
		? Buffer.from(bytes.subarray(bytes.byteLength - MAX_CAPTURED_STDERR_BYTES))
		: bytes;
}

function appendStderrTail(tail: Buffer, chunk: Buffer | string): Buffer {
	const bytes = boundedStderrChunk(chunk);
	if (bytes.length === 0) return tail;
	if (tail.length === 0) return bytes;
	const combined = Buffer.concat([tail, bytes]);
	return combined.length > MAX_CAPTURED_STDERR_BYTES
		? Buffer.from(combined.subarray(combined.length - MAX_CAPTURED_STDERR_BYTES))
		: combined;
}

export interface ServerConnection {
	client: Client;
	transport: Transport;
	terminateSession?: () => Promise<void>;
	definition: ServerDefinition;
	tools: McpTool[];
	resources: McpResource[];
	instructions?: string;
	lastUsedAt: number;
	inFlight: number;
	status: "connected" | "closed" | "needs-auth";
}

type MetadataListChangedListener = (serverName: string, reason: string) => void;

export class McpServerManager {
	private readonly defaultCwd: string | undefined;
	private connections = new Map<string, ServerConnection>();
	private connectPromises = new Map<string, Promise<ServerConnection>>();
	private reconnectPromises = new Map<string, Promise<ServerConnection>>();
	private metadataListChangedListener: MetadataListChangedListener | undefined;
	private authStorageOptions: AuthStorageOptions = {};
	private oauthRuntime: McpOAuthRuntime | undefined;
	private defaultRequestTimeoutMs: number | undefined;
	private runtimeSignal: AbortSignal | undefined;
	private closePromises = new Map<string, Promise<void>>();
	private closeGenerations = new Map<string, number>();
	private connectAttempts = new Map<string, AbortController>();
	private traceSettings: McpTraceSettings | undefined;
	private traceWriter: McpTraceWriter | undefined;
	private stopped = false;

	/** Default cwd for stdio servers without an explicit config `cwd`. */
	constructor(defaultCwd?: string) {
		this.defaultCwd = defaultCwd;
	}

	setMetadataListChangedListener(listener: MetadataListChangedListener | undefined): void {
		this.metadataListChangedListener = listener;
	}

	setRuntimeSignal(signal: AbortSignal | undefined): void {
		this.runtimeSignal = signal;
	}

	setDefaultRequestTimeoutMs(timeoutMs: number | undefined): void {
		this.defaultRequestTimeoutMs = normalizeRequestTimeoutMs(timeoutMs);
	}

	setTraceConfig(settings: McpTraceSettings | undefined): void {
		this.traceSettings = settings;
	}

	setAuthStorageOptions(options: AuthStorageOptions): void {
		this.authStorageOptions = options;
	}

	setOAuthRuntime(runtime: McpOAuthRuntime): void {
		this.oauthRuntime = runtime;
	}

	getRequestOptions(name: string, signal?: AbortSignal): RequestOptions | undefined {
		return this.buildRequestOptions(this.connections.get(name)?.definition, signal);
	}

	private getResolvedRequestTimeoutMs(definition?: ServerDefinition): number | undefined {
		if (definition?.requestTimeoutMs !== undefined) {
			return normalizeRequestTimeoutMs(definition.requestTimeoutMs);
		}
		return this.defaultRequestTimeoutMs;
	}

	private buildRequestOptions(definition?: ServerDefinition, signal?: AbortSignal): RequestOptions | undefined {
		const timeout = this.getResolvedRequestTimeoutMs(definition);
		const ownedSignal = combineAbortSignals(this.runtimeSignal, signal);

		if (!ownedSignal && timeout === undefined) {
			return undefined;
		}

		const options: RequestOptions = {};
		if (ownedSignal) options.signal = ownedSignal;
		if (timeout !== undefined) options.timeout = timeout;
		return options;
	}

	async connect(name: string, definition: ServerDefinition, signal?: AbortSignal): Promise<ServerConnection> {
		if (isServerDisabled(definition)) throw new Error(`MCP server "${name}" is disabled`);
		if (this.stopped) throw new Error("MCP server manager is closed");
		const ownedSignal = combineAbortSignals(this.runtimeSignal, signal);
		throwIfAborted(ownedSignal);
		const closing = this.closePromises.get(name);
		if (closing) await abortable(closing, ownedSignal);
		throwIfAborted(ownedSignal);

		// Dedupe concurrent connection attempts.
		const pendingConnection = this.connectPromises.get(name);
		if (pendingConnection) return abortable(pendingConnection, ownedSignal);

		const existing = this.connections.get(name);
		if (existing?.status === "connected") {
			existing.lastUsedAt = Date.now();
			return existing;
		}

		const generation = this.closeGenerations.get(name) ?? 0;
		const attemptController = new AbortController();
		const attemptSignal = combineAbortSignals(ownedSignal, attemptController.signal);
		const connectionAttempt = this.createConnection(name, definition, attemptSignal, ownedSignal);
		const promise = definition.url
			? connectionAttempt.catch(async (error) => {
					throw await this.enrichHttpConnectionError(definition, error);
				})
			: connectionAttempt;
		this.connectPromises.set(name, promise);
		this.connectAttempts.set(name, attemptController);

		try {
			const connection = await promise;
			if (attemptController.signal.aborted || (this.closeGenerations.get(name) ?? 0) !== generation) {
				await this.disposeConnection(connection);
				throwIfAborted(attemptSignal);
				throw new Error(`MCP connection for ${name} was closed while connecting`);
			}
			this.connections.set(name, connection);
			return connection;
		} finally {
			if (this.connectPromises.get(name) === promise) this.connectPromises.delete(name);
			if (this.connectAttempts.get(name) === attemptController) this.connectAttempts.delete(name);
		}
	}

	/**
	 * Reconnect a server whose connection was proven stale (e.g. by a 404
	 * "session no longer exists" response). Single-flight per server name —
	 * concurrent callers that raced to the same failure share one reconnect —
	 * and identity-guarded: `staleConnection` is only torn down if it is
	 * still the manager's current connection for `name`. If a concurrent
	 * reconnect (or an unrelated connect()) already replaced it with a fresh
	 * connection, that fresh connection is returned untouched.
	 */
	async reconnect(
		name: string,
		definition: ServerDefinition,
		staleConnection: ServerConnection,
		signal?: AbortSignal,
	): Promise<ServerConnection> {
		if (isServerDisabled(definition)) throw new Error(`MCP server "${name}" is disabled`);
		if (this.stopped) throw new Error("MCP server manager is closed");
		const ownedSignal = combineAbortSignals(this.runtimeSignal, signal);
		throwIfAborted(ownedSignal);
		const inFlight = this.reconnectPromises.get(name);
		if (inFlight) {
			return abortable(inFlight, ownedSignal);
		}

		const promise = this.doReconnect(name, definition, staleConnection, ownedSignal).finally(() => {
			if (this.reconnectPromises.get(name) === promise) {
				this.reconnectPromises.delete(name);
			}
		});
		this.reconnectPromises.set(name, promise);
		return abortable(promise, ownedSignal);
	}

	private async doReconnect(
		name: string,
		definition: ServerDefinition,
		staleConnection: ServerConnection,
		signal?: AbortSignal,
	): Promise<ServerConnection> {
		throwIfAborted(signal);
		const current = this.connections.get(name);

		// Never tear down a connection we didn't prove stale: if the map no
		// longer holds the connection we were asked to replace, someone else
		// already reconnected (or connected) first.
		if (current !== staleConnection) {
			return current ?? this.connect(name, definition, signal);
		}

		const staleInFlight = staleConnection.inFlight;
		await this.close(name);
		const fresh = await this.connect(name, definition, signal);
		fresh.inFlight = Math.max(fresh.inFlight, staleInFlight);
		return fresh;
	}

	private async createTransport(
		name: string,
		definition: ServerDefinition,
		requestOptions: RequestOptions | undefined,
		signal?: AbortSignal,
		traceObserver?: McpTraceObserver,
	) {
		let stderrTail: Buffer<ArrayBufferLike> = Buffer.alloc(0);
		const configuredTransports = [definition.command, definition.url, definition.socket].filter(
			(value) => isRuntimeString(value) && value.length > 0,
		);
		if (configuredTransports.length !== 1) {
			throw new Error(`Server ${name} must configure exactly one of command, url, or socket`);
		}

		let transport: Transport;
		let terminateSession: (() => Promise<void>) | undefined;
		if (definition.command) {
			let command = definition.command;
			let args = definition.args ?? [];
			if (command === "npx" || command === "npm") {
				const resolved = await resolveNpxBinary(command, args, signal);
				if (resolved) {
					command = resolved.isJs ? "node" : resolved.binPath;
					args = resolved.isJs ? [resolved.binPath, ...resolved.extraArgs] : resolved.extraArgs;
					logger.debug(`${name} resolved to ${resolved.binPath} (skipping npm parent)`);
				}
			}
			throwIfAborted(signal);
			const cwd = resolveConfigPath(definition.cwd) ?? this.defaultCwd;
			const stdioOptions: StdioServerParameters = {
				command,
				args,
				env: await resolveEnv(definition.env, name, signal),
				stderr: definition.debug ? "inherit" : "pipe",
			};
			if (cwd !== undefined) stdioOptions.cwd = cwd;
			const stdioTransport = new StdioClientTransport(stdioOptions);
			// Retain only a bounded diagnostic tail without changing debug behavior.
			stdioTransport.stderr?.on("data", (chunk: Buffer | string) => {
				stderrTail = appendStderrTail(stderrTail, chunk);
			});
			transport = stdioTransport;
		} else if (definition.url) {
			transport = await createHttpTransport({
				authStorageOptions: this.authStorageOptions,
				definition,
				oauthSignal: this.oauthRuntime?.signal,
				requestOptions,
				serverName: name,
				signal,
				traceObserver,
			});
			terminateSession = createSessionTerminator(transport, name);
		} else {
			const socketPath = resolveConfigPath(definition.socket);
			if (!socketPath) throw new Error(`Server ${name} has no Unix socket path`);
			transport = new UnixSocketClientTransport(socketPath);
		}

		if (traceObserver) {
			transport = wrapTransportWithMcpTrace(
				transport,
				name,
				traceTransportKind(definition, transport),
				traceObserver,
			);
		}
		return { readStderrTail: () => stderrTail, terminateSession, transport };
	}

	private async createConnection(
		name: string,
		definition: ServerDefinition,
		signal?: AbortSignal,
		requestSignal?: AbortSignal,
	): Promise<ServerConnection> {
		throwIfAborted(signal);
		const client = this.createClient(name);

		const tracingEnabled = isMcpTraceEnabled(definition, this.traceSettings);
		let traceWriter = tracingEnabled ? this.traceWriter : undefined;
		if (tracingEnabled && !traceWriter) {
			traceWriter = createMcpTraceWriter(this.defaultCwd, this.traceSettings ?? {});
			this.traceWriter = traceWriter;
		}
		const traceObserver: McpTraceObserver | undefined = traceWriter
			? { record: (event) => traceWriter.write(event) }
			: undefined;
		const requestOptions = this.buildRequestOptions(definition, requestSignal);
		const { readStderrTail, terminateSession, transport } = await this.createTransport(
			name,
			definition,
			requestOptions,
			signal,
			traceObserver,
		);

		throwIfAborted(signal);
		try {
			await connectClientWithAbort(client, transport, requestOptions, signal);

			const instructions = client.getInstructions?.();
			const connection: ServerConnection = {
				client,
				transport,
				definition,
				tools: [],
				resources: [],
				lastUsedAt: Date.now(),
				inFlight: 0,
				status: "connected",
			};
			if (terminateSession !== undefined) connection.terminateSession = terminateSession;
			if (instructions !== undefined) connection.instructions = instructions;

			// Reflect the SDK's own close signal in connection status, guarded by
			// identity so a stale connection's late close (e.g. the old
			// connection from before a session-recovery reconnect) can never
			// clobber a fresh connection that has since taken its place in
			// `this.connections`. This intentionally uses `client.onclose`
			// (Protocol's public hook), not `transport.onclose` — the SDK's
			// Protocol takes ownership of that one internally for pending-request
			// rejection, and overwriting it would break that. `client.onerror` is
			// avoided too: it can fire on benign events (e.g. the optional GET
			// SSE stream failing) that don't mean the connection is closed.
			client.onclose = () => {
				if (this.connections.get(name) === connection) {
					connection.status = "closed";
				}
			};

			const [tools, resources] = await Promise.all([
				this.fetchAllTools(client, requestOptions),
				this.fetchAllResources(client, requestOptions),
			]);
			connection.tools = tools;
			connection.resources = resources;

			return connection;
		} catch (error) {
			// If connectClientWithAbort closed the transport, await that exact close.
			// Otherwise the SDK client owns its transport, so client.close() is the
			// single cleanup operation rather than closing the transport twice.
			const abortCleanup = getAbortCleanupPromise(transport);
			const abortCleanupFailed =
				error instanceof AggregateError && error.message === "MCP connection abort cleanup failed";
			const cleanupResults = abortCleanupFailed
				? []
				: await Promise.allSettled([abortCleanup ?? Promise.resolve().then(() => client.close())]);
			const cleanupFailures = cleanupResults.flatMap((result) =>
				result.status === "rejected" ? [result.reason] : [],
			);
			let reportedError = error;
			if (cleanupFailures.length > 0) {
				reportedError = new AggregateError([error, ...cleanupFailures], "MCP connection setup failed");
			}

			// Check for UnauthorizedError - server requires OAuth. A cleanup failure
			// remains a setup failure rather than being hidden behind needs-auth.
			if (isUnauthorizedHttpError(error) && supportsOAuth(definition) && cleanupFailures.length === 0) {
				return {
					client,
					transport,
					definition,
					tools: [],
					resources: [],
					lastUsedAt: Date.now(),
					inFlight: 0,
					status: "needs-auth",
				};
			}

			const stderrTail = readStderrTail();
			if (stderrTail.length > 0) {
				const stderrText = stderrTail.toString("utf8").trim();
				const lines = stderrText
					.split(/\r?\n/)
					.map((line) => line.trim())
					.filter(Boolean);
				if (lines.length > 0) {
					const baseMessage = reportedError instanceof Error ? reportedError.message : String(reportedError);
					const detail = lines.slice(-MAX_CAPTURED_STDERR_LINES).join(" — ");
					throw new Error(`${baseMessage} (${detail})`, { cause: reportedError });
				}
			}
			throw reportedError;
		}
	}

	private async enrichHttpConnectionError<ErrorValue>(
		definition: ServerDefinition,
		error: ErrorValue,
	): Promise<Error> {
		const originalMessage = error instanceof Error ? error.message : String(error);
		try {
			const serverUrl = resolveServerUrl(definition);
			if (!serverUrl) throw new Error("MCP server URL is missing");
			const probe = await probeMcpEndpoint(serverUrl);
			return new Error(`${originalMessage} — probe: ${probe.classification}`, { cause: error });
		} catch {
			return error instanceof Error ? error : new Error(originalMessage);
		}
	}

	private createClient(serverName: string): Client {
		let client: Client;
		const clientOptions: ClientOptions = {
			jsonSchemaValidator: createJsonSchemaValidator(),
			listChanged: {
				tools: {
					onChanged: (error, tools) => {
						this.handleToolsListChanged(serverName, client, error, tools?.map(normalizeTool) ?? null);
					},
				},
				resources: {
					onChanged: (error, resources) => {
						this.handleResourcesListChanged(serverName, client, error, resources?.map(normalizeResource) ?? null);
					},
				},
			},
		};
		client = new Client({ name: `pi-mcp-${serverName}`, version: "1.0.0" }, clientOptions);
		return client;
	}

	private handleToolsListChanged(
		serverName: string,
		client: Client,
		error: Error | null,
		tools: McpTool[] | null,
	): void {
		if (error) {
			logger.debug(`MCP: tools/list_changed refresh failed for ${serverName}: ${error.message}`);
			return;
		}
		if (!tools) return;
		const connection = this.connections.get(serverName);
		if (!connection || connection.client !== client || connection.status !== "connected") return;
		connection.tools = tools;
		this.metadataListChangedListener?.(serverName, "tools-list-changed");
	}

	private handleResourcesListChanged(
		serverName: string,
		client: Client,
		error: Error | null,
		resources: McpResource[] | null,
	): void {
		if (error) {
			logger.debug(`MCP: resources/list_changed refresh failed for ${serverName}: ${error.message}`);
			return;
		}
		if (!resources) return;
		const connection = this.connections.get(serverName);
		if (!connection || connection.client !== client || connection.status !== "connected") return;
		connection.resources = resources;
		this.metadataListChangedListener?.(serverName, "resources-list-changed");
	}

	private async fetchAllTools(client: Client, requestOptions?: RequestOptions): Promise<McpTool[]> {
		const allTools: McpTool[] = [];
		let cursor: string | undefined;

		do {
			const result = await client.listTools(cursor ? { cursor } : undefined, requestOptions);
			allTools.push(...(result.tools ?? []).map(normalizeTool));
			cursor = result.nextCursor;
		} while (cursor);

		return allTools;
	}

	private async fetchAllResources(client: Client, requestOptions?: RequestOptions): Promise<McpResource[]> {
		const capabilities = client.getServerCapabilities?.();
		if (!capabilities?.resources) return [];

		try {
			const allResources: McpResource[] = [];
			let cursor: string | undefined;

			do {
				const result = await client.listResources(cursor ? { cursor } : undefined, requestOptions);
				allResources.push(...(result.resources ?? []).map(normalizeResource));
				cursor = result.nextCursor;
			} while (cursor);

			return allResources;
		} catch {
			if (requestOptions?.signal?.aborted) {
				throwIfAborted(requestOptions.signal);
			}
			// The server advertises resources but the listing failed
			return [];
		}
	}

	async close(name: string): Promise<void> {
		this.closeGenerations.set(name, (this.closeGenerations.get(name) ?? 0) + 1);
		this.connectAttempts.get(name)?.abort(new Error(`MCP connection ${name} was closed`));

		const connection = this.connections.get(name);
		if (!connection) {
			const pendingClose = this.closePromises.get(name);
			if (pendingClose) {
				await pendingClose;
				return;
			}
			const pendingConnect = this.connectPromises.get(name);
			if (pendingConnect) {
				try {
					await pendingConnect;
				} catch (error) {
					if (this.containsCleanupFailure(error)) throw error;
				}
			}
			return;
		}

		// Delete before awaiting SDK cleanup so a replacement cannot be removed by
		// an old close operation finishing later.
		connection.status = "closed";
		this.connections.delete(name);
		const closing = this.disposeConnection(connection).finally(() => {
			if (this.closePromises.get(name) === closing) this.closePromises.delete(name);
		});
		this.closePromises.set(name, closing);
		return closing;
	}

	private async disposeConnection(connection: ServerConnection): Promise<void> {
		const results = await Promise.allSettled([
			Promise.resolve().then(async () => {
				await connection.terminateSession?.();
				await connection.client.close();
			}),
			this.traceWriter?.flush() ?? Promise.resolve(),
		]);
		const failures = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
		if (failures.length > 0) throw new AggregateError(failures, "MCP connection cleanup failed");
	}

	async closeAll(): Promise<void> {
		this.stopped = true;
		const names = new Set([...this.connections.keys(), ...this.connectPromises.keys()]);
		for (const name of names) {
			this.closeGenerations.set(name, (this.closeGenerations.get(name) ?? 0) + 1);
			this.connectAttempts.get(name)?.abort(new Error(`MCP connection ${name} was closed`));
		}

		const pendingConnects = [...this.connectPromises.values()];
		const currentNames = [...this.connections.keys()];
		const pendingResults = await Promise.allSettled(pendingConnects);
		const results = await Promise.allSettled(currentNames.map((name) => this.close(name)));

		// A connect that resolved during the first close snapshot is still fenced;
		// close any handle that was already inserted before its attempt settled.
		const lateNames = [...this.connections.keys()];
		const lateResults = await Promise.allSettled(lateNames.map((name) => this.close(name)));
		const failures = [...pendingResults, ...results, ...lateResults]
			.flatMap((result) => (result.status === "rejected" ? [result.reason] : []))
			.filter((error) => this.containsCleanupFailure(error));
		await this.traceWriter?.flush();
		if (failures.length > 0) throw new AggregateError(failures, "MCP manager cleanup failed");
	}

	private containsCleanupFailure<ErrorValue>(error: ErrorValue): boolean {
		const pending: unknown[] = [error];
		const seen = new Set<unknown>();
		while (pending.length > 0) {
			const current = pending.pop();
			if (!(current instanceof Error) || seen.has(current)) continue;
			seen.add(current);
			if (current instanceof AggregateError) {
				if (/cleanup failed|setup failed/.test(current.message)) return true;
				pending.push(...current.errors);
			}
			if (current.cause !== undefined) pending.push(current.cause);
		}
		return false;
	}

	getConnection(name: string): ServerConnection | undefined {
		return this.connections.get(name);
	}

	getAllConnections(): Map<string, ServerConnection> {
		return new Map(this.connections);
	}

	touch(name: string): void {
		const connection = this.connections.get(name);
		if (connection) {
			connection.lastUsedAt = Date.now();
		}
	}

	incrementInFlight(name: string): void {
		const connection = this.connections.get(name);
		if (connection) {
			connection.inFlight = (connection.inFlight ?? 0) + 1;
		}
	}

	decrementInFlight(name: string): void {
		const connection = this.connections.get(name);
		if (connection?.inFlight) {
			connection.inFlight--;
		}
	}

	isIdle(name: string, timeoutMs: number): boolean {
		const connection = this.connections.get(name);
		if (connection?.status !== "connected") return false;
		if (connection.inFlight > 0) return false;
		return Date.now() - connection.lastUsedAt > timeoutMs;
	}
}

/**
 * Resolve environment variables with interpolation.
 */
async function resolveEnv(
	env: Record<string, string> | undefined,
	serverName: string,
	signal?: AbortSignal,
): Promise<Record<string, string>> {
	const resolved: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined) resolved[key] = value;
	}
	const overrides = await resolveCommandSecretsRecord(
		env,
		(key) => `MCP server "${serverName}" stdio env "${key}"`,
		signal,
	);
	return overrides ? { ...resolved, ...overrides } : resolved;
}

function normalizeRequestTimeoutMs(timeoutMs: number | undefined): number | undefined {
	return isRuntimeNumber(timeoutMs) && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : undefined;
}
