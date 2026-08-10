import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { configureRuntimeSsrfDefaults } from "./runtime/index.js";
import type { WebFetchInput } from "./url-policy.js";

const FAKE_IP_CANARY = "example.com";
const FAKE_IP_RANGE = "198.18.0.0/15";

export interface DnsAddress {
	readonly address: string;
	readonly family?: number;
}

export type DnsLookup = (hostname: string) => Promise<readonly DnsAddress[]>;
export type ConfigureRuntimeSsrf = (defaults: { readonly allowRanges: readonly string[] }) => void;

function isFakeIpAddress(address: string): boolean {
	if (isIP(address) !== 4) return false;
	const [first, second] = address.split(".").map(Number);
	return first === 198 && (second === 18 || second === 19);
}

function onlyFakeIpAddresses(addresses: readonly DnsAddress[]): boolean {
	return addresses.length > 0 && addresses.every(({ address }) => isFakeIpAddress(address));
}

function urls(input: WebFetchInput): readonly string[] {
	return input.url === undefined ? (input.urls ?? []) : [input.url];
}

async function systemLookup(hostname: string): Promise<readonly DnsAddress[]> {
	return dnsLookup(hostname, { all: true, verbatim: true });
}

/** Detect a system TUN resolver lazily, then enable the fork's in-memory default. */
export class FakeIpCompatibility {
	private readonly configure: ConfigureRuntimeSsrf;
	private detection: Promise<boolean | undefined> | undefined;
	private readonly lookup: DnsLookup;
	private state: "active" | "inactive" | "unknown" = "unknown";

	constructor(lookup: DnsLookup = systemLookup, configure: ConfigureRuntimeSsrf = configureRuntimeSsrfDefaults) {
		this.lookup = lookup;
		this.configure = configure;
	}

	async prepare(input: WebFetchInput): Promise<void> {
		if (this.state !== "unknown") return;
		let detection = this.detection;
		if (!detection) {
			detection = this.detect(input);
			this.detection = detection;
		}
		const result = await detection;
		if (this.state !== "unknown") return;
		if (this.detection === detection) this.detection = undefined;
		if (result === undefined) return;
		this.state = result ? "active" : "inactive";
		if (result) this.configure({ allowRanges: [FAKE_IP_RANGE] });
	}

	private async detect(input: WebFetchInput): Promise<boolean | undefined> {
		const hostnames = [
			...new Set(
				urls(input)
					.map((raw) => new URL(raw).hostname.replace(/^\[|\]$/gu, "").toLowerCase())
					.filter((hostname) => hostname.length > 0 && isIP(hostname) === 0),
			),
		];
		let uncertain = false;
		for (const hostname of hostnames) {
			const targetUsesFakeIp = await this.hostnameUsesFakeIp(hostname);
			if (targetUsesFakeIp === undefined) {
				uncertain = true;
				continue;
			}
			if (!targetUsesFakeIp) continue;
			return this.hostnameUsesFakeIp(FAKE_IP_CANARY);
		}
		return uncertain ? undefined : false;
	}

	private async hostnameUsesFakeIp(hostname: string): Promise<boolean | undefined> {
		try {
			return onlyFakeIpAddresses(await this.lookup(hostname));
		} catch {
			return undefined;
		}
	}
}
