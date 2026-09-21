import type {ExtensionContext, ToolInfo} from '@earendil-works/pi-coding-agent';
import {getAgentDir} from '@earendil-works/pi-coding-agent';
import type {Api, Model, ModelsApiStreamOptions} from '@earendil-works/pi-ai';
import {getSupportedThinkingLevels} from '@earendil-works/pi-ai';
import type {ThinkingLevel} from '@earendil-works/pi-agent-core';
import {Effect} from 'effect';
import type {TaskInput} from './protocol';
import {resolveRole} from './roles';
import {SubagentError} from './session';
import {extensionPaths, inheritedTools} from './extensions';

const readonlyTools = ['read', 'grep', 'find', 'ls'];
const writerTools = [...readonlyTools, 'bash', 'edit', 'write'];

export function selectModel(
  ctx: ExtensionContext,
  reference: string | undefined,
): Model<Api> {
  const ref = reference?.trim();
  if (!ref) {
    if (!ctx.model)
      throw new SubagentError({message: 'Select a parent model first.'});
    return ctx.model;
  }
  const available = ctx.modelRegistry.getAvailable();
  if (!ref.includes('/') && ctx.model) {
    const own = available.filter(
      model => model.provider === ctx.model?.provider,
    );
    const model =
      own.find(model => model.id === ref) ??
      own.find(model => model.id.endsWith(`/${ref}`));
    if (model) return model;
  }
  const exact = available.find(model => model.id === ref);
  if (exact) return exact;
  for (
    let slash = ref.indexOf('/');
    slash > 0;
    slash = ref.indexOf('/', slash + 1)
  ) {
    const model = ctx.modelRegistry.find(
      ref.slice(0, slash),
      ref.slice(slash + 1),
    );
    if (model) return model;
  }
  throw new SubagentError({message: `Model not found: ${ref}`});
}

export function validateThinking(
  model: Model<Api>,
  thinking: ThinkingLevel | undefined,
): void {
  if (thinking === undefined) return;
  const supported = getSupportedThinkingLevels(model);
  if (!supported.includes(thinking))
    throw new SubagentError({
      message: `Thinking level ${thinking} is not supported by ${model.provider}/${model.id}. Supported: ${supported.join(', ')}.`,
    });
}

export function resolveConfiguration(
  input: TaskInput,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
  parentTools: readonly ToolInfo[],
) {
  return Effect.gen(function* () {
    const role = yield* resolveRole(
      input.agent,
      input.task,
      input.cwd,
      getAgentDir(),
    );
    const notes: string[] = [];
    const extensions = inheritedTools(parentTools);
    const inherited = extensions.filter(
      tool => role?.tools === undefined || role.tools.includes(tool),
    );
    const allowed = [
      ...(input.write ? writerTools : readonlyTools),
      ...inherited,
    ];
    const fileTools = role?.tools?.filter(tool => allowed.includes(tool));
    const explicit = input.explicitTools || input.write;
    const tools = explicit
      ? [...input.tools, ...(input.explicitTools ? [] : inherited)]
      : fileTools?.length
        ? fileTools
        : allowed;
    if (explicit && fileTools?.length)
      notes.push(
        `Explicit tools overrode agent-file tools (${fileTools.join(', ')}).`,
      );
    if (role && input.prompt)
      notes.push('Agent-file instructions replaced the inline prompt.');
    if (role?.model && input.model && role.model !== input.model)
      notes.push(
        `Agent-file model ${role.model} replaced requested model ${input.model}.`,
      );
    yield* Effect.try({
      try() {
        const denied = tools.find(
          tool =>
            extensions.includes(tool) &&
            role?.tools !== undefined &&
            !role.tools.includes(tool),
        );
        if (denied)
          throw new Error(
            `Agent-file tools do not allow extension tool: ${denied}`,
          );
        return extensionPaths(tools, parentTools);
      },
      catch: error => new SubagentError({message: String(error)}),
    });
    const model = yield* Effect.try({
      try() {
        signal?.throwIfAborted();
        const selected = selectModel(ctx, role?.model ?? input.model);
        validateThinking(selected, input.thinking);
        return selected;
      },
      catch: error =>
        new SubagentError({
          message: error instanceof Error ? error.message : String(error),
        }),
    });
    return {
      prompt: role?.body ?? input.prompt,
      tools,
      write: tools.some(tool => ['bash', 'edit', 'write'].includes(tool)),
      model,
      thinking: input.thinking,
      roleSource: role?.path,
      notes,
    };
  });
}

export type ResolvedConfiguration = Effect.Success<
  ReturnType<typeof resolveConfiguration>
>;

export function preflightConfiguration(
  configuration: ResolvedConfiguration,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
) {
  return Effect.tryPromise({
    async try() {
      signal?.throwIfAborted();
      const model = configuration.model;
      if (model.id === ctx.model?.id && model.provider === ctx.model.provider)
        return configuration;
      let failure: string | undefined;
      try {
        const options: ModelsApiStreamOptions<Api> = {maxTokens: 16};
        if (signal) options.signal = signal;
        const reply = await ctx.modelRegistry.complete(
          model,
          {
            messages: [{role: 'user', content: 'ping', timestamp: Date.now()}],
          },
          options,
        );
        if (reply.stopReason === 'error' || reply.stopReason === 'aborted')
          failure = reply.errorMessage ?? 'Provider preflight failed.';
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
      signal?.throwIfAborted();
      if (!failure) return configuration;
      if (!ctx.model) throw new SubagentError({message: failure});
      validateThinking(ctx.model, configuration.thinking);
      return {
        ...configuration,
        model: ctx.model,
        notes: [
          ...configuration.notes,
          `${model.provider}/${model.id} failed preflight (${failure}); using parent model ${ctx.model.provider}/${ctx.model.id}.`,
        ],
      };
    },
    catch: error =>
      new SubagentError({
        message: error instanceof Error ? error.message : String(error),
      }),
  });
}
