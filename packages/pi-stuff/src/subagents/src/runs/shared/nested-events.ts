import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentWorkOrigin } from "../../../../conversation-ui/agent-run-origin.js";
import { parseJsonValue } from "../../../../shared/json-value.js";
import { isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../../../../shared/runtime-type.js";
import { writePrivateAtomicJson } from "../../shared/atomic-json.ts";
import { type DurableClaim, tryAcquireDurableClaim } from "../../shared/durable-claim.ts";
import {
	assertPrivateDirectory,
	assertPrivateDirectoryWithin,
	type OwnedFileSnapshot,
	readBoundedOwnedFile,
	readBoundedOwnedFileSnapshot,
} from "../../shared/private-directory.ts";
import { tryAcquireStatusMutationClaim } from "../../shared/status-mutation.ts";
import {
	ASYNC_DIR,
	type AsyncJobState,
	type AsyncStatus,
	type NestedRunSummary,
	type NestedStepSummary,
	RESULTS_DIR,
	type SubagentRunMode,
	type SubagentState,
	TEMP_ROOT_DIR,
} from "../../shared/types.ts";
import { readStatus } from "../../shared/utils.ts";
import { readProcessTerminal, sanitizeProcessTerminal } from "../background/process-terminal.ts";
import * as nestedEventModel from "./nested-events-model.ts";
import type { NestedPathEntry } from "./nested-path.ts";
import * as nestedRoute from "./nested-route.ts";
import { MAX_CHILDREN, MAX_STEPS, sanitizeSummary } from "./nested-summary.ts";

const REGISTRY_FILE = "registry.json";
const ROOT_TERMINAL_FILE = "root-terminal.json";
const MAX_EVENT_FILES_PER_PROJECTION = 2_000;
const REGISTRY_LOCK = "registry-project.lock";
const AUTHORITATIVE_PROJECTION_TIMEOUT_MS = 3_000;
const AUTHORITATIVE_PROJECTION_RETRY_MS = 20;
const MAX_REGISTRY_CACHE_ENTRIES = 256;
const MAX_REGISTRY_CACHE_WEIGHT_BYTES = 64 * 1024 * 1024;
const REGISTRY_CACHE_OBJECT_WEIGHT_MULTIPLIER = 4;
const MIN_REGISTRY_CACHE_ENTRY_WEIGHT_BYTES = 4 * 1024;

export type { NestedEventRecord, NestedRegistry, NestedRoute } from "./nested-events-model.ts";
export { applyNestedEvent, findNestedRun, parseNestedEventRecords } from "./nested-events-model.ts";
export type { NestedRouteEnvironment } from "./nested-route.ts";
export {
	assertSafeNestedId,
	createNestedRoute,
	isSafeNestedId,
	NESTED_EVENTS_DIR,
	nestedRouteEnv,
	recoverRetiredNestedRouteStatus,
	resolveInheritedNestedRouteFromEnv,
	resolveNestedAsyncDir,
	resolveNestedParentAddressFromEnv,
	resolveNestedRouteFromEnv,
	resolvePersistedNestedRoute,
} from "./nested-route.ts";

type NestedEventRecord = nestedEventModel.NestedEventRecord;
type NestedRegistry = nestedEventModel.NestedRegistry;
type NestedRoute = nestedEventModel.NestedRoute;

type NestedRegistryFingerprint = Omit<OwnedFileSnapshot, "text">;

interface CachedNestedRegistry {
	readonly fingerprint: NestedRegistryFingerprint;
	readonly registry: NestedRegistry;
	readonly weightBytes: number;
}

interface RawNestedRegistry {
	rootRunId?: unknown;
	updatedAt?: unknown;
	children?: unknown;
	pendingChildren?: unknown;
	processedEvents?: unknown;
}

/**
 * CurrentAgents refreshes several times per second while work is live. Keep a
 * bounded, stat-keyed cache so an unchanged registry is not repeatedly read
 * and parsed (a full registry can be 8 MiB). Atomic registry replacement
 * changes its inode and invalidates the entry naturally.
 */
const nestedRegistryCache = new Map<string, CachedNestedRegistry>();
let nestedRegistryCacheWeightBytes = 0;

export interface AuthoritativeNestedProjectionOptions {
	readonly signal?: AbortSignal;
	readonly timeoutMs?: number;
}

function registryPath(route: NestedRoute): string {
	return path.join(nestedRoute.commonRouteRoot(route), REGISTRY_FILE);
}

function sameRegistryFingerprint(stat: fs.Stats, fingerprint: NestedRegistryFingerprint): boolean {
	return (
		stat.dev === fingerprint.dev &&
		stat.ino === fingerprint.ino &&
		stat.size === fingerprint.size &&
		stat.ctimeMs === fingerprint.ctimeMs &&
		stat.mtimeMs === fingerprint.mtimeMs
	);
}

function forgetNestedRegistry(filePath: string): void {
	const cached = nestedRegistryCache.get(filePath);
	if (!cached) return;
	nestedRegistryCache.delete(filePath);
	nestedRegistryCacheWeightBytes = Math.max(0, nestedRegistryCacheWeightBytes - cached.weightBytes);
}

function cachedNestedRegistry(filePath: string): NestedRegistry | undefined {
	let stat: fs.Stats;
	try {
		stat = fs.lstatSync(filePath);
	} catch (error) {
		if (isRuntimeObject(error) && error !== null && "code" in error && error.code === "ENOENT") {
			forgetNestedRegistry(filePath);
			return undefined;
		}
		throw error;
	}
	if (stat.isSymbolicLink() || !stat.isFile()) {
		throw new Error(`Agent runtime file '${filePath}' must be a regular file.`);
	}
	const currentUid = process.getuid?.();
	if (currentUid !== undefined && stat.uid !== currentUid) {
		throw new Error(`Agent runtime file '${filePath}' is owned by another user.`);
	}
	if (stat.size > nestedEventModel.MAX_REGISTRY_BYTES) {
		throw new Error(
			`Agent runtime file '${filePath}' exceeds the ${nestedEventModel.MAX_REGISTRY_BYTES}-byte limit.`,
		);
	}

	const cached = nestedRegistryCache.get(filePath);
	if (!cached) return undefined;
	if (!sameRegistryFingerprint(stat, cached.fingerprint)) {
		forgetNestedRegistry(filePath);
		return undefined;
	}

	// Refresh insertion order to make the fixed-size map a simple LRU.
	nestedRegistryCache.delete(filePath);
	nestedRegistryCache.set(filePath, cached);
	return cached.registry;
}

function rememberNestedRegistry(filePath: string, snapshot: NestedRegistryFingerprint, registry: NestedRegistry): void {
	forgetNestedRegistry(filePath);
	const weightBytes = Math.max(
		MIN_REGISTRY_CACHE_ENTRY_WEIGHT_BYTES,
		snapshot.size * REGISTRY_CACHE_OBJECT_WEIGHT_MULTIPLIER,
	);
	nestedRegistryCache.set(filePath, { fingerprint: snapshot, registry, weightBytes });
	nestedRegistryCacheWeightBytes += weightBytes;
	while (
		nestedRegistryCache.size > MAX_REGISTRY_CACHE_ENTRIES ||
		nestedRegistryCacheWeightBytes > MAX_REGISTRY_CACHE_WEIGHT_BYTES
	) {
		const oldest = nestedRegistryCache.keys().next().value;
		if (oldest === undefined) break;
		forgetNestedRegistry(oldest);
	}
}

function nestedRouteEntries(): string[] {
	try {
		assertPrivateDirectory(TEMP_ROOT_DIR);
		assertPrivateDirectory(nestedRoute.NESTED_EVENTS_DIR);
		return fs.readdirSync(nestedRoute.NESTED_EVENTS_DIR);
	} catch (error) {
		if (isRuntimeObject(error) && error !== null && "code" in error && error.code === "ENOENT") return [];
		throw error;
	}
}

function routeFromRoot(routeRoot: string): NestedRoute | undefined {
	try {
		assertPrivateDirectory(routeRoot);
		const metadata = parseJsonValue(
			readBoundedOwnedFile(path.join(routeRoot, nestedRoute.ROUTE_FILE), nestedRoute.MAX_ROUTE_METADATA_BYTES),
		);
		if (!isRuntimeObject(metadata) || metadata === null || Array.isArray(metadata)) return undefined;
		if (
			!nestedRoute.isSafeNestedId(metadata["rootRunId"]) ||
			!nestedRoute.isSafeNestedId(metadata["capabilityToken"])
		)
			return undefined;
		if (path.basename(routeRoot) !== `${metadata["rootRunId"]}-${metadata["capabilityToken"]}`) return undefined;
		const route: NestedRoute = {
			rootRunId: metadata["rootRunId"],
			eventSink: path.join(routeRoot, "events"),
			controlInbox: path.join(routeRoot, "controls"),
			capabilityToken: metadata["capabilityToken"],
		};
		nestedRoute.validateRouteStorage(route);
		return route;
	} catch {
		return undefined;
	}
}

export function findNestedRouteForRootId(rootRunId: string): NestedRoute | undefined {
	nestedRoute.assertSafeNestedId("rootRunId", rootRunId);
	for (const entry of nestedRouteEntries()) {
		if (!entry.startsWith(`${rootRunId}-`)) continue;
		const route = routeFromRoot(path.join(nestedRoute.NESTED_EVENTS_DIR, entry));
		if (route?.rootRunId === rootRunId) return route;
	}
	return undefined;
}

/**
 * Scan the nested-events directory once and index every route by its root run
 * id. Use this when resolving routes for many runs (e.g. listAsyncRuns) so the
 * cost is O(routes) total instead of O(runs * routes) from calling
 * findNestedRouteForRootId per run.
 */
export function buildNestedRouteIndex(): Map<string, NestedRoute> {
	const index = new Map<string, NestedRoute>();
	for (const entry of nestedRouteEntries()) {
		const route = routeFromRoot(path.join(nestedRoute.NESTED_EVENTS_DIR, entry));
		if (route && !index.has(route.rootRunId)) index.set(route.rootRunId, route);
	}
	return index;
}

export function projectNestedRegistryForRoot(rootRunId: string): NestedRegistry | undefined {
	const route = findNestedRouteForRootId(rootRunId);
	return route ? projectNestedEvents(route) : undefined;
}

export async function projectNestedRegistryForRootAuthoritatively(
	rootRunId: string,
	options: AuthoritativeNestedProjectionOptions = {},
): Promise<NestedRegistry | undefined> {
	const route = findNestedRouteForRootId(rootRunId);
	return route ? projectNestedEventsAuthoritatively(route, options) : undefined;
}

export interface NestedRunMatch {
	rootRunId: string;
	route: NestedRoute;
	run: NestedRunSummary;
}

export interface NestedRunResolutionScope {
	routes: NestedRoute[];
	descendantOf?: { parentRunId: string; parentStepIndex?: number };
}

function collectNestedRuns(
	children: NestedRunSummary[] | undefined,
	output: NestedRunSummary[] = [],
): NestedRunSummary[] {
	for (const child of children ?? []) {
		output.push(child);
		collectNestedRuns(child.children, output);
		collectNestedRuns(
			child.steps?.flatMap((step) => step.children ?? []),
			output,
		);
	}
	return output;
}

function collectScopedNestedRuns(
	children: NestedRunSummary[] | undefined,
	scope: NestedRunResolutionScope["descendantOf"],
	output: NestedRunSummary[] = [],
): NestedRunSummary[] {
	if (!scope) return collectNestedRuns(children, output);
	for (const child of children ?? []) {
		if (
			child.parentRunId === scope.parentRunId &&
			(scope.parentStepIndex === undefined || child.parentStepIndex === scope.parentStepIndex)
		) {
			collectNestedRuns([child], output);
			continue;
		}
		collectScopedNestedRuns(child.children, scope, output);
		collectScopedNestedRuns(
			child.steps?.flatMap((step) => step.children ?? []),
			scope,
			output,
		);
	}
	return output;
}

function listNestedRoutes(): NestedRoute[] {
	const routes: NestedRoute[] = [];
	for (const entry of nestedRouteEntries()) {
		const route = routeFromRoot(path.join(nestedRoute.NESTED_EVENTS_DIR, entry));
		if (route) routes.push(route);
	}
	return routes;
}

function collectMatchesFromRegistry(
	matches: NestedRunMatch[],
	route: NestedRoute,
	registry: NestedRegistry,
	id: string,
	options: { prefix?: boolean; scope?: NestedRunResolutionScope },
): void {
	for (const run of collectScopedNestedRuns(registry.children, options.scope?.descendantOf)) {
		if (options.prefix ? run.id.startsWith(id) : run.id === id) {
			matches.push({ rootRunId: route.rootRunId, route, run });
		}
	}
}

export function findNestedRunMatchesById(
	id: string,
	options: { prefix?: boolean; scope?: NestedRunResolutionScope } = {},
): NestedRunMatch[] {
	nestedRoute.assertSafeNestedId("id", id);
	const matches: NestedRunMatch[] = [];
	for (const route of options.scope?.routes ?? listNestedRoutes()) {
		try {
			const registry = projectNestedEvents(route);
			collectMatchesFromRegistry(matches, route, registry, id, options);
		} catch {}
	}
	return matches;
}

/** Resolve a control target without treating another projector's live claim as an empty registry. */
export async function findNestedRunMatchesByIdAuthoritatively(
	id: string,
	options: { prefix?: boolean; scope?: NestedRunResolutionScope; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<NestedRunMatch[]> {
	nestedRoute.assertSafeNestedId("id", id);
	const routes = options.scope?.routes ?? listNestedRoutes();
	const deadline = Date.now() + (options.timeoutMs ?? AUTHORITATIVE_PROJECTION_TIMEOUT_MS);
	const matches: NestedRunMatch[] = [];
	for (const route of routes) {
		const remaining = Math.max(0, deadline - Date.now());
		const projectionOptions: AuthoritativeNestedProjectionOptions =
			options.signal === undefined ? { timeoutMs: remaining } : { timeoutMs: remaining, signal: options.signal };
		const registry = await projectNestedEventsAuthoritatively(route, projectionOptions);
		collectMatchesFromRegistry(matches, route, registry, id, options);
	}
	return matches;
}

export function findNestedRunById(id: string): { rootRunId: string; run: NestedRunSummary } | undefined {
	const match = findNestedRunMatchesById(id)[0];
	return match ? { rootRunId: match.rootRunId, run: match.run } : undefined;
}

export function readNestedRegistry(route: NestedRoute): NestedRegistry {
	nestedRoute.validateRouteStorage(route);
	const filePath = registryPath(route);
	const cached = cachedNestedRegistry(filePath);
	if (cached) return cached;
	try {
		const snapshot = readBoundedOwnedFileSnapshot(filePath, nestedEventModel.MAX_REGISTRY_BYTES);
		const parsed = parseJsonValue(snapshot.text);
		if (!isRuntimeObject(parsed) || parsed === null || Array.isArray(parsed)) {
			throw new Error("Nested registry is not an object.");
		}
		// SAFETY: the parsed JSON object can be inspected through the registry schema's optional raw fields.
		const raw = parsed as RawNestedRegistry;
		if (raw.rootRunId !== route.rootRunId) {
			throw new Error("Nested registry root id does not match its route metadata.");
		}
		const registry = {
			rootRunId: route.rootRunId,
			updatedAt: isRuntimeNumber(raw.updatedAt) ? raw.updatedAt : 0,
			children: Array.isArray(raw.children)
				? raw.children
						.map((child) => sanitizeSummary(child))
						.filter((child): child is NestedRunSummary => Boolean(child))
				: [],
			pendingChildren: Array.isArray(raw.pendingChildren)
				? raw.pendingChildren
						.map((child) => sanitizeSummary(child))
						.filter((child): child is NestedRunSummary => Boolean(child))
				: [],
			processedEvents: Array.isArray(raw.processedEvents)
				? raw.processedEvents
						.filter(
							(item): item is string =>
								isRuntimeString(item) && path.basename(item) === item && item.length <= 256,
						)
						.slice(-nestedEventModel.MAX_PROCESSED_EVENTS)
				: [],
		};
		// Deliberately construct a text-free fingerprint. Passing the complete
		// snapshot would retain the raw JSON alongside the parsed registry.
		rememberNestedRegistry(
			filePath,
			{
				ctimeMs: snapshot.ctimeMs,
				dev: snapshot.dev,
				ino: snapshot.ino,
				mtimeMs: snapshot.mtimeMs,
				size: snapshot.size,
			},
			registry,
		);
		return registry;
	} catch (error) {
		if (!isRuntimeObject(error) || error === null || !("code" in error) || error.code !== "ENOENT") throw error;
		forgetNestedRegistry(filePath);
		return {
			rootRunId: route.rootRunId,
			updatedAt: 0,
			children: [],
			pendingChildren: [],
			processedEvents: [],
		};
	}
}

function discardInvalidImmutableEvent(eventPath: string, onlyStructurallyUnsafe = false): boolean {
	try {
		const stat = fs.lstatSync(eventPath);
		const currentUid = process.getuid?.();
		if (currentUid !== undefined && stat.uid !== currentUid) return false;
		if (!stat.isFile() && !stat.isSymbolicLink()) return false;
		if (onlyStructurallyUnsafe && !stat.isSymbolicLink() && stat.size <= nestedEventModel.MAX_EVENT_BYTES)
			return false;
		fs.unlinkSync(eventPath);
		return true;
	} catch (error) {
		return isRuntimeObject(error) && error !== null && "code" in error && error.code === "ENOENT";
	}
}

function projectNestedEventBatch(route: NestedRoute, registry: NestedRegistry) {
	const seen = new Set(registry.processedEvents);
	let changed = false;
	let entries: string[] = [];
	try {
		entries = fs
			.readdirSync(route.eventSink)
			.filter((entry) => entry.endsWith(".json") || entry.endsWith(".jsonl"))
			.sort()
			.filter((entry) => !seen.has(entry))
			.slice(0, MAX_EVENT_FILES_PER_PROJECTION);
	} catch (error) {
		if (!isRuntimeObject(error) || error === null || !("code" in error) || error.code !== "ENOENT") throw error;
	}
	for (const entry of entries) {
		const eventPath = path.join(route.eventSink, entry);
		if (!nestedRoute.containedPath(route.eventSink, eventPath)) continue;
		let content: string;
		try {
			content = readBoundedOwnedFile(eventPath, nestedEventModel.MAX_EVENT_BYTES);
		} catch {
			if (discardInvalidImmutableEvent(eventPath, true)) {
				seen.add(entry);
				changed = true;
			}
			continue;
		}
		const records = nestedEventModel.parseNestedEventRecords(content, route);
		if (records.length === 0) {
			if (discardInvalidImmutableEvent(eventPath)) {
				seen.add(entry);
				changed = true;
			}
			continue;
		}
		for (const event of records) {
			registry = nestedEventModel.applyNestedEvent(registry, event);
			changed = true;
		}
		seen.add(entry);
		changed = true;
	}
	if (changed) {
		const processedEvents = [...seen];
		const retainedEvents = processedEvents.slice(-nestedEventModel.MAX_PROCESSED_EVENTS);
		registry = nestedEventModel.boundedRegistry({ ...registry, processedEvents: retainedEvents });
		const retainedSet = new Set(registry.processedEvents);
		const evictedEvents = processedEvents.filter((entry) => !retainedSet.has(entry));
		// This route-level claim covers the complete read→project→write→cleanup
		// transaction across root, runner, and owner Pi processes.
		writePrivateAtomicJson(registryPath(route), registry);

		// Remove immutable records only after their projection is durable.
		for (const entry of evictedEvents) {
			const eventPath = path.join(route.eventSink, entry);
			if (!nestedRoute.containedPath(route.eventSink, eventPath)) continue;
			try {
				fs.unlinkSync(eventPath);
			} catch {
				// Cleanup is best-effort; the retained cursor remains authoritative.
			}
		}
	}
	return { registry, entriesRead: entries.length };
}

function projectNestedEventsUnderClaim(
	route: NestedRoute,
	options: { drain?: boolean; deadline?: number } = {},
): NestedRegistry {
	let registry = readNestedRegistry(route);
	for (;;) {
		const batch = projectNestedEventBatch(route, registry);
		registry = batch.registry;
		if (!options.drain || batch.entriesRead < MAX_EVENT_FILES_PER_PROJECTION) return registry;
		if (options.deadline !== undefined && Date.now() >= options.deadline) {
			throw new Error(
				`Nested registry for '${route.rootRunId}' could not drain all pending events before its authoritative deadline.`,
			);
		}
	}
}

function projectNestedEventsWithClaim(
	route: NestedRoute,
	claim: DurableClaim,
	options: { drain?: boolean; deadline?: number } = {},
): NestedRegistry {
	try {
		return projectNestedEventsUnderClaim(route, options);
	} finally {
		claim.release();
	}
}

/**
 * Best-effort projection for status and UI refreshes. If another process owns
 * the projector claim, return the last durable snapshot without blocking the
 * interactive host.
 */
export function projectNestedEvents(route: NestedRoute): NestedRegistry {
	nestedRoute.validateRouteStorage(route);
	const claim = tryAcquireDurableClaim(nestedRoute.commonRouteRoot(route), REGISTRY_LOCK);
	return claim ? projectNestedEventsWithClaim(route, claim) : readNestedRegistry(route);
}

function abortReason(signal: AbortSignal): Error {
	return signal.reason instanceof Error ? signal.reason : new Error("Nested registry projection was aborted.");
}

function waitForProjectionRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return Promise.reject(abortReason(signal));
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, delayMs);
		const onAbort = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			reject(signal ? abortReason(signal) : new Error("Nested registry projection was aborted."));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

function routeHasRetainedState(route: NestedRoute): boolean {
	if (fs.readdirSync(route.eventSink).length > 0 || fs.readdirSync(route.controlInbox).length > 0) return true;
	const routeRoot = nestedRoute.commonRouteRoot(route);
	const allowed = new Set([
		nestedRoute.ROUTE_FILE,
		REGISTRY_FILE,
		ROOT_TERMINAL_FILE,
		`${REGISTRY_LOCK}.lock`,
		"events",
		"controls",
	]);
	if (fs.readdirSync(routeRoot).some((entry) => !allowed.has(entry))) return true;
	try {
		const registry = readNestedRegistry(route);
		return registry.children.length > 0 || registry.pendingChildren.length > 0 || registry.processedEvents.length > 0;
	} catch (error) {
		if (isRuntimeObject(error) && error !== null && "code" in error && error.code === "ENOENT") return false;
		return true;
	}
}

/**
 * Retire the exact capability-owned route after its root run has durably
 * terminalized. Renaming while holding the projector claim makes stale route
 * users fail closed; the moved inode is removed only after the claim is closed.
 */
export async function retireUnusedNestedRoute(
	route: NestedRoute,
	options: AuthoritativeNestedProjectionOptions = {},
): Promise<boolean> {
	nestedRoute.validateRouteStorage(route);
	const timeoutMs = options.timeoutMs ?? AUTHORITATIVE_PROJECTION_TIMEOUT_MS;
	if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
		throw new Error("Nested route retirement timeout must be a finite non-negative number.");
	}
	const deadline = Date.now() + timeoutMs;
	const routeRoot = nestedRoute.commonRouteRoot(route);
	for (;;) {
		if (options.signal?.aborted) throw abortReason(options.signal);
		const claim = tryAcquireDurableClaim(routeRoot, REGISTRY_LOCK);
		if (claim) {
			let retiredRoot: string | undefined;
			try {
				nestedRoute.validateRouteStorage(route);
				if (routeHasRetainedState(route)) return false;
				const before = fs.lstatSync(routeRoot);
				retiredRoot = path.join(
					nestedRoute.NESTED_EVENTS_DIR,
					`.retired-${path.basename(routeRoot)}-${claim.token}`,
				);
				fs.renameSync(routeRoot, retiredRoot);
				forgetNestedRegistry(registryPath(route));
				const moved = fs.lstatSync(retiredRoot);
				if (!moved.isDirectory() || moved.dev !== before.dev || moved.ino !== before.ino) {
					throw new Error("Nested route inode changed during retirement.");
				}
			} finally {
				claim.release();
			}
			if (retiredRoot) fs.rmSync(retiredRoot, { recursive: true });
			return Boolean(retiredRoot);
		}
		const remaining = deadline - Date.now();
		if (remaining <= 0) return false;
		await waitForProjectionRetry(Math.min(AUTHORITATIVE_PROJECTION_RETRY_MS, remaining), options.signal);
	}
}

interface NestedRootTerminalMarker {
	readonly version: 1;
	readonly rootRunId: string;
	readonly capabilityToken: string;
	readonly rootAsyncDir: string;
	readonly committedAt: number;
}

function readRootTerminalMarker(route: NestedRoute): NestedRootTerminalMarker | undefined {
	try {
		const marker = parseJsonValue(
			readBoundedOwnedFile(
				path.join(nestedRoute.commonRouteRoot(route), ROOT_TERMINAL_FILE),
				nestedRoute.MAX_ROUTE_METADATA_BYTES,
			),
		);
		if (!isRuntimeObject(marker) || marker === null || Array.isArray(marker)) return undefined;
		if (
			marker["version"] === 1 &&
			marker["rootRunId"] === route.rootRunId &&
			marker["capabilityToken"] === route.capabilityToken &&
			isRuntimeString(marker["rootAsyncDir"]) &&
			isRuntimeNumber(marker["committedAt"]) &&
			Number.isFinite(marker["committedAt"])
		) {
			return {
				version: 1,
				rootRunId: marker["rootRunId"],
				capabilityToken: marker["capabilityToken"],
				rootAsyncDir: marker["rootAsyncDir"],
				committedAt: marker["committedAt"],
			};
		}
		return undefined;
	} catch {
		return undefined;
	}
}

function persistTerminalRootProjection(
	route: NestedRoute,
	marker: NestedRootTerminalMarker,
	registry: NestedRegistry,
	retiring: boolean,
): boolean {
	let statusClaim: ReturnType<typeof tryAcquireStatusMutationClaim>;
	try {
		if (path.basename(marker.rootAsyncDir) !== route.rootRunId) return false;
		assertPrivateDirectoryWithin(TEMP_ROOT_DIR, marker.rootAsyncDir);
		statusClaim = tryAcquireStatusMutationClaim(marker.rootAsyncDir);
		if (!statusClaim) return false;
		const status = readStatus(marker.rootAsyncDir);
		if (!status || status.runId !== route.rootRunId || !nestedEventModel.isTerminalNestedRunState(status.state))
			return false;
		const processTerminal = readProcessTerminal(marker.rootAsyncDir, {
			runId: status.runId,
			runnerProcessInstanceId: status.processTerminal?.runnerProcessInstanceId,
		});
		const steps = status.steps ?? [];
		attachRootChildrenToSteps(route.rootRunId, steps, registry.children);
		const parentRunOrigin =
			status.parentRunOrigin === "user" || nestedWorkIncludesUser(registry.children)
				? "user"
				: status.parentRunOrigin;
		const updated: AsyncStatus = {
			...status,
			steps,
			nestedRoute: retiring ? undefined : route,
			lastUpdate: Math.max(status.lastUpdate ?? 0, registry.updatedAt),
		};
		if (parentRunOrigin) updated.parentRunOrigin = parentRunOrigin;
		if (processTerminal) updated.processTerminal = processTerminal;
		writePrivateAtomicJson(path.join(marker.rootAsyncDir, "status.json"), updated);
		return true;
	} catch {
		return false;
	} finally {
		statusClaim?.release();
	}
}

function retireClaimedRoute(route: NestedRoute, claim: DurableClaim): string {
	const routeRoot = nestedRoute.commonRouteRoot(route);
	const before = fs.lstatSync(routeRoot);
	const retiredRoot = path.join(nestedRoute.NESTED_EVENTS_DIR, `.retired-${path.basename(routeRoot)}-${claim.token}`);
	fs.renameSync(routeRoot, retiredRoot);
	forgetNestedRegistry(registryPath(route));
	const moved = fs.lstatSync(retiredRoot);
	if (!moved.isDirectory() || moved.dev !== before.dev || moved.ino !== before.ino) {
		throw new Error("Nested route inode changed during retirement.");
	}
	return retiredRoot;
}

async function settleTerminalNestedRoute(
	route: NestedRoute,
	options: AuthoritativeNestedProjectionOptions,
	rootAsyncDir?: string,
): Promise<boolean> {
	nestedRoute.validateRouteStorage(route);
	const timeoutMs = options.timeoutMs ?? AUTHORITATIVE_PROJECTION_TIMEOUT_MS;
	if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
		throw new Error("Nested route settlement timeout must be a finite non-negative number.");
	}
	const deadline = Date.now() + timeoutMs;
	const routeRoot = nestedRoute.commonRouteRoot(route);
	for (;;) {
		if (options.signal?.aborted) throw abortReason(options.signal);
		const claim = tryAcquireDurableClaim(routeRoot, REGISTRY_LOCK);
		if (claim) {
			let retiredRoot: string | undefined;
			try {
				nestedRoute.validateRouteStorage(route);
				if (rootAsyncDir) {
					if (path.basename(rootAsyncDir) !== route.rootRunId) {
						throw new Error("Nested route root runtime does not match its root run id.");
					}
					assertPrivateDirectoryWithin(TEMP_ROOT_DIR, rootAsyncDir);
					// The projector claim serializes marker publication with route
					// retirement, so atomic writing cannot recreate a retired route root.
					writePrivateAtomicJson(path.join(routeRoot, ROOT_TERMINAL_FILE), {
						version: 1,
						rootRunId: route.rootRunId,
						capabilityToken: route.capabilityToken,
						rootAsyncDir,
						committedAt: Date.now(),
					} satisfies NestedRootTerminalMarker);
				}
				const registry = projectNestedEventsUnderClaim(route, { drain: true, deadline });
				const marker = readRootTerminalMarker(route);
				if (!marker) return false;
				const hasLiveDescendants = hasLiveNestedDescendants([...registry.children, ...registry.pendingChildren]);
				// Publish the latest authoritative descendants even when the root
				// cannot retire yet. The foreground result can then show live detached
				// children while status retains the route for subsequent projection.
				if (!persistTerminalRootProjection(route, marker, registry, !hasLiveDescendants)) return false;
				if (hasLiveDescendants) return false;
				retiredRoot = retireClaimedRoute(route, claim);
			} finally {
				claim.release();
			}
			if (retiredRoot) fs.rmSync(retiredRoot, { recursive: true });
			return Boolean(retiredRoot);
		}
		const remaining = deadline - Date.now();
		if (remaining <= 0) return false;
		await waitForProjectionRetry(Math.min(AUTHORITATIVE_PROJECTION_RETRY_MS, remaining), options.signal);
	}
}

