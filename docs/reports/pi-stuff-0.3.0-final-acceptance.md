# Pi Stuff 0.3.0 final acceptance

> Historical acceptance record from 2026-08-05. It does not certify the current Host or installation path; use the
> [compatibility guide](../compatibility.md) for current versions.

## Release identity

| Item | Recorded value |
| --- | --- |
| Package | `@jczhang02/pi-stuff@0.3.0` |
| Pi Host | `0.83.0` |
| Release archive | `.artifacts/release/jczhang02-pi-stuff-0.3.0.tgz` |
| Archive SHA-256 | `6fdb2a410ad38c202dffd08a416e7119390887d95d06f47748737556dfbcbed0` |
| Signed release commit | `1581958e73194e76e89b2121bf4206f442155402` |
| Signed acceptance-race fix | `2facc4355313d61f5b0340797f2a8a9fe5fc0c47` |

The archive was installed through Pi's Settings layer and exercised in a real Pi TUI with a real OpenAI Codex model.
The run covered fresh use, failures, Context pressure, and cold resume.

## Real-Host evidence

The main Session was recorded at:

```text
.artifacts/final-acceptance-0.3.0/real-model-sessions/2026-08-05T09-43-55-235Z_019fd14e-e063-7d63-a037-81347769fdda.jsonl
```

Its SHA-256 was `cc14c9770b2a781539cd3f98c54cde2247337410648e248f95b4f28fcbb6b52e`; the Session contained
140 entries. The retained digest records these outcomes:

- Todo reached 5/5 completed. Background Shell and Monitor produced `BACKGROUND_REAL_030` and
  `MONITOR_REAL_030` while foreground work continued.
- Web, MCP, Agents, and image inspection completed in the same run. The local MCP result was `MCP_REAL_030`.
- BTW kept `PI_STUFF_030_REAL_ACCEPTANCE` outside the main transcript. Goal wrote and verified
  `GOAL_REAL_030\n` byte for byte.
- Expected Bash, private-network URL, and broken-MCP failures stayed visible; the Agent continued with
  `DEGRADED_RECOVERY_030`.
- Magic Context compacted at 53,297 tokens with `source: magic-context` and no native boundary. Cold resume recovered
  the early markers through Context retrieval.

## Magic-only gate

The machine-readable [Magic Context report](magic-context-real-acceptance.json) keeps the complete artifact and Session
hashes. Its acceptance digest is:

| Measurement | Result |
| --- | ---: |
| Model context window | 128,000 tokens |
| Maximum Provider prompt | 94,373 tokens (73.73%) |
| Official Magic raw-pressure peak | 113,765 tokens |
| Boundaries | ordinals 6 and 10; compartments 1–6 and 7–10 |
| Prompt Cache | 461,184 cached-read tokens; 46.64% hit rate |
| Pi native compaction | disabled for this gate; 0 native boundaries and lifecycle events |
| Final result | passed |

The daily configuration retained native compaction only as a pre-Magic fallback. That setting was outside this
Magic-only gate.

## Packaging and closure

The release check rebuilt 13 immutable archives and finished with `544 pass / 0 fail / 0 skip`. The final log SHA-256
was `4ae1dcb537ed6775b0d4d29e6112c7e71c900dcc4ba97aa1292b5f3867a23505`; RTK `0.42.4` and Pi `0.83.0` were the
recorded executables. The completed 95-item checklist covered UI, background work, Context, repository consolidation,
capability regression, packaging, and real-model acceptance.

The detailed checklist and five UI captures were removed from the current tree after this digest was consolidated.
Git history retains them.

## Result

Pi Stuff 0.3.0 passed its recorded real-Host, real-model, packaging, failure-recovery, and Magic-only gates. This result
is historical evidence, not a current compatibility claim.
