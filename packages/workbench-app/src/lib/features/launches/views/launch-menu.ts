import ArrowDown from "@lucide/svelte/icons/arrow-down";
import ArrowUp from "@lucide/svelte/icons/arrow-up";
import Copy from "@lucide/svelte/icons/copy";
import Folder from "@lucide/svelte/icons/folder";
import FolderInput from "@lucide/svelte/icons/folder-input";
import Pencil from "@lucide/svelte/icons/pencil";
import Play from "@lucide/svelte/icons/play";
import RotateCw from "@lucide/svelte/icons/rotate-cw";
import Skull from "@lucide/svelte/icons/skull";
import Square from "@lucide/svelte/icons/square";
import Terminal from "@lucide/svelte/icons/terminal";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import { launchDefinitionLabel } from "./launch-panel-controller.js";
import type {
  LaunchDefinitionEntry,
  LaunchEntryCapabilities,
} from "./launch-panel-types.js";

/** What a launch row shows and offers, derived from its entry. */
export function launchEntryView(entry: LaunchDefinitionEntry) {
  const latest = entry.latestRun;
  const { command, cwd, port } = entry.definition;
  const concurrent = entry.definition.runPolicy === "concurrent";
  const activeRun = entry.activeRuns[0];
  return {
    latest,
    status: latest?.status ?? ("saved" as const),
    label: launchDefinitionLabel(entry),
    command,
    cwd,
    activeRun,
    canStart: concurrent || entry.activeRuns.length === 0,
    runLabel: concurrent && activeRun ? "Start another run" : "Run launch",
    cleanableRuns: entry.runs.filter(
      (run) => run.isRemovable && run.run.id !== latest?.id,
    ),
    tooltip: [command, cwd, port ? `TCP port ${port}` : undefined]
      .filter(Boolean)
      .join("\n"),
  };
}

export interface LaunchEntryHandlers {
  onOpen: (launchId: string) => void;
  onRun: (entry: LaunchDefinitionEntry) => void;
  onCancel: (launchId: string) => void;
  onForceKill: (launchId: string) => void;
  onRestart: (launchId: string) => void;
  onEdit: (entry: LaunchDefinitionEntry) => void;
  onDuplicate: (entry: LaunchDefinitionEntry) => void;
  onDelete: (entries: readonly LaunchDefinitionEntry[]) => void;
  onCleanupRuns: (launchIds: readonly string[]) => void;
  onCopy: (text: string) => void;
}

/** Context menu of one launch (without the move items). */
export function launchDefinitionMenuItems(
  entry: LaunchDefinitionEntry,
  capabilities: LaunchEntryCapabilities,
  handlers: LaunchEntryHandlers,
): ContextMenuItem[] {
  const { latest, command, cwd, activeRun, canStart, runLabel, cleanableRuns } =
    launchEntryView(entry);
  const items: ContextMenuItem[] = [];
  if (latest)
    items.push({
      label: "Open logs",
      icon: Terminal,
      disabled: !capabilities.logs,
      onSelect: () => handlers.onOpen(latest.id),
    });
  if (cleanableRuns.length > 0)
    items.push({
      label: "Clean up runs",
      icon: Trash2,
      destructive: true,
      disabled: !capabilities.remove,
      onSelect: () =>
        handlers.onCleanupRuns(cleanableRuns.map((run) => run.run.id)),
    });
  if (canStart)
    items.push({
      label: runLabel,
      icon: Play,
      disabled: !capabilities.start,
      onSelect: () => handlers.onRun(entry),
    });
  if (activeRun) {
    items.push({
      label: "Restart",
      icon: RotateCw,
      disabled: !capabilities.restart,
      onSelect: () => handlers.onRestart(activeRun.id),
    });
    if (activeRun.status !== "stopping")
      items.push({
        label: "Stop",
        icon: Square,
        disabled: !capabilities.cancel,
        onSelect: () => handlers.onCancel(activeRun.id),
      });
    else
      items.push({
        label: "Force kill",
        icon: Skull,
        destructive: true,
        disabled: !capabilities.cancel,
        onSelect: () => handlers.onForceKill(activeRun.id),
      });
  }

  if (items.length > 0) items.push({ type: "separator" });
  items.push(
    {
      label: "Edit launch",
      icon: Pencil,
      disabled: !capabilities.manageDefinitions,
      onSelect: () => handlers.onEdit(entry),
    },
    {
      label: "Duplicate launch",
      icon: Copy,
      disabled: !capabilities.manageDefinitions,
      onSelect: () => handlers.onDuplicate(entry),
    },
    {
      label: "Delete launch",
      icon: Trash2,
      destructive: true,
      disabled: !capabilities.manageDefinitions,
      onSelect: () => handlers.onDelete([entry]),
    },
  );

  const trailing: ContextMenuItem[] = [];
  if (command)
    trailing.push({
      label: "Copy command",
      icon: Copy,
      disabled: !capabilities.copy,
      onSelect: () => handlers.onCopy(command),
    });
  if (cwd)
    trailing.push({
      label: "Copy working directory",
      icon: Folder,
      disabled: !capabilities.copy,
      onSelect: () => handlers.onCopy(cwd),
    });
  if (trailing.length > 0) items.push({ type: "separator" }, ...trailing);
  return items;
}

