import {
  InteractiveMode,
  SkillInvocationMessageComponent,
  UserMessageComponent,
  type ExtensionAPI,
  type MarkdownTransformer,
} from '@earendil-works/pi-coding-agent';
import type {AgentMessage} from '@earendil-works/pi-agent-core';
import {Container, Spacer, type MarkdownTheme} from '@earendil-works/pi-tui';
import {Option, Schema} from 'effect';
import {SkillMessageCard} from './card';

type Insert = (
  this: InteractiveMode,
  message: AgentMessage,
  options?: {populateHistory?: boolean},
) => void;
const HostMethod = Schema.Struct({
  addMessageToChat: Schema.declare<Insert>(
    (value): value is Insert => value instanceof Function,
  ),
  getMarkdownTransformers: Schema.declare<() => readonly MarkdownTransformer[]>(
    (value): value is () => readonly MarkdownTransformer[] =>
      value instanceof Function,
  ),
  getMarkdownThemeWithSettings: Schema.declare<() => MarkdownTheme>(
    (value): value is () => MarkdownTheme => value instanceof Function,
  ),
});
const HostLayout = Schema.Struct({
  chatContainer: Schema.instanceOf(Container),
  outputPad: Schema.Number,
  toolOutputExpanded: Schema.Boolean,
});
const SkillLayout = Schema.Struct({
  skillBlock: Schema.Struct({
    name: Schema.String,
    location: Schema.String,
    content: Schema.String,
    userMessage: Schema.optional(Schema.String),
  }),
});
const PromptLayout = Schema.Struct({text: Schema.String});

// Pi has no public user-message renderer. This verified insertion seam keeps
// execution, session records, native history insertion and other messages intact.
export function registerSkillMessages(
  pi: ExtensionAPI,
  owner: MarkdownTransformer,
) {
  const method = Schema.decodeUnknownOption(HostMethod)(
    InteractiveMode.prototype,
  );
  if (Option.isNone(method)) return;
  const original = method.value.addMessageToChat;
  let active = true;
  const insert: Insert = function (message, options) {
    const layout = Schema.decodeUnknownOption(HostLayout)(this);
    const start = Option.isSome(layout)
      ? layout.value.chatContainer.children.length
      : 0;
    original.call(this, message, options);
    if (!active || message.role !== 'user' || Option.isNone(layout)) return;
    const host = layout.value;
    const transformers = method.value.getMarkdownTransformers.call(this);
    if (!transformers.includes(owner)) return;
    const children = host.chatContainer.children;
    const first = start + (start > 0 ? 1 : 0);
    const component = children[first];
    if (!(component instanceof SkillInvocationMessageComponent)) return;
    const decoded = Schema.decodeUnknownOption(SkillLayout)(component);
    if (Option.isNone(decoded)) return;
    const skill = {
      ...decoded.value.skillBlock,
      userMessage: decoded.value.skillBlock.userMessage,
    };
    const count = skill.userMessage ? 3 : 1;
    if (count === 3) {
      const prompt = children[first + 2];
      if (
        !(children[first + 1] instanceof Spacer) ||
        !(prompt instanceof UserMessageComponent)
      )
        return;
      const text = Schema.decodeUnknownOption(PromptLayout)(prompt);
      if (Option.isNone(text) || text.value.text !== skill.userMessage) return;
    }
    const card = new SkillMessageCard(
      skill,
      method.value.getMarkdownThemeWithSettings.call(this),
      host.outputPad,
      transformers,
    );
    card.setExpanded(host.toolOutputExpanded);
    children.splice(first, count, card);
  };
  Object.assign(InteractiveMode.prototype, {addMessageToChat: insert});
  pi.on('session_shutdown', event => {
    if (event.reason !== 'quit' && event.reason !== 'reload') return;
    active = false;
    const current = Schema.decodeUnknownOption(HostMethod)(
      InteractiveMode.prototype,
    );
    if (Option.isSome(current) && current.value.addMessageToChat === insert)
      Object.assign(InteractiveMode.prototype, {addMessageToChat: original});
  });
}
