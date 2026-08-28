/** Provider-search domain normalization; intentionally distinct from SSRF host validation. */

export interface ProviderDomainFilters {
	exclude: string[];
	include: string[];
}

export function normalizeProviderDomain(value: string): string | null {
	let input = value.trim().toLowerCase();
	if (!input) return null;
	if (input.startsWith("-")) input = input.slice(1).trim();
	if (!input) return null;
	try {
		const parsed = input.includes("://") ? new URL(input) : new URL(`https://${input}`);
		input = parsed.hostname;
	} catch {
		input = input.split("/")[0]?.split(":")[0] ?? "";
	}
	input = input.replace(/^\.+|\.+$/g, "");
	return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(input) ? input : null;
}

export function hostMatchesProviderDomain(hostname: string, domain: string): boolean {
	return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function partitionProviderDomains(values: readonly string[] | undefined): ProviderDomainFilters {
	const filters: ProviderDomainFilters = { exclude: [], include: [] };
	for (const raw of values ?? []) {
		const domain = normalizeProviderDomain(raw);
		if (!domain) continue;
		const target = raw.trim().startsWith("-") ? filters.exclude : filters.include;
		if (!target.includes(domain)) target.push(domain);
	}
	return filters;
}
