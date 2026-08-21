interface TimerApi {
	setTimeout(handler: () => void, delayMs: number): ReturnType<typeof setTimeout>;
	clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

interface FileCoalescer {
	schedule(file: string, delayMs?: number): boolean;
	clear(): void;
}

const defaultTimerApi: TimerApi = {
	setTimeout: (handler, delayMs) => setTimeout(handler, delayMs),
	clearTimeout: (handle) => clearTimeout(handle),
};

export function createFileCoalescer(
	handler: (file: string) => void,
	defaultDelayMs: number,
	timerApi: TimerApi = defaultTimerApi,
): FileCoalescer {
	const pending = new Map<string, ReturnType<typeof setTimeout>>();

	return {
		schedule(file: string, delayMs = defaultDelayMs): boolean {
			if (pending.has(file)) return false;
			const timer = timerApi.setTimeout(() => {
				pending.delete(file);
				handler(file);
			}, delayMs);
			pending.set(file, timer);
			return true;
		},
		clear(): void {
			for (const timer of pending.values()) {
				timerApi.clearTimeout(timer);
			}
			pending.clear();
		},
	};
}
