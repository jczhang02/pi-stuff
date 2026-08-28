import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CommandDialogCoordinatorImplementation } from "./command-dialog.js";
import type { CommandDialogCoordinator, CommandDialogCoordinatorHost } from "./command-dialog-types.js";
import { getHostSharedResource } from "./host-resource.js";

const COORDINATOR_REGISTRY = Symbol.for("@jczhang02/pi-stuff-ui/coordinators/v1");
const COORDINATOR_DISCOVERY_EVENT = "@jczhang02/pi-stuff-ui/coordinator-discovery/v1";

function coordinatorRegistry(): WeakMap<ExtensionAPI["events"], CommandDialogCoordinatorImplementation> {
	// SAFETY: this package-owned symbol slot is initialized only with the coordinator WeakMap.
	const root = globalThis as {
		[key: symbol]: WeakMap<ExtensionAPI["events"], CommandDialogCoordinatorImplementation> | undefined;
	};
	root[COORDINATOR_REGISTRY] ??= new WeakMap();
	return root[COORDINATOR_REGISTRY];
}

export function getCommandDialogCoordinator(pi: CommandDialogCoordinatorHost): CommandDialogCoordinator {
	const registry = coordinatorRegistry();
	const existing = registry.get(pi.events);
	if (existing) {
		existing.ensureGeneration(pi);
		return existing;
	}

	const coordinator = getHostSharedResource(
		pi.events,
		// SAFETY: ExtensionAPI event buses are objects, so this narrower WeakMap satisfies the shared Host registry seam.
		registry as WeakMap<object, CommandDialogCoordinatorImplementation>,
		COORDINATOR_DISCOVERY_EVENT,
		() => new CommandDialogCoordinatorImplementation(),
		{ registerOwnerCleanup: (cleanup) => pi.on("session_shutdown", cleanup) },
	);
	coordinator.ensureGeneration(pi);
	return coordinator;
}
