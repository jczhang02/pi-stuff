# `@jczhang02/pi-stuff`

The ordered Aggregate Package for the Pi Stuff Suite.

> This Package is unreleased. Its included capabilities are under host certification.

## Contract

- Loads through the native Pi Package system.
- Exports one default Extension factory.
- Invokes Capability factories in the explicit registry order.
- Fails fast when a Capability cannot initialize.
- Does not install itself or mutate Host settings.

## Included capabilities

- `@jczhang02/pi-stuff-ui`: the shared, non-floating Command Dialog host used by Suite commands.
- `@jczhang02/pi-stuff-todo`: four model-facing Task tools and a compact task widget above Pi's editor.
- `@jczhang02/pi-stuff-btw`: one-shot side questions that use the effective conversation context without changing the main transcript.

After the first release:

```bash
pi install npm:@jczhang02/pi-stuff
```