/** Mark the root result durable and retire immediately only when no descendant remains live. */
export function finalizeNestedRouteRoot(
	route: NestedRoute,
	rootAsyncDir: string,
	options: AuthoritativeNestedProjectionOptions = {},
): Promise<boolean> {
	return settleTerminalNestedRoute(route, options, rootAsyncDir);
}

/** Let the final descendant retire a route whose root already committed terminal state. */
export function retireCompletedNestedRoute(
	route: NestedRoute,
	options: AuthoritativeNestedProjectionOptions = {},
): Promise<boolean> {
	return settleTerminalNestedRoute(route, options);
}

/**
 * Authoritative projection for control and terminal delivery paths. A busy
 * projector is not an empty registry: wait for its durable transaction to
 * finish, then project any newly-arrived immutable events ourselves.
 */
export async function projectNestedEventsAuthoritatively(
	route: NestedRoute,
	options: AuthoritativeNestedProjectionOptions = {},
): Promise<NestedRegistry> {
	nestedRoute.validateRouteStorage(route);
	const timeoutMs = options.timeoutMs ?? AUTHORITATIVE_PROJECTION_TIMEOUT_MS;
	if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
		throw new Error("Authoritative nested projection timeout must be a finite non-negative number.");
	}
	const deadline = Date.now() + timeoutMs;
	const routeRoot = nestedRoute.commonRouteRoot(route);
	for (;;) {
		if (options.signal?.aborted) throw abortReason(options.signal);
		const claim = tryAcquireDurableClaim(routeRoot, REGISTRY_LOCK);
		if (claim) return projectNestedEventsWithClaim(route, claim, { drain: true, deadline });
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			throw new Error(
				`Nested registry for '${route.rootRunId}' remained busy for ${timeoutMs}ms; authoritative projection was not completed.`,
			);
		}
		await waitForProjectionRetry(Math.min(AUTHORITATIVE_PROJECTION_RETRY_MS, remaining), options.signal);
	}
}

