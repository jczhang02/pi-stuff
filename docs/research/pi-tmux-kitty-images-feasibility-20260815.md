# Pi images inside tmux

Date: 2026-08-15

## Question

Can Pi Stuff adapt
[`pi-warp-kitty-images`](https://github.com/monotykamary/pi-warp-kitty-images) so Pi renders inline images while
running inside tmux?

## Verdict

**Yes, but not by copying the referenced Extension.** It is a capability override, not an image transport. Pi's
certified Host already owns image normalization, layout, caching, redraw, fallback, and cleanup. Under tmux it
deliberately reports `images: null`, and its Kitty encoder emits bare APC graphics sequences. tmux forwards an
application-defined sequence only when the application wraps it in tmux's DCS passthrough envelope and the user has
enabled `allow-passthrough`.

The smallest reliable design belongs in Pi TUI, not a new Pi Stuff Capability Module:

1. Detect a Kitty-graphics-capable outer terminal while inside tmux.
2. Require tmux passthrough and wrap graphics upload, query, and deletion sequences.
3. For terminals that implement Kitty Unicode placeholders, create a virtual placement and render `U+10EEEE`
   placeholders as ordinary TUI cells. tmux can then move and redraw those cells without understanding images.
4. Preserve Pi's existing text fallback whenever any capability check fails.

Pi Stuff's `view_image` and `imagegen` Tools need no transport change: they already return native Pi `image` content.

There is one important terminal-specific split:

- Kitty documents Unicode placeholders expressly for host applications such as tmux. This is the preferred path for
  Kitty and compatible implementations that support the feature.
- Warp's current source parses `U=1` but rejects it as unsupported. A direct DCS-passthrough placement may display
  initially in Warp, but tmux does not own that image state and may overwrite or strand it during redraw, pane changes,
  scrolling, or resize. That is suitable for a proof of concept, not a certified Pi Stuff path.

## What the referenced repository actually does

At pinned HEAD `ff25e514e1f89950b79b944c3cb74c4580fff94d`, the entire implementation is one `session_start`
handler. When `TERM_PROGRAM=warpterminal` and Pi currently reports no image protocol, it calls `setCapabilities()` with
`images: "kitty"`, true color, and hyperlinks:

- [`extensions/index.ts` lines 1-21](https://github.com/monotykamary/pi-warp-kitty-images/blob/ff25e514e1f89950b79b944c3cb74c4580fff94d/extensions/index.ts#L1-L21)
- [`README.md` lines 18-63](https://github.com/monotykamary/pi-warp-kitty-images/blob/ff25e514e1f89950b79b944c3cb74c4580fff94d/README.md#L18-L63)
- [`package.json` lines 1-9](https://github.com/monotykamary/pi-warp-kitty-images/blob/ff25e514e1f89950b79b944c3cb74c4580fff94d/package.json#L1-L9)

It has no renderer, tmux detection, DCS wrapper, protocol query, image IDs, redraw logic, cleanup logic, tests, or runtime
dependencies. Outside tmux, the certified Pi version already detects Warp itself, so this override is redundant there.

## Certified Pi behavior

Pi Stuff certifies Pi `0.84.2` at upstream commit `914cf1472e715297caa30db4b9535d534a9eb718`; see
[`docs/compatibility.md`](../compatibility.md#certified-host).

The certified TUI checks tmux before checking Kitty, Ghostty, WezTerm, or Warp and returns `images: null` because image
protocols are considered unreliable through tmux:

- [`terminal-image.ts` lines 47-102](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/tui/src/terminal-image.ts#L47-L102)

When Kitty is enabled, `encodeKitty()` emits raw `ESC _G ... ESC \\` chunks. It has no tmux envelope or placeholder
mode:

- [`terminal-image.ts` lines 154-240](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/tui/src/terminal-image.ts#L154-L240)
- [`terminal-image.ts` lines 571-614](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/tui/src/terminal-image.ts#L571-L614)

The Image component allocates an ID, emits the Kitty transmission on the first rendered row, and adds blank rows so the
TUI accounts for the image's height. The alternate-screen renderer owns retransmission, placement reuse, eviction, and
cleanup:

- [`components/image.ts` lines 61-126](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/tui/src/components/image.ts#L61-L126)
- [`tui-alt-screen.ts` lines 300-384](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/tui/src/tui-alt-screen.ts#L300-L384)

Forcing only `images: "kitty"` therefore bypasses the tmux guard without adding the transport that made the guard
necessary.

## tmux and Kitty protocol requirements

Kitty graphics commands are APC sequences of the form `ESC _G ... ESC \\`, with directly transmitted data split into
chunks no larger than 4096 bytes. The protocol defines a query action so a client can distinguish supported from
unsupported terminals:

- [Kitty graphics escape code](https://sw.kovidgoyal.net/kitty/graphics-protocol/#the-graphics-escape-code)
- [Kitty support query](https://sw.kovidgoyal.net/kitty/graphics-protocol/#querying-support-and-available-transmission-mediums)

tmux does not transparently forward arbitrary terminal sequences. Its documented passthrough contract is a DCS wrapper
with the `tmux;` prefix and every inner ESC doubled. Since tmux 3.3, `allow-passthrough` must be `on` or `all`; `on`
restricts passthrough to visible panes:

- [tmux passthrough FAQ](https://github.com/tmux/tmux/wiki/FAQ#what-is-the-passthrough-escape-sequence-and-how-do-i-use-it)
- [tmux `allow-passthrough` manual entry](https://man7.org/linux/man-pages/man1/tmux.1.html)

Kitty added Unicode placeholders in 0.28.0 specifically so a Unicode-aware host application such as tmux can move the
image with ordinary text. The application uploads an image quietly, creates a virtual placement with `U=1`, and emits
`U+10EEEE` cells whose colors and diacritics encode image, placement, row, and column IDs:

- [Kitty Unicode placeholders](https://sw.kovidgoyal.net/kitty/graphics-protocol/#unicode-placeholders)

Warp is not currently compatible with that robust path. At pinned Warp HEAD
`a9c0a1ebda0acfe5e57b6f6df7c6ef744a71f8eb`, `U=1` is parsed but both store-and-display and display-stored actions
return `UnicodePlaceholderUnsupported`:

- [`kitty.rs` lines 299-375](https://github.com/warpdotdev/warp/blob/a9c0a1ebda0acfe5e57b6f6df7c6ef744a71f8eb/app/src/terminal/model/kitty.rs#L299-L375)
- [`kitty.rs` lines 607-719](https://github.com/warpdotdev/warp/blob/a9c0a1ebda0acfe5e57b6f6df7c6ef744a71f8eb/app/src/terminal/model/kitty.rs#L607-L719)

## Pi Stuff architecture fit

The existing media boundary is already correct:

- [`codex/tools.ts` lines 165-211](../../packages/pi-stuff/src/codex/tools.ts#L165-L211) returns native `image`
  content from `view_image`.
- [`codex/tools.ts` lines 215-277](../../packages/pi-stuff/src/codex/tools.ts#L215-L277) returns generated images as
  native image blocks.
- [ADR 0005](../adr/0005-wrap-active-suite-tools-in-one-local-code-mode-envelope.md) requires nested media to re-enter
  Pi's normal normalization and renderer so normal terminals, fallback terminals, and resumed Sessions share one path.
- [ADR 0001](../adr/0001-keep-pi-as-the-host.md) keeps the TUI and Session renderer Host-owned.
- [ADR 0004](../adr/0004-route-suite-diagnostics-through-owned-ui.md) rules out raw stdout tricks inside the Host TUI.

Pi Stuff already has a small tmux DCS wrapper in
[`notification/transport.ts` lines 37-55](../../packages/pi-stuff/src/notification/transport.ts#L37-L55), but it sends
one-shot terminal notifications. Reusing that idea in a process-wide stdout interceptor would not give tmux image-cell
ownership, redraw, cropping, eviction, or cleanup and would violate the Host-owned presentation boundary.

## Recommended scope

### Mergeable path

Implement and certify tmux-aware Kitty Unicode-placeholder rendering in Pi TUI, then move Pi Stuff's certified Host
profile to that reviewed upstream revision. Do not add another Pi Stuff image Tool or renderer.

The capability gate should require all of the following:

- interactive TUI mode;
- tmux 3.3 or newer with passthrough enabled;
- a successful DCS-wrapped Kitty graphics query or an equally strong confirmed outer-terminal signal;
- Unicode-placeholder support for the robust mode;
- the existing `terminal.showImages` setting.

On any failure, retain Pi's existing text fallback. `allow-passthrough all` is unnecessary unless invisible panes must be
allowed to send graphics; `on` is the safer default.

### Throwaway proof of concept

For a quick local experiment only, copy the referenced repository's capability override and add DCS wrapping to Pi's
Kitty upload/place/delete sequences. This can prove byte transport through one visible pane. It should not enter the
Pi Stuff Package because direct placements are not represented in tmux's cell buffer and cannot establish correct pane
switch, resize, scroll, or redraw behavior.

## Acceptance checks

The smallest meaningful certification is a real Pi Host PTY fixture running inside a real tmux server, plus pure checks
for byte encoding:

1. Supported outer terminal + `allow-passthrough on`: PNG renders at the expected cell rectangle.
2. Passthrough off, unsupported outer terminal, noninteractive mode, or `terminal.showImages: false`: bounded text
   fallback and no graphics bytes.
3. Pane hide/show, split, resize, TUI resize, scroll, alternate-screen exit, Session reload, and Host shutdown leave no
   stale image and restore the same transcript layout.
4. Upload, placement, eviction, and deletion commands are DCS-wrapped exactly once; inner ESC bytes are doubled.
5. Existing direct Kitty rendering outside tmux remains byte-equivalent.
6. Pi Stuff's existing `view_image`, `imagegen`, nested Code Mode media, and extracted-Package checks remain unchanged.

No test should call an LLM or require credentials.
