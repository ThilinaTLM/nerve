import SquareTerminal from "@lucide/svelte/icons/square-terminal";
import type {
  ExternalEditorStatuses,
  ExternalTerminalStatus,
} from "@nervekit/contracts/status";
import type { ProjectEditor } from "@nervekit/contracts/projects";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import VsCodeIcon from "./VsCodeIcon.svelte";
import ZedIcon from "./ZedIcon.svelte";

export type ExternalLaunchMenuOptions = {
  targetKind: "file" | "directory";
  editors?: ExternalEditorStatuses;
  terminal?: ExternalTerminalStatus;
  openEditor: (editor: ProjectEditor) => void;
  openTerminal?: () => void;
};

export function buildExternalLaunchMenu(
  options: ExternalLaunchMenuOptions,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  if (options.editors?.vscode.available) {
    items.push({
      label: "Open in VS Code",
      icon: VsCodeIcon,
      onSelect: () => options.openEditor("vscode"),
    });
  }
  if (options.editors?.zed.available) {
    items.push({
      label: "Open in Zed",
      icon: ZedIcon,
      onSelect: () => options.openEditor("zed"),
    });
  }
  if (
    options.targetKind === "directory" &&
    options.terminal?.available &&
    options.openTerminal
  ) {
    items.push({
      label: "Open in Terminal",
      icon: SquareTerminal,
      onSelect: options.openTerminal,
    });
  }
  return items;
}
