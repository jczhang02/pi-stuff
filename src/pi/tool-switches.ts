import type {
  ExtensionAPI,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import {Schema} from 'effect';
import type {TSchema} from 'typebox';

export const ToolSwitches = Schema.Record(Schema.String, Schema.Boolean);
export type ToolSwitches = typeof ToolSwitches.Type;

// Unregistered tools cannot be re-enabled by Pi's selection. Do not call
// setActiveTools: registration leaves the host's own selection policy intact.
export function registerTool<P extends TSchema, D>(
  host: Pick<ExtensionAPI, 'registerTool'>,
  switches: ToolSwitches | undefined,
  tool: ToolDefinition<P, D>,
): void {
  if (switches?.[tool.name] !== false) host.registerTool(tool);
}
