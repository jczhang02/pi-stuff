/** Command conditions are lifetime evidence, independent of the retained output tail. */
export class CommandMonitorEvidence {
	private readonly success: Buffer | undefined;
	private readonly failure: Buffer | undefined;
	private readonly overlap: number;
	private tail = Buffer.alloc(0);
	private successSeen = false;
	private failureSeen = false;

	constructor(successText?: string, failureText?: string) {
		this.success = successText ? Buffer.from(successText) : undefined;
		this.failure = failureText ? Buffer.from(failureText) : undefined;
		this.overlap = Math.max(0, this.success?.length ?? 0, this.failure?.length ?? 0) - 1;
	}

	append(chunk: Buffer): void {
		if ((!this.success && !this.failure) || this.failureSeen) return;
		const value = Buffer.concat([this.tail, chunk]);
		if (this.success && value.includes(this.success)) this.successSeen = true;
		if (this.failure && value.includes(this.failure)) this.failureSeen = true;
		this.tail = this.overlap > 0 ? Buffer.from(value.subarray(-this.overlap)) : Buffer.alloc(0);
	}

	get failed(): boolean {
		return this.failureSeen || (this.success !== undefined && !this.successSeen);
	}
}
