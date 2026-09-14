import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {stripVTControlCharacters} from 'node:util';

export function registerRtk(pi: ExtensionAPI): void {
  pi.on('tool_result', event => ({
    content: event.content.map(block =>
      block.type === 'text'
        ? {...block, text: stripVTControlCharacters(block.text)}
        : block,
    ),
  }));
}
