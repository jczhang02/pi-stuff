# Session Naming Capability

Session Naming gives a settled direct-user Session a concise semantic name and refreshes that name after the configured
cooldown. `/autoname` forces regeneration, while `/autoname settings` opens the routine controls. Pi remains the owner
of Session metadata and its native presentation; this Capability only chooses a label and calls Pi's public
`setSessionName()` API. Periodic requests include the current authoritative name and retain it exactly when it still
fits both the work and the generated-English policy, avoiding needless Session metadata writes.

Automatic naming listens to the Conversation UI's shared direct-user settled boundary. Goal continuation, background
results, and other Extension-authored work do not trigger it. Child Agent Sessions retain the names assigned by Agents,
although an explicit `/autoname` remains available inside a child. Generated and observed manual names are recorded as
branch-local custom entries so cooldown and `respectManualName` behavior survive resume and branching. An existing
authoritative name without a matching marker is treated as manual; its native `session_info` timestamp anchors the
cooldown without a startup write. Existing upstream `pi-autoname-state` entries are read for resume compatibility.
The English policy applies only to newly generated names: manually assigned non-English names remain valid, and
existing names are not scanned or migrated before an otherwise eligible rename.

The naming request includes only bounded user and Assistant text, removes leading Magic Context control blocks, redacts
common credential forms, and frames all conversation text as untrusted data. Thinking, Tool records, images, and full
Session files are not sent. The model is asked for a natural two-to-four-word English label regardless of conversation
language, preserving technical identifiers without transliterating non-English prose. Every AI or local-fallback
candidate must contain an ASCII English letter, use only printable ASCII, and pass the existing safety and quality
checks. A non-compliant model result advances through the existing model chain; the unchanged local fallback is used
only when its complete candidate complies. If none does, the authoritative Session name remains unchanged and the next
settled direct-user run retries. Requests use Pi's public model registry with a 64-token output cap, 12-second per-model
timeout, and 30-second total budget, and naming failure never blocks Agent settlement.

Settings live under `sessionNaming` in `<agentDir>/pi-stuff.json`. Startup reads this namespace without writing; only a
direct change in `/autoname settings` persists it:

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

The native Settings List exposes **Automatic naming**, **Rename cooldown** (`10 min`, `30 min`, `1 hour`, `6 hours`, or
`24 hours`), **Keep manually assigned names**, and **Naming model**. The model row opens a searchable submenu built
from Pi's scoped model set, or all available authenticated models when no scope is active. **Session model** clears the
fixed `model` setting and follows the active Session model; choosing a fixed model does not change the active Session
model. Changes apply to the active Session after persistence. Turning off automatic naming does not disable an explicit
`/autoname`.

`fallbackModels` remains an advanced JSON-only setting. Selecting a fixed model or cross-provider fallback explicitly
allows sanitized naming context to be sent to that model's Provider. With neither configured, Session Naming uses the
active Session model and then the local fallback. Cross-provider routing is opt-in so conversation text is not sent to
another Provider by default. An invalid namespace fails closed to the complete built-in defaults and raises one bounded
Diagnostic Record; startup does not create the merged file or migrate the upstream `pi-autoname.json`, and the Dialog
will not overwrite invalid existing settings. The standalone `pi-autoname` Extension must not be loaded at the same
time because both would own `/autoname` and the same Host Session name.

See [`UPSTREAM.md`](UPSTREAM.md) and [`LICENSE`](LICENSE) for the absorbed fork's provenance and license.
