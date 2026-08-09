import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getHostSharedResource } from "@jczhang02/pi-stuff-ui";

export type CurrentWorkProjectionStatus = "queued" | "running" | "stopping" | "waiting";

export interface CurrentWorkProjectionItem {
	readonly description?: string;
	readonly id: string;
	readonly kind: "agent";
	readonly startedAt?: number;
	readonly status: CurrentWorkProjectionStatus;
	readonly title: string;
}

export interface CurrentWorkSource {
	readonly id: string;
	snapshot(): readonly CurrentWorkProjectionItem[];
	subscribe(listener: () => void): () => void;
}

type Listener = () => void;

/**
 * A current-session read model for work owned by another Capability.
 *
 * Work sources keep their own authority. `/tasks` may present these rows but
 * cannot steer or stop them; the owning Command Dialog remains the control
 * surface. This inversion keeps Background Work independent from Agents.
 */
export class CurrentWorkSources {
	private readonly listeners = new Set<Listener>();
	private readonly sources = new Map<
		string,
		{ readonly source: CurrentWorkSource; readonly unsubscribe: () => void }
	>();

	register(source: CurrentWorkSource): () => void {
		const id = source.id.trim();
		if (!id) throw new Error("Current Work source id must not be empty");
		if (this.sources.has(id)) throw new Error(`Current Work source '${id}' is already registered`);
		const unsubscribe = source.subscribe(() => this.emit());
		this.sources.set(id, { source, unsubscribe });
		this.emit();
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			const record = this.sources.get(id);
			if (record?.source !== source) return;
			this.sources.delete(id);
			record.unsubscribe();
			this.emit();
		};
	}

	snapshot(): readonly CurrentWorkProjectionItem[] {
		const items: CurrentWorkProjectionItem[] = [];
		for (const { source } of this.sources.values()) {
			for (const item of source.snapshot()) {
				items.push({
					...item,
					id: `${source.id}:${item.id}`,
				});
			}
		}
		return items.sort((left, right) => {
			const leftStarted = left.startedAt ?? Number.POSITIVE_INFINITY;
			const rightStarted = right.startedAt ?? Number.POSITIVE_INFINITY;
			return leftStarted - rightStarted || left.id.localeCompare(right.id);
		});
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}
}

const SOURCE_REGISTRY = Symbol.for("@jczhang02/pi-stuff-work/current-work-sources/v1");
const SOURCE_DISCOVERY_EVENT = "@jczhang02/pi-stuff-work/current-work-sources-discovery/v1";

function sourceRegistry(): WeakMap<ExtensionAPI["events"], CurrentWorkSources> {
	const root = globalThis as unknown as {
		[key: symbol]: WeakMap<ExtensionAPI["events"], CurrentWorkSources> | undefined;
	};
	root[SOURCE_REGISTRY] ??= new WeakMap();
	return root[SOURCE_REGISTRY];
}

export function getCurrentWorkSources(pi: ExtensionAPI): CurrentWorkSources {
	const registry = sourceRegistry();
	return getHostSharedResource(
		pi.events,
		registry as WeakMap<object, CurrentWorkSources>,
		SOURCE_DISCOVERY_EVENT,
		() => new CurrentWorkSources(),
		{ registerOwnerCleanup: (cleanup) => pi.on("session_shutdown", cleanup) },
	);
}

export function registerCurrentWorkSource(pi: ExtensionAPI, source: CurrentWorkSource): () => void {
	return getCurrentWorkSources(pi).register(source);
}
