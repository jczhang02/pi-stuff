# Session Naming Capability

Session Naming gives a settled direct-user Session a concise semantic name and refreshes that name after the configured
cooldown. `/autoname` forces regeneration. Pi remains the owner of Session metadata and its native presentation; this
Capability only chooses a label and calls Pi's public `setSessionName()` API.

Automatic naming listens to the Conversation UI's shared direct-user settled boundary. Goal continuation, background
results, and other Extension-authored work do not trigger it. Child Agent Sessions retain the names assigned by Agents,
although an explicit `/autoname` remains available inside a child. Generated and observed manual names are recorded as
branch-local custom entries so cooldown and `respectManualName` behavior survive resume and branching.
Existing upstream `pi-autoname-state` entries are read for resume compatibility; Pi's `session_info` entry remains the
authority for the actual name.

The naming request includes only bounded user and Assistant text, removes leading Magic Context control blocks, redacts
common credential forms, and frames all conversation text as untrusted data. Thinking, Tool records, images, and full
Session files are not sent. Requests use Pi's public model registry with a 64-token output cap, 12-second per-model
timeout, and 30-second total budget. Failure falls back to a bounded local label and never blocks Agent settlement.
The local fallback is retried on the next settled direct-user run so an authenticated model can replace it later.

Settings live under `sessionNaming` in `<agentDir>/pi-stuff.json` and are read only during Capability initialization:

```json
{
	"sessionNaming": {
		"schemaVersion": 1,
		"enabled": true,
		"cooldownMinutes": 10,
		"respectManualName": false,
		"model": "provider/model-id",
		"fallbackModels": ["provider/backup-model-id"]
	}
}
```

`model` is optional. With no configured model or fallbacks, Session Naming uses the active Session model and then the
local fallback. Cross-provider fallbacks are opt-in so conversation text is not sent to another provider by default.
An invalid namespace fails closed to the complete built-in defaults and raises one bounded Diagnostic Record; startup
does not create the merged file or migrate the upstream `pi-autoname.json`.
The standalone `pi-autoname` Extension must not be loaded at the same time because both would own `/autoname` and the
same Host Session name.

See [`UPSTREAM.md`](UPSTREAM.md) and [`LICENSE`](LICENSE) for the absorbed fork's provenance and license.
