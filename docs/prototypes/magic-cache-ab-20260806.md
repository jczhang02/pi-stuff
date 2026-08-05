# Magic Context prompt-cache A/B prototype

## Question

What prompt-cache hit rate does Pi Stuff display under a matched long-session workload with and without Magic Context?

This is a one-run synthetic experiment, not a universal performance claim. It measures the exact cumulative formula used by the Pi Stuff Statusline:

`cacheRead / (input + cacheRead + cacheWrite)`

## Fixed conditions

- Pi Host: `0.83.0`
- Pi Stuff: installed `0.3.3`
- Provider/model: `openai-codex/gpt-5.3-codex-spark`
- Context window: 128,000 tokens
- Thinking: low
- Pi native compaction: disabled in both arms
- Magic arm: installed Pi Stuff Context Capability, official Magic Context `0.33.1`, automatic threshold 65%
- Plain arm: no Context or compaction Extension
- Workload: the same ordered file sizes, read operations, user prompts, and two final probe turns; arm-specific equal-length content prevents cross-arm prompt-cache reuse

The first attempted pressure method used direct RPC Bash entries. Pi reported 83.4% context usage, but Magic published no boundary, so that attempt was rejected rather than treated as the Magic result. The accepted run used normal Agent `read` Tool calls, matching the already-certified Magic Context acceptance path.

## Result

| Measurement | Magic Context | No Magic Context | Difference |
| --- | ---: | ---: | ---: |
| Final cumulative cache hit rate | 24.38% | 74.80% | -50.42 percentage points |
| Matched turns 5–7, after Magic first published a boundary | 2.49% | 97.71% | -95.22 percentage points |
| Final context usage | 54.37% | 70.40% | -16.03 percentage points |

Raw cumulative cache accounting:

| Arm | Cache read | Uncached input | Cache write | Denominator |
| --- | ---: | ---: | ---: | ---: |
| Magic Context | 154,112 | 477,928 | 0 | 632,040 |
| No Magic Context | 495,104 | 166,770 | 0 | 661,874 |

Matched turns 5–7:

| Arm | Cache read | Uncached input | Cache write | Hit rate |
| --- | ---: | ---: | ---: | ---: |
| Magic Context | 7,680 | 300,541 | 0 | 2.49% |
| No Magic Context | 344,704 | 8,072 | 0 | 97.71% |

Magic crossed 65% on turn 4. Its first managed-history boundary appeared on turn 5; a second boundary was present by turn 6. The per-turn cache hit rate moved from 62.73% immediately before the first boundary to 2.38%, 2.49%, and 2.76% on turns 5–7. The matched plain arm reached 95.51%, 99.76%, and 99.87% on those turns.

## Verdict

For this long, repetitive workload, Magic Context traded prompt-cache reuse for lower active context pressure. The effect was not subtle: managed-history publication changed the provider prefix enough to make the next three requests almost entirely uncached, while the uncompressed arm kept reusing a stable prefix.

This does not establish that Magic Context is globally worse. The plain arm retained a high cache rate precisely because it kept the full, growing history and ended at 70.40% of the window. It would eventually need some form of compaction. The experiment establishes the immediate trade-off: Magic preserved context headroom, but its current history rewriting was expensive for OpenAI Codex prompt caching.

The exact result is workload-, model-, timing-, and provider-cache-dependent. Repeat trials and the current 272k `gpt-5.6-sol` model would be needed before treating these percentages as a daily-use forecast.
