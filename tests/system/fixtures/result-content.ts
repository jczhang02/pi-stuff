import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import type {AgentToolResult} from '@earendil-works/pi-agent-core';
import {Type, type Static} from 'typebox';

export const ANSI_RESULT =
  '\x1b[31mCSI_RED\x1b[0m\n' +
  'OSC:\x1b]8;;https://example.invalid\x07OSC_LINK\x1b]8;;\x07\n' +
  'Unicode 中文 😀\n\tTAB\n' +
  'actual-esc:\x1b printable-escape:\\033[31m';

export const ANSI_CLEAN_RESULT =
  'CSI_RED\n' +
  'OSC:OSC_LINK\n' +
  'Unicode 中文 😀\n\tTAB\n' +
  'actual-esc:\x1b printable-escape:\\033[31m';

export const MIXED_BEFORE = '\x1b[34mMIXED_BEFORE 中文\x1b[0m\n\tbefore';
export const MIXED_AFTER = 'MIXED_AFTER\n\tafter 中文';
export const MIXED_BEFORE_CLEAN = 'MIXED_BEFORE 中文\n\tbefore';
export const MIXED_IMAGE_DATA =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk' +
  '+A8AAQUBAScY42YAAAAASUVORK5CYII=';
export const MIXED_DETAILS = {
  mode: 'mixed' as const,
  marker: 'details-preserved',
  order: 'text-image-text',
};
export const RESULT_USAGE = {
  input: 11,
  output: 7,
  cacheRead: 3,
  cacheWrite: 2,
  totalTokens: 23,
  cost: {
    input: 0.11,
    output: 0.07,
    cacheRead: 0.03,
    cacheWrite: 0.02,
    total: 0.23,
  },
};

export const ERROR_RESULT =
  '\x1b[31mERROR_RESULT 中文\x1b[0m\n\tERROR_LITERAL:\\033';
export const ERROR_CLEAN_RESULT = 'ERROR_RESULT 中文\n\tERROR_LITERAL:\\033';

const Parameters = Type.Object({
  mode: Type.Union([
    Type.Literal('ansi'),
    Type.Literal('mixed'),
    Type.Literal('error'),
  ]),
});
type Parameters = Static<typeof Parameters>;

interface ResultDetails {
  mode: 'ansi' | 'mixed';
  marker: string;
  order: string;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'result_content',
    label: 'result content',
    description:
      'Offline acceptance fixture that returns ANSI, mixed, or error content.',
    parameters: Parameters,
    async execute(
      _toolCallId,
      params: Parameters,
    ): Promise<AgentToolResult<ResultDetails>> {
      if (params.mode === 'error') throw new Error(ERROR_RESULT);
      if (params.mode === 'ansi')
        return {
          content: [{type: 'text', text: ANSI_RESULT}],
          details: {
            mode: 'ansi',
            marker: 'ansi-details-preserved',
            order: 'text',
          },
        };
      return {
        content: [
          {type: 'text', text: MIXED_BEFORE},
          {type: 'image', data: MIXED_IMAGE_DATA, mimeType: 'image/png'},
          {type: 'text', text: MIXED_AFTER},
        ],
        details: MIXED_DETAILS,
        usage: RESULT_USAGE,
      };
    },
  });
}