function writeRouteRecord(dir: string, ts: number, payload: NestedEventRecord): string {
	const content = `${JSON.stringify(payload)}\n`;
	if (Buffer.byteLength(content, "utf-8") > nestedEventModel.MAX_EVENT_BYTES)
		throw new Error("Nested route record exceeds the maximum size.");
	assertPrivateDirectory(dir);
	const name = `${String(ts).padStart(13, "0")}-${randomUUID()}.json`;
	const tmp = path.join(dir, `.${name}.tmp`);
	const finalPath = path.join(dir, name);
	fs.writeFileSync(tmp, content, { mode: 0o600, flag: "wx" });
	fs.renameSync(tmp, finalPath);
	return finalPath;
}

export function writeNestedEvent(
	route: NestedRoute,
	event: Omit<NestedEventRecord, "rootRunId" | "capabilityToken">,
): void {
	nestedRoute.validateRouteStorage(route);
	const child = sanitizeSummary(event.child);
	if (!child || child.id === route.rootRunId) throw new Error("Nested event child failed validation.");
	const record: NestedEventRecord = {
		...event,
		rootRunId: route.rootRunId,
		capabilityToken: route.capabilityToken,
		child: nestedEventModel.compactSummaryForTransport(child, false),
	};
	const sanitized = nestedEventModel.parseRecord(JSON.stringify(record), route);
	if (!sanitized) throw new Error("Nested event record failed validation.");
	writeRouteRecord(route.eventSink, sanitized.ts, sanitized);
}

