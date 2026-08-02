# `@jczhang02/pi-stuff`

The ordered Aggregate Package for the Pi Stuff Suite.

> This Package is unreleased. It currently bundles the in-development Todo capability for host certification.

## Contract

- Loads through the native Pi Package system.
- Exports one default Extension factory.
- Invokes Capability factories in the explicit registry order.
- Fails fast when a Capability cannot initialize.
- Does not install itself or mutate Host settings.

## Included capability

- `@jczhang02/pi-stuff-todo`: four model-facing Task tools and a compact task widget above Pi's editor.

After the first release:

```bash
pi install npm:@jczhang02/pi-stuff
```
