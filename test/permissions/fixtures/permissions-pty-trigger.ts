import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { requestPermissionDecision } from "../../../packages/pi-stuff-permissions/src/authority/permission-prompt-component.js";
import { getCommandDialogCoordinator } from "../../../packages/pi-stuff-ui/index.js";

export default function permissionsPtyTrigger(pi: ExtensionAPI): void {
	pi.registerShortcut(Key.f11, {
		description: "Open the permission PTY fixture",
		handler: async (ctx) => {
			const decision = await requestPermissionDecision(
				{
					ctx,
					coordinator: getCommandDialogCoordinator(pi),
					doublePressToConfirm: false,
				},
				"Bash command · from worker",
				"",
				{
					exactCallOnly: true,
					exactCallEvidence: {
						requester: "Agent 'worker'",
						command: "rm -rf ../outside/generated-output-with-a-long-name",
						reason:
							"This exact command deletes statically resolved targets outside the current working directory.",
						operation: "rm",
						cwd: "/workspace/project",
						targets: Array.from({ length: 10 }, (_, index) => `/workspace/outside/target-${index + 1}`),
					},
				},
			);
			ctx.ui.notify(`PERMISSION_PTY:${decision.state}:${ctx.ui.getEditorText()}`, "info");
		},
	});
}