/** Menu for several selected launches; folders in the selection only move. */
export function launchBulkMenuItems(
  entries: readonly LaunchDefinitionEntry[],
  capabilities: LaunchEntryCapabilities,
  handlers: LaunchEntryHandlers,
): ContextMenuItem[] {
  const views = entries.map((entry) => ({ entry, ...launchEntryView(entry) }));
  const startable = views.filter((view) => view.canStart);
  const running = views.filter(
    (view) => view.activeRun && view.activeRun.status !== "stopping",
  );
  const noun = (count: number) => `${count} launch${count === 1 ? "" : "es"}`;
  const items: ContextMenuItem[] = [];
  if (startable.length > 0)
    items.push({
      label: `Run ${noun(startable.length)}`,
      icon: Play,
      disabled: !capabilities.start,
      onSelect: () => startable.forEach((view) => handlers.onRun(view.entry)),
    });
  if (running.length > 0) {
    items.push(
      {
        label: `Restart ${noun(running.length)}`,
        icon: RotateCw,
        disabled: !capabilities.restart,
        onSelect: () =>
          running.forEach((view) => handlers.onRestart(view.activeRun!.id)),
      },
      {
        label: `Stop ${noun(running.length)}`,
        icon: Square,
        disabled: !capabilities.cancel,
        onSelect: () =>
          running.forEach((view) => handlers.onCancel(view.activeRun!.id)),
      },
    );
  }
  if (entries.length > 0) {
    if (items.length > 0) items.push({ type: "separator" });
    items.push({
      label: `Delete ${noun(entries.length)}`,
      icon: Trash2,
      destructive: true,
      disabled: !capabilities.manageDefinitions,
      onSelect: () => handlers.onDelete(entries),
    });
  }
  return items;
}

export interface LaunchMoveMenuOptions {
  readonly disabled: boolean;
  readonly folders: readonly { id: string; label: string }[];
  /** Folder the entries already sit in everywhere, when they share one. */
  readonly currentFolderId?: string | null;
  readonly onMoveToFolder: (folderId: string | null) => void;
  readonly onStep?: { up?: () => void; down?: () => void };
}

/** "Move to" submenu, plus optional one-slot moves. */
export function launchMoveMenuItems(
  options: LaunchMoveMenuOptions,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    {
      type: "submenu",
      label: "Move to",
      icon: FolderInput,
      disabled: options.disabled,
      items: [
        {
          type: "item",
          label: "Top level",
          disabled: options.disabled || options.currentFolderId === null,
          onSelect: () => options.onMoveToFolder(null),
        },
        ...options.folders.map((folder) => ({
          type: "item" as const,
          label: folder.label,
          disabled: options.disabled || options.currentFolderId === folder.id,
          onSelect: () => options.onMoveToFolder(folder.id),
        })),
      ],
    },
  ];
  if (options.onStep) {
    items.push(
      {
        label: "Move up",
        icon: ArrowUp,
        shortcut: "Alt+↑",
        disabled: options.disabled || !options.onStep.up,
        onSelect: () => options.onStep?.up?.(),
      },
      {
        label: "Move down",
        icon: ArrowDown,
        shortcut: "Alt+↓",
        disabled: options.disabled || !options.onStep.down,
        onSelect: () => options.onStep?.down?.(),
      },
    );
  }
  return items;
}
