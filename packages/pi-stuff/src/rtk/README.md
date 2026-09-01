# RTK

[Simplified Chinese](../../../../docs/i18n/zh-CN/packages/pi-stuff/src/rtk/README.md)

Optional command rewriting and model-only output projection for Bash and Grep.

<p align="center">
  <a href="../../../../docs/assets/readme/capabilities/rtk.png">
    <img src="../../../../docs/assets/readme/capabilities/rtk.png" alt="RTK verification and rewrite controls in Pi" width="100%">
  </a>
  <br>
  <em>The RTK dialog separates runtime verification, rewrite policy, and Session savings.</em>
</p>

## Quick start

Install the certified RTK `0.45.0` Linux x64 binary on `PATH`, then open:

```text
/rtk
```

The dialog verifies the runtime, toggles Command rewriting and Model projection, and shows current Session savings.

## Highlights

- Verifies the official version and executable SHA-256 on first use.
- Rechecks runtime identity before every rewrite and detects binary drift.
- Leaves the original Bash command unchanged when RTK is unavailable.
- Projects compact successful Bash and Grep text without changing Session JSONL.
- Keeps rewriting and projection independently configurable.
- Bounds runtime probes, rewrites, projected output, and savings statistics.

## Documentation

- [RTK guide](../../../../docs/capabilities/rtk.md)
- [Settings reference](../../../../docs/reference/settings.md#rtk)
- [Troubleshooting](../../../../docs/troubleshooting.md#rtk)
- [Upstream references](UPSTREAM.md)
