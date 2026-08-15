import {
	type AsyncDurableClaim,
	type DurableClaim,
	tryAcquireDurableClaim,
	tryAcquireKernelClaimAsync,
} from "./durable-claim.ts";
import { assertPrivateDirectory } from "./private-directory.ts";

const STATUS_MUTATION_CLAIM = "status-mutation";

/**
 * Serialize terminal read/modify/write overlays for one exact private run.
 * Callers that cannot acquire immediately must retain their authoritative
 * sidecar/route and retry instead of writing from a stale status snapshot.
 */
export function tryAcquireStatusMutationClaim(asyncDir: string): DurableClaim | undefined {
	assertPrivateDirectory(asyncDir);
	return tryAcquireDurableClaim(asyncDir, STATUS_MUTATION_CLAIM);
}

export function tryAcquireStatusMutationClaimAsync(asyncDir: string): Promise<AsyncDurableClaim | undefined> {
	return tryAcquireKernelClaimAsync(asyncDir, STATUS_MUTATION_CLAIM);
}
