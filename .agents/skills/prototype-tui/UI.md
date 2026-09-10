# UI Prototype

Generate **several radically different UI variations** in a single terminal view, switchable from a prototype control. The user flips between variants in the shared terminal, picks one (or steals bits from each), then throws the rest away.

If the question is about logic/state rather than what something looks like, this is the wrong branch. Use [LOGIC.md](LOGIC.md).

## When this is the right shape

- "What should this terminal screen look like?"
- "I want to see a few options for this dashboard before committing."
- "Try a different layout for the settings screen."
- Any time the user would otherwise spend a day picking between three vague mockups in their head.

## Two sub-shapes: strongly prefer sub-shape A

A UI prototype is much easier to judge when it's **butting up against the rest of the app**: real header, real sidebar, real data, real density. A throwaway view on its own is a vacuum: every variant looks fine in isolation. Default to sub-shape A whenever there's a plausible existing screen to host the variants. Only reach for sub-shape B if the prototype genuinely has no nearby home.

### Sub-shape A: adjustment to an existing screen (preferred)

The screen already exists. Variants are rendered **in the same view**, selected by a prototype command argument such as `--variant=B` and changed through the switcher. The existing data loading, arguments, and auth all stay. Only the rendering swaps. This is the default; pick it unless there's a specific reason not to.

If the prototype is for something that doesn't yet have a screen but _would naturally live inside one_ (a new section of the dashboard, a new card on the settings screen, a new step in an existing flow), it's still sub-shape A. Mount the variants inside the host screen.

### Sub-shape B: a new screen (last resort)

Only use this when the thing being prototyped genuinely has no existing screen to live inside (e.g. an entirely new top-level surface, or a flow that can't be embedded anywhere sensible).

Create a **throwaway TUI entrypoint** following whatever convention the project already uses. Don't invent a new top-level structure. Name it so it's obviously a prototype (e.g. include the word `prototype` in the path or filename). Same variant argument pattern.

Before committing to sub-shape B, sanity-check: is there really no existing screen this could be embedded in? An empty view hides design problems that a populated one would expose.

In both sub-shapes the prototype switcher is identical.

## Process

### 1. State the question and pick N

Default to **3 variants**. More than 5 stops being radically different and starts being noise, so cap there.

Write down the plan in one line, in the prototype's location or a top-of-file comment:

> "Three variants of the existing settings screen, selectable by a command argument and switchable in the same terminal session."

This works whether the user is here to push back or not.

### 2. Generate radically different variants

Draft each variant. Hold each one to:

- The screen's purpose and the data it has access to.
- The project's TUI components, theme and input conventions, as defined by its design document.
- A clear exported component name, e.g. `VariantA`, `VariantB`, `VariantC`.

Variants must be **structurally different**: different layout, different information hierarchy, different primary affordance, not just different colours. Three slightly-tweaked card grids isn't a UI prototype, it's wallpaper. If two drafts come out too similar, redo one with explicit "do not use a card grid" guidance.

### 3. Wire them together

Create a single switcher component in the view:

```text
# Pseudo-code: adapt argument parsing and rendering to the project's TUI.
variant = requested variant, default A
render the matching VariantA, VariantB or VariantC with the same data
render PrototypeSwitcher with keys A, B, C and the current variant
on selection: update variant and re-render the view
```

For sub-shape A (existing screen): keep all the existing data loading above the switcher; only the rendered subtree changes per variant.

For sub-shape B (new screen): the throwaway TUI entrypoint mounts the same switcher.

### 4. Build the terminal switcher

A small, visible prototype control with three pieces, placed according to the project's TUI layout conventions:

- **Previous action**: cycles to the previous variant (wraps around).
- **Variant label**: shows the current variant key and, if the variant exports a name, that name too. e.g. `B (Sidebar layout)`.
- **Next action**: cycles forward (wraps around).

Behaviour:

- Selecting an action changes the rendered variant in the same session. Show its launch command with the variant argument so rerunning that command opens the selected variant again.
- Keyboard: use the project's input conventions and make the switcher's controls visible. Handle navigation keys only when the switcher has focus; preserve text editing and navigation in the view being evaluated.
- Visually distinct from the view, using the project's theme, so it's obviously a prototype control rather than part of the design being evaluated.
- Available only through the prototype/development entrypoint or equivalent project gate, so a stray prototype merge can't expose the switcher to ordinary users.

Put the switcher in a single shared component so both sub-shapes can reuse it. Locate it wherever shared TUI components live in the project.

### 5. Hand it over

Surface the launch command (and variant arguments), working directory and Tuistory attachment command. The user can join the shared session and flip through whenever they get to it. The interesting feedback is usually **"I want the header from B with the sidebar from C"**, which is the actual design they want.

### 6. Capture the answer and clean up

Once a variant has won, capture the answer (which variant and why), then capture the prototype the way the [SKILL](SKILL.md) describes. Fold the winner into the real code and move the rest onto the throwaway branch, not into main:

- **Sub-shape A**: fold the winner into the existing screen; drop the losing variants and the switcher from main.
- **Sub-shape B**: promote the winning variant to a real screen; drop the throwaway entrypoint and the switcher from main.

The full set of variants is the primary source, so it lands on the throwaway branch, not the bin, since variant components and the switcher left in the main branch rot fast and confuse the next reader.

## Anti-patterns

- **Variants that differ only in colour or copy.** That's a tweak, not a prototype. Real variants disagree about structure.
- **Sharing too much code between variants.** A shared `<Header>` is fine; a shared `<Layout>` defeats the point. Each variant should be free to throw out the layout.
- **Wiring variants to real mutations.** Read-only prototypes are fine. If a variant needs to mutate, point it at a stub: the question is "what should this look like", not "does the backend work".
- **Promoting the prototype directly to production.** The variant code was written under prototype constraints (no tests, minimal error handling). Rewrite it properly when you fold it in.
