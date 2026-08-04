declare module "@jczhang02/pi-stuff-rtk" {
	import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

	const piStuffRtk: (pi: ExtensionAPI) => void | Promise<void>;
	export default piStuffRtk;
}
