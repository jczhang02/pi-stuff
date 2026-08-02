declare module "@jczhang02/pi-stuff-permissions" {
	import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

	const piStuffPermissions: (pi: ExtensionAPI) => void | Promise<void>;
	export default piStuffPermissions;
}
