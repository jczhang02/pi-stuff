import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import type {Coordinator} from '../coordinator';
import type {SubagentSettings} from '../settings';
import {SubagentUIController} from './controller';

export interface SubagentUIHandle {
  dispose(): void;
  open(surface: 'fleet' | 'overview'): void;
}

export function installSubagentUI(
  pi: ExtensionAPI,
  context: ExtensionContext,
  coordinator: Coordinator,
  settings: SubagentSettings,
): SubagentUIHandle {
  void pi;
  const controller = new SubagentUIController(context, coordinator, settings);
  const unsubscribe = coordinator.subscribe(() =>
    controller.onSnapshotChanged(),
  );

  if (context.mode === 'tui') {
    context.ui.setEditorComponent((tui, theme, keybindings) =>
      controller.createEditor(tui, theme, keybindings),
    );
    context.ui.setFooter((tui, theme, footerData) =>
      controller.createFooter(tui, theme, footerData),
    );
  }

  return {
    dispose(): void {
      unsubscribe();
      controller.dispose();
      if (context.mode === 'tui') context.ui.setEditorComponent(undefined);
    },
    open(surface: 'fleet' | 'overview'): void {
      controller.open(surface);
    },
  };
}

export {SubagentUIController} from './controller';
export {FleetFooter} from './footer';
export {SubagentEditor} from './editor';