export function attachRootChildrenToSteps<T extends { children?: NestedRunSummary[] | undefined; index?: number }>(
	rootRunId: string,
	steps: T[] | undefined,
	children: NestedRunSummary[] | undefined,
): void {
	if (!steps?.length) return;
	for (const step of steps) {
		delete step.children;
	}
	if (!children?.length) return;
	for (const child of children) {
		if (child.parentRunId !== rootRunId || child.parentStepIndex === undefined) continue;
		const step = steps.find((candidate, index) => (candidate.index ?? index) === child.parentStepIndex);
		if (!step) continue;
		step.children ??= [];
		step.children = [...step.children.filter((existing) => existing.id !== child.id), child].slice(-MAX_CHILDREN);
	}
}

export function updateAsyncJobNestedProjection(job: AsyncJobState): void {
	if (!job.nestedRoute) return;
	const registry = projectNestedEvents(job.nestedRoute);
	job.nestedChildren = registry.children;
	attachRootChildrenToSteps(job.asyncId, job.steps, registry.children);
}

export function updateForegroundNestedProjection(
	control: SubagentState["foregroundControls"] extends Map<string, infer T> ? T : never,
): void {
	if (!control.nestedRoute) return;
	const registry = projectNestedEvents(control.nestedRoute);
	control.nestedChildren = registry.children;
}

