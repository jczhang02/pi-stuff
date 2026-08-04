# Upstream provenance

| Field | Value |
| --- | --- |
| Upstream repository | `https://github.com/narumiruna/pi-extensions` |
| Upstream package | `extensions/pi-goal` / `@narumitw/pi-goal` |
| Upstream release | `v0.48.0` |
| Upstream commit | `f0963e4c343124a6f1419163b0425f571282c9b0` |
| Owned fork | `https://github.com/jczhang02/pi-extensions` |
| Owned baseline branch | `pi-stuff-goal-v0.48.0` |
| License | MIT |
| License SHA-256 | `5293e92f073f47012e723990a8605431b438757e9c6eb00c89868b1203e157da` |
| npm version | `@narumitw/pi-goal@0.48.0` |
| npm `gitHead` | `f0963e4c343124a6f1419163b0425f571282c9b0` |
| npm SHA-1 | `2b8a6ec48afb4f1f5d7139b7ae42adc58c338bcf` |
| npm SRI | `sha512-IOvGEPvqCwuHCNN+hAAGG1B4IzlC8QUj/clPq3E3G5iRHdNip6nsqWnTFCBnLHEiNrMFJkJw0L14n4ugjSft1Q==` |

The upstream tag resolves exactly to the recorded commit. At adoption time, `extensions/pi-goal` had no diff between
that commit and upstream `main`. The npm registry metadata points to the same `gitHead`.

Pi Stuff does not consume upstream code at runtime. The complete source was forked into this Package and is maintained
under the original MIT license.

## Pi Stuff delta

- Replaces `@narumitw/pi-tui-kit`, package-owned status chrome, and floating presentation with the Suite's shared
  full-width Command Dialog and Pi's native SettingsList.
- Publishes observation-only Goal state through `@jczhang02/pi-stuff-ui`; Goal does not own the Statusline.
- Makes automatic continuation and no-progress detection unlimited/off for ordinary use by default, while retaining
  optional user-set limits, token budgets, and a non-disableable high emergency turn backstop.
- Requires the same stable blocker with distinct substantive failed-attempt evidence on three consecutive Goal turns
  before `goal_blocked` can stop work; resume and edit start a fresh audit.
- Requires structured, requirement-by-requirement concrete evidence before `goal_complete` can stop work.
- Keeps ordinary provider retry exhaustion, compaction, phase changes, and incomplete responses inside the active Goal
  lifecycle.
- Preserves the complete upstream state machine, queue/RPC support, session persistence, and test corpus.
