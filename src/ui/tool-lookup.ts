import {
  AgentSession,
  InteractiveMode,
  type ExtensionAPI,
  type MarkdownTransformer,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import {Option, Schema} from 'effect';

export type ToolView = Pick<
  ToolDefinition,
  'renderCall' | 'renderResult' | 'renderShell'
>;
type Lookup = (this: InteractiveMode, name: string) => ToolView | undefined;
const HostPrototype = Schema.Struct({
  // The private method's signature is verified against both supported hosts.
  // Check its presence before installing; never create a missing host method.
  getRegisteredToolDefinition: Schema.declare<Lookup>(
    (value): value is Lookup => value instanceof Function,
  ),
});

// Keep private TUI compatibility and lifecycle handling out of tool renderers.
// Public SDK lookup and the executable registry are never replaced here.
export function registerToolDisplay(
  pi: ExtensionAPI,
  owner: MarkdownTransformer,
  decorate: (tool: ToolDefinition, session: AgentSession) => ToolView,
  missing: (name: string, native: ToolView | undefined) => ToolView | undefined,
): void {
  const decoded = Schema.decodeUnknownOption(HostPrototype)(
    InteractiveMode.prototype,
  );
  if (Option.isNone(decoded)) return;
  const getSession = Object.getOwnPropertyDescriptor(
    InteractiveMode.prototype,
    'session',
  )?.get;
  if (!getSession) return;
  const original = decoded.value.getRegisteredToolDefinition;
  const pending = new Map<string, () => void>();
  let active = true;
  let ready = false;
  const lookup: Lookup = function (name) {
    const tool = original.call(this, name);
    if (!active) return tool;
    const session = getSession.call(this);
    if (!(session instanceof AgentSession)) return tool;
    if (
      !session.resourceLoader
        .getExtensions()
        .extensions.some(extension => extension.markdownTransformer === owner)
    )
      return tool;
    // Native TUI lookup can return renderer-only built-in fallbacks. Obtain
    // executable/schema metadata only from the public SDK's actual definition.
    const definition = session.getToolDefinition(name);
    const existing = definition ? {...definition, ...tool} : undefined;
    const view = existing
      ? decorate(existing, session)
      : (missing(name, tool) ?? tool);
    if (!view || view === existing || view === tool) return tool;
    const renderResult = view.renderResult;
    if (!renderResult) return view;
    return {
      ...view,
      renderResult(result, options, theme, context) {
        if (!ready) pending.set(context.toolCallId, context.invalidate);
        return renderResult(result, options, theme, context);
      },
    };
  };
  Object.assign(InteractiveMode.prototype, {
    getRegisteredToolDefinition: lookup,
  });
  pi.on('session_start', () => {
    ready = true;
    for (const invalidate of pending.values()) invalidate();
    pending.clear();
  });
  pi.on('session_shutdown', event => {
    ready = false;
    pending.clear();
    if (event.reason !== 'quit' && event.reason !== 'reload') return;
    active = false;
    const current = Schema.decodeUnknownOption(HostPrototype)(
      InteractiveMode.prototype,
    );
    if (
      Option.isSome(current) &&
      current.value.getRegisteredToolDefinition === lookup
    )
      Object.assign(InteractiveMode.prototype, {
        getRegisteredToolDefinition: original,
      });
  });
}
