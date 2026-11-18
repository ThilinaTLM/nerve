import type { ExtensionPanel } from "$lib/features/extension-ui";
import {
  extensionIcon,
  extensionPanelViewId,
} from "$lib/features/extension-ui";
import type { PanelViewDescriptor } from "$lib/presentation/shell";

/** Dock descriptors for the panels the project's extensions contribute. */
export function extensionPanelDescriptors(
  panels: readonly ExtensionPanel[],
): PanelViewDescriptor[] {
  return panels.map((panel, index) => ({
    id: extensionPanelViewId(panel.extensionId, panel.id),
    title: panel.label,
    icon: extensionIcon(panel.icon),
    defaultDock: "right",
    defaultOrder: 100 + index,
  }));
}
