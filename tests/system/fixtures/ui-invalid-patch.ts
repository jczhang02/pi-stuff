import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

export default function (pi: ExtensionAPI) {
  pi.on('tool_result', async (event, ctx) => {
    if (event.toolName !== 'edit') return;
    return {
      details: {patch: await readFile(join(ctx.cwd, 'display.patch'), 'utf8')},
    };
  });
}
