import {
  getAgentDir,
  SettingsManager,
  type ExtensionContext,
  type SessionEntry,
} from '@earendil-works/pi-coding-agent';
import type {Model} from '@earendil-works/pi-ai';
import {Effect, Schema} from 'effect';

const Compaction = Schema.Struct({
  enabled: Schema.Boolean,
  reserveTokens: Schema.Number.check(
    Schema.isFinite(),
    Schema.isGreaterThanOrEqualTo(0),
  ),
});
export type Compaction = typeof Compaction.Type;

export function readCompaction(ctx: ExtensionContext) {
  return Effect.try(() => {
    const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
      projectTrusted: ctx.isProjectTrusted(),
    });
    // Older supported hosts ignore this optional argument; newer hosts resolve model overrides.
    const resolveCompaction: (
      model?: Pick<Model<string>, 'provider' | 'id'>,
    ) => Compaction = settings.getCompactionSettings.bind(settings);
    const value = resolveCompaction(ctx.model);
    if (settings.drainErrors().length) return undefined;
    return value;
  }).pipe(
    Effect.flatMap(value =>
      value
        ? Schema.decodeUnknownEffect(Compaction)(value)
        : Effect.succeed(undefined),
    ),
    Effect.catch(() => Effect.succeed(undefined)),
  );
}

export function cacheHit(branch: readonly SessionEntry[]): number | undefined {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry?.type !== 'message' || entry.message.role !== 'assistant')
      continue;
    const message = entry.message;
    if (message.stopReason === 'error' || message.stopReason === 'aborted')
      continue;
    const {input, cacheRead, cacheWrite} = message.usage;
    if (
      ![input, cacheRead, cacheWrite].every(
        value => Number.isFinite(value) && value >= 0,
      )
    )
      continue;
    const total = input + cacheRead + cacheWrite;
    if (total > 0) return (100 * cacheRead) / total;
  }
  return undefined;
}
