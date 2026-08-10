import { ensureCodeModeHostBinary } from "./host/binary.js";
import { CodeModeHostClient } from "./host/host-client.js";
import type { CodeModeExecuteOptions, CodeModeWaitOptions, RuntimeResponse } from "./protocol.js";
import type { CodeModeExecutor } from "./runtime.js";

export class V8CodeModeExecutor implements CodeModeExecutor {
	private clientPromise: Promise<CodeModeHostClient> | undefined;
	private startupAbort: AbortController | undefined;

	async execute(options: CodeModeExecuteOptions): Promise<RuntimeResponse> {
		return (await this.client(options.signal)).execute(options);
	}

	async wait(
		cellId: string,
		options: CodeModeWaitOptions & { readonly yieldTimeMs: number },
	): Promise<RuntimeResponse> {
		return (await this.client(options.signal)).wait(cellId, options.yieldTimeMs, options);
	}

	async shutdown(): Promise<void> {
		const pending = this.clientPromise;
		this.clientPromise = undefined;
		this.startupAbort?.abort();
		this.startupAbort = undefined;
		if (!pending) return;
		try {
			await (await pending).shutdown();
		} catch {
			// Startup failure already reached the caller.
		}
	}

	private client(signal?: AbortSignal): Promise<CodeModeHostClient> {
		if (this.clientPromise) return this.clientPromise;
		const controller = new AbortController();
		const abort = (): void => controller.abort();
		signal?.addEventListener("abort", abort, { once: true });
		const pending = ensureCodeModeHostBinary(controller.signal).then((binary) => new CodeModeHostClient(binary));
		this.clientPromise = pending;
		this.startupAbort = controller;
		void pending.then(
			() => {
				signal?.removeEventListener("abort", abort);
				if (this.clientPromise === pending) this.startupAbort = undefined;
			},
			() => {
				signal?.removeEventListener("abort", abort);
				if (this.clientPromise !== pending) return;
				this.clientPromise = undefined;
				this.startupAbort = undefined;
			},
		);
		return pending;
	}
}
