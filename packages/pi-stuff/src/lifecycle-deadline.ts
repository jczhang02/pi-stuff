export const HOST_SHUTDOWN_GRACE_MS = 250;

/** Wait for best-effort cleanup without letting a non-cooperative dependency own Host shutdown. */
export async function settleWithin(operation: PromiseLike<unknown> | undefined, timeoutMs: number): Promise<boolean> {
	if (!operation) return true;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			Promise.resolve(operation).then(
				() => true,
				() => true,
			),
			new Promise<false>((resolve) => {
				timer = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
				timer.unref?.();
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
