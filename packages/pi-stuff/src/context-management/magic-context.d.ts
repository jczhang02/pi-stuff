declare module "@cortexkit/pi-magic-context" {
	import type { MagicContextExtensionAPI } from "./magic-context-types.js";

	const magicContextFactory: (pi: MagicContextExtensionAPI) => Promise<void> | void;
	export default magicContextFactory;
}
