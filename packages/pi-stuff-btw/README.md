# @jczhang02/pi-stuff-btw

Pi Stuff's one-shot `/btw` capability.

`/btw <question>` opens a full-width, non-floating Command Dialog and streams
one no-tool answer from the active model while the main Agent keeps running.
The side exchange never enters the main transcript or model context. Closing
the dialog restores the editor draft and normal Suite chrome.

Run bare `/btw` to reopen process-local history for the current session. That
history is display-only, holds at most twenty successful exchanges, and is
cleared when the Pi process exits.

This is an owned fork of `@juicesharp/rpiv-btw`; see [UPSTREAM.md](./UPSTREAM.md).

Pi 0.83 does not expose a public transcript-free Host model-call seam. `/btw`
therefore uses the active model's registered provider and Model Registry auth,
but it does not run provider lifecycle/context hooks or inherit Host retry and
transport settings. Historical images are omitted from side-call context rather
than forwarded outside that Host path.
