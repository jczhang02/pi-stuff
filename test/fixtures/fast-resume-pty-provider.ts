import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAssistantMessage, createTextStream, registerFixtureProvider } from "./faux-provider.js";

const PROVIDER = "pi-stuff-fast-resume-pty";
const MODEL = "fixture-model";

export default function fastResumePtyProvider(pi: ExtensionAPI): void {
	const stream = createTextStream(createAssistantMessage(PROVIDER, MODEL));
	registerFixtureProvider(pi, PROVIDER, MODEL, "Pi Stuff Fast Resume PTY fixture", () =>
		stream("FAST_RESUME_PROVIDER_UNUSED"),
	);
	pi.on("session_start", (_event, context) => {
		context.ui.notify("FAST_RESUME_HOST_READY", "info");
	});
}