export function hasLiveNestedDescendants(children: NestedRunSummary[] | undefined): boolean {
	if (!children?.length) return false;
	for (const child of children) {
		if (!nestedEventModel.isTerminalNestedRunState(child.state)) return true;
		if (hasLiveNestedDescendants(child.children)) return true;
		if (hasLiveNestedDescendants(child.steps?.flatMap((step) => step.children ?? []))) return true;
	}
	return false;
}

interface NestedOriginProjection {
	readonly parentRunOrigin?: AgentWorkOrigin;
	readonly children?: readonly NestedOriginProjection[] | undefined;
	readonly steps?: readonly { readonly children?: readonly NestedOriginProjection[] | undefined }[] | undefined;
}

/** Whether any descendant was directly taken over by user-attributed work. */
export function nestedWorkIncludesUser(children: readonly NestedOriginProjection[] | undefined): boolean {
	for (const child of children ?? []) {
		if (child.parentRunOrigin === "user") return true;
		if (nestedWorkIncludesUser(child.children)) return true;
		if (nestedWorkIncludesUser(child.steps?.flatMap((step) => step.children ?? []))) return true;
	}
	return false;
}

export function nestedSummaryFromAsyncStatus(
	status: AsyncStatus,
	asyncDir: string,
	fallback: {
		id: string;
		parentRunId: string;
		parentStepIndex?: number;
		depth: number;
		path?: Array<{ runId: string; stepIndex?: number; agent?: string }>;
		mode?: SubagentRunMode;
		ts: number;
	},
): NestedRunSummary {
	const runId = status.runId || fallback.id;
	const fallbackPath: NestedPathEntry = { runId: fallback.parentRunId };
	if (fallback.parentStepIndex !== undefined) fallbackPath.stepIndex = fallback.parentStepIndex;
	const summary: Partial<NestedRunSummary> = { id: runId };
	if (status.parentRunOrigin) summary.parentRunOrigin = status.parentRunOrigin;
	summary.parentRunId = fallback.parentRunId;
	if (fallback.parentStepIndex !== undefined) summary.parentStepIndex = fallback.parentStepIndex;
	summary.depth = fallback.depth;
	summary.path = fallback.path ?? [fallbackPath];
	summary.asyncDir = asyncDir;
	if (status.pid) summary.pid = status.pid;
	if (status.sessionId) summary.sessionId = status.sessionId;
	summary.mode = status.mode ?? fallback.mode;
	summary.ownerState =
		status.state === "complete" ||
		status.state === "failed" ||
		status.state === "paused" ||
		status.state === "stopped"
			? "gone"
			: status.pid
				? "live"
				: "unknown";
	if (status.processTerminal) {
		const processTerminal = sanitizeProcessTerminal(
			status.processTerminal,
			{ runId, runnerProcessInstanceId: status.processTerminal.runnerProcessInstanceId },
			`${asyncDir}/status.json`,
		);
		if (processTerminal) summary.processTerminal = processTerminal;
	}
	if (status.capabilityCeiling) summary.capabilityCeiling = status.capabilityCeiling;
	if (status.capabilityAudit) summary.capabilityAudit = status.capabilityAudit;
	summary.state = status.state;
	if (status.currentStep !== undefined) summary.currentStep = status.currentStep;
	if (status.activityState) summary.activityState = status.activityState;
	if (status.lastActivityAt !== undefined) summary.lastActivityAt = status.lastActivityAt;
	if (status.currentTool) summary.currentTool = status.currentTool;
	if (status.currentToolStartedAt !== undefined) summary.currentToolStartedAt = status.currentToolStartedAt;
	if (status.currentPath) summary.currentPath = status.currentPath;
	if (status.turnCount !== undefined) summary.turnCount = status.turnCount;
	if (status.toolCount !== undefined) summary.toolCount = status.toolCount;
	if (status.totalTokens) summary.totalTokens = status.totalTokens;
	if (status.timeoutMs !== undefined) summary.timeoutMs = status.timeoutMs;
	if (status.deadlineAt !== undefined) summary.deadlineAt = status.deadlineAt;
	if (status.timedOut !== undefined) summary.timedOut = status.timedOut;
	if (status.stopped !== undefined) summary.stopped = status.stopped;
	if (status.turnBudget) summary.turnBudget = status.turnBudget;
	if (status.turnBudgetExceeded !== undefined) summary.turnBudgetExceeded = status.turnBudgetExceeded;
	if (status.wrapUpRequested !== undefined) summary.wrapUpRequested = status.wrapUpRequested;
	if (status.error) summary.error = status.error;
	summary.startedAt = status.startedAt ?? fallback.ts;
	if (status.endedAt !== undefined) summary.endedAt = status.endedAt;
	summary.lastUpdate = status.lastUpdate ?? fallback.ts;
	if (status.sessionFile) summary.sessionFile = status.sessionFile;
	if (status.steps?.length) {
		summary.steps = status.steps
			.map((step, index) => {
				const projected: Partial<NestedStepSummary> = { agent: step.agent };
				if (step.delegatedTask) projected.delegatedTask = step.delegatedTask;
				if (step.task) projected.task = step.task;
				if (step.label) projected.description = step.label;
				projected.status = step.status;
				if (step.sessionFile) projected.sessionFile = step.sessionFile;
				if (step.transcriptPath) projected.transcriptPath = step.transcriptPath;
				if (step.transcriptError) projected.transcriptError = step.transcriptError;
				if (step.activityState) projected.activityState = step.activityState;
				if (step.lastActivityAt !== undefined) projected.lastActivityAt = step.lastActivityAt;
				if (step.currentTool) projected.currentTool = step.currentTool;
				if (step.currentToolStartedAt !== undefined) projected.currentToolStartedAt = step.currentToolStartedAt;
				if (step.currentPath) projected.currentPath = step.currentPath;
				if (step.turnCount !== undefined) projected.turnCount = step.turnCount;
				if (step.toolCount !== undefined) projected.toolCount = step.toolCount;
				if (step.startedAt !== undefined) projected.startedAt = step.startedAt;
				if (step.endedAt !== undefined) projected.endedAt = step.endedAt;
				if (step.error) projected.error = step.error;
				if (step.timedOut !== undefined) projected.timedOut = step.timedOut;
				if (step.stopped !== undefined) projected.stopped = step.stopped;
				if (step.turnBudget) projected.turnBudget = step.turnBudget;
				if (step.turnBudgetExceeded !== undefined) projected.turnBudgetExceeded = step.turnBudgetExceeded;
				if (step.wrapUpRequested !== undefined) projected.wrapUpRequested = step.wrapUpRequested;
				if (step.processTerminal) {
					const processTerminal = sanitizeProcessTerminal(
						step.processTerminal,
						{ runId, runnerProcessInstanceId: step.processTerminal.runnerProcessInstanceId },
						`${asyncDir}/status.json step ${index}`,
					);
					if (processTerminal) projected.processTerminal = processTerminal;
				}
				if (step.capabilityCeiling) projected.capabilityCeiling = step.capabilityCeiling;
				if (step.capabilityAudit) projected.capabilityAudit = step.capabilityAudit;
				// SAFETY: agent and status are copied from the canonical AsyncStatus step before returning the projection.
				return projected as NestedStepSummary;
			})
			.slice(0, MAX_STEPS);
	}
	// SAFETY: the required nested address and state fields are assigned from canonical status and fallback inputs.
	return summary as NestedRunSummary;
}

export interface NestedArtifactEnvironment {
	readonly PI_SUBAGENT_NESTED_PARENT_RUN_ID: string;
	readonly PI_SUBAGENT_NESTED_ROOT_RUN_ID: string;
}

export function nestedArtifactEnv(rootRunId: string, parentRunId: string): NestedArtifactEnvironment {
	return {
		PI_SUBAGENT_NESTED_ROOT_RUN_ID: rootRunId,
		PI_SUBAGENT_NESTED_PARENT_RUN_ID: parentRunId,
	};
}

export function isTopLevelAsyncDir(asyncDir: string): boolean {
	const resolved = path.resolve(asyncDir);
	return (
		nestedRoute.containedPath(ASYNC_DIR, resolved) &&
		!nestedRoute.containedPath(path.join(TEMP_ROOT_DIR, "nested-subagent-runs"), resolved)
	);
}

export function nestedResultsPath(rootRunId: string, id: string): string {
	nestedRoute.assertSafeNestedId("rootRunId", rootRunId);
	nestedRoute.assertSafeNestedId("id", id);
	return path.join(RESULTS_DIR, "nested", rootRunId, `${id}.json`);
}
