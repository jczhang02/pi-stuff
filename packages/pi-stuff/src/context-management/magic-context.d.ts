declare module "@cortexkit/pi-magic-context" {
	import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

	const magicContextFactory: (pi: ExtensionAPI) => Promise<void> | void;
	export default magicContextFactory;
}
