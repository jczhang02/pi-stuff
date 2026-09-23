import type {SessionEntry} from '@earendil-works/pi-coding-agent';
import {Schema} from 'effect';

function clip(text: string, limit: number) {
  const characters = Array.from(text);
  if (characters.length <= limit) return text;
  const marker = '\n[... omitted ...]\n';
  const remaining = limit - marker.length;
  return (
    characters.slice(0, Math.ceil(remaining / 2)).join('') +
    marker +
    characters.slice(-Math.floor(remaining / 2)).join('')
  );
}

export function openingInput(request: string, answer: string) {
  return `Opening user request:\n${clip(request, 1450)}\nFinal assistant answer:\n${clip(answer, 500)}`;
}

export function explicitInput(hint: string, entries: readonly SessionEntry[]) {
  if (hint.trim())
    return `Task hint (highest priority):\n${clip(hint.trim(), 3960)}`;
  const dialogue = entries.flatMap(entry => {
    if (entry.type !== 'message') return [];
    const message = entry.message;
    if (message.role !== 'user' && message.role !== 'assistant') return [];
    const text = Schema.is(Schema.String)(message.content)
      ? message.content
      : message.content
          .flatMap(block => (block.type === 'text' ? [block.text] : []))
          .join('\n');
    // Pi's expanded /skill messages embed instructions before the user's arguments.
    const clean =
      message.role === 'user'
        ? text.replace(
            /^<skill name="[^"\n]*" location="[^"\n]*">[\s\S]*?\n<\/skill>\s*/,
            '',
          )
        : text;
    return clean.trim() ? [{role: message.role, text: clean}] : [];
  });
  const first = dialogue.findIndex(message => message.role === 'user');
  const selected = dialogue.filter(
    (_message, index) => index === first || index >= dialogue.length - 5,
  );
  if (!selected.length) return undefined;
  const budget = Math.floor(3900 / selected.length);
  return selected
    .map(
      (message, index) =>
        `${index === 0 ? 'Opening/context' : 'Recent'} ${message.role}:\n${clip(message.text, budget - 35)}`,
    )
    .join('\n');
}
