import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';

// A result hook may add metadata that the presentation does not understand.
export default function (pi: ExtensionAPI) {
  pi.on('tool_result', () => ({
    details: {patch: 7, truncation: {truncated: 'unknown'}},
  }));
}
