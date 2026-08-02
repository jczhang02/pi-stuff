# `@jczhang02/pi-stuff-ui`

The shared Command Dialog coordinator for the Pi Stuff Suite.

The Package gives independently owned Capabilities one full-width, non-floating focus surface without coupling them to
each other. A `blocking` view preempts the active `normal` view inside the same Pi component; blocking requests run FIFO,
then the exact normal component resumes.

## Usage

```ts
import { getCommandDialogCoordinator } from "@jczhang02/pi-stuff-ui";

const dialogs = getCommandDialogCoordinator(pi);
const unregister = dialogs.registerChrome("todo", {
	setSuppressed: (suppressed) => todoOverlay.setSuppressed(suppressed),
});

await dialogs.show(ctx, {
	priority: "normal",
	create: ({ signal, tui, theme, keybindings, requestRender, close }) =>
		new CapabilityDialog({ signal, tui, theme, keybindings, requestRender, close }),
});

unregister();
```

While a host is open, the coordinator saves and clears the editor draft, installs an empty footer, hides the working row,
and suppresses registered Suite chrome. It restores each of them after the last view closes or `session_shutdown`
dismisses the host. Non-TUI contexts resolve `show()` without mounting a view.

The Package does not create overlays, widgets, statuses, or transcript entries.
