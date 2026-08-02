declare module "@jczhang02/pi-stuff-agents" {
	import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

	const piStuffAgents: (pi: ExtensionAPI) => void | Promise<void>;
	export default piStuffAgents;
}
