import AtSign from "@lucide/svelte/icons/at-sign";
import ClipboardPaste from "@lucide/svelte/icons/clipboard-paste";
import Copy from "@lucide/svelte/icons/copy";
import CopyPlus from "@lucide/svelte/icons/copy-plus";
import ExternalLink from "@lucide/svelte/icons/external-link";
import FilePlus from "@lucide/svelte/icons/file-plus";
import FileText from "@lucide/svelte/icons/file-text";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import FolderPlus from "@lucide/svelte/icons/folder-plus";
import Locate from "@lucide/svelte/icons/locate";
import Pencil from "@lucide/svelte/icons/pencil";
import Scissors from "@lucide/svelte/icons/scissors";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { Project } from "@nervekit/contracts/core";
import type { FilesystemProjectEntry } from "@nervekit/contracts/filesystem";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import type { ProjectEditor, StatusResponse } from "$lib/api";
import { buildExternalLaunchMenu } from "$lib/presentation/brand/external-launch-menu";
import type { FileExplorerTreeItem } from "./file-explorer-tree";
import {
  absoluteProjectPath,
  buildFileExplorerMenu,
  buildFileExplorerSelectionMenu,
  buildProjectRootMenu,
  type FileExplorerMenuIcons,
  type FileExplorerShortcutLabels,
} from "../views/file-explorer-menu";

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);

const shortcuts: FileExplorerShortcutLabels = {
  rename: "F2",
  duplicate: isMac ? "⌘D" : "Ctrl+D",
  cut: isMac ? "⌘X" : "Ctrl+X",
  copy: isMac ? "⌘C" : "Ctrl+C",
  paste: isMac ? "⌘V" : "Ctrl+V",
  delete: isMac ? "⌘⌫" : "Del",
};

const menuIcons: FileExplorerMenuIcons = {
  open: FileText,
  copy: Copy,
  openDefault: ExternalLink,
  newFile: FilePlus,
  reveal: Locate,
  newFolder: FolderPlus,
  trash: Trash2,
  rename: Pencil,
  duplicate: CopyPlus,
  cut: Scissors,
  paste: ClipboardPaste,
  mention: AtSign,
};

/** What the context menus need from the panel: data to read and actions to call. */
export type FilesContextMenuContext = {
  project: Project | undefined;
  isDesktop: boolean;
  platform: Parameters<typeof absoluteProjectPath>[2];
  canPaste: boolean;
  selectionIds: ReadonlySet<string>;
  editors?: StatusResponse["runtime"]["editors"];
  terminal?: StatusResponse["runtime"]["terminal"];
  onOpenInEditor?: (
    projectId: string,
    editor: ProjectEditor,
    path?: string,
  ) => void;
  onOpenInTerminal?: (projectId: string, path?: string) => void;
  /** The entries an action on `entry` applies to. */
  actionTargets(entry: FilesystemProjectEntry): FilesystemProjectEntry[];
  pasteTargetFor(entry: FilesystemProjectEntry): string;
  openFromMenu(item: FileExplorerTreeItem & { type: "entry" }): void;
  requestCreate(
    kind: "file" | "directory",
    parent: FilesystemProjectEntry,
  ): void;
  requestRename(entry: FilesystemProjectEntry): void;
  requestDelete(entries: FilesystemProjectEntry[]): void;
  duplicate(entries: FilesystemProjectEntry[]): Promise<void>;
  setClipboard(mode: "cut" | "copy", entries: FilesystemProjectEntry[]): void;
  pasteInto(targetDirectory: string): Promise<void>;
  mention(entries: FilesystemProjectEntry[]): void;
  copyText(text: string, label: string): Promise<void>;
  openNative(entry: FilesystemProjectEntry): void;
  revealNative(entry: FilesystemProjectEntry): void;
};

function launchMenu(
  context: FilesContextMenuContext,
  entry?: FilesystemProjectEntry,
): ContextMenuItem[] {
  const project = context.project;
  if (!project || (entry && entry.kind === "other")) return [];
  const path = entry?.path;
  return buildExternalLaunchMenu({
    targetKind: entry?.kind === "file" ? "file" : "directory",
    editors: context.editors,
    terminal: context.terminal,
    openEditor: (editor) => context.onOpenInEditor?.(project.id, editor, path),
    openTerminal: () => context.onOpenInTerminal?.(project.id, path),
  });
}

export function buildFilesRootMenu(
  context: FilesContextMenuContext,
  entry: FilesystemProjectEntry | undefined,
): ContextMenuItem[] {
  const project = context.project;
  if (!project || !entry) return [];
  return buildProjectRootMenu(
    {
      createFile: () => context.requestCreate("file", entry),
      createFolder: () => context.requestCreate("directory", entry),
      paste: () => void context.pasteInto(""),
      canPaste: context.canPaste,
      openDefault: () => context.openNative(entry),
      reveal: () => context.revealNative(entry),
      copyPath: () => void context.copyText(project.directory, "path"),
    },
    context.isDesktop,
    menuIcons,
    launchMenu(context),
    shortcuts,
  );
}

export function buildFilesItemMenu(
  context: FilesContextMenuContext,
  item: FileExplorerTreeItem,
): ContextMenuItem[] {
  const project = context.project;
  if (item.type !== "entry" || !project) return [];
  const entry = item.entry;
  if (context.selectionIds.has(entry.path) && context.selectionIds.size > 1) {
    const targets = context.actionTargets(entry);
    return buildFileExplorerSelectionMenu(
      {
        count: targets.length,
        cut: () => context.setClipboard("cut", targets),
        copy: () => context.setClipboard("copy", targets),
        mention: () => context.mention(targets),
        copyPaths: () =>
          void context.copyText(
            targets.map((target) => target.path).join("\n"),
            "paths",
          ),
        remove: () => context.requestDelete(targets),
      },
      context.isDesktop,
      menuIcons,
      shortcuts,
    );
  }
  const absolutePath = absoluteProjectPath(
    project.directory,
    entry.path,
    context.platform,
  );
  return buildFileExplorerMenu(
    entry,
    {
      open: () => context.openFromMenu(item),
      createFile: () => context.requestCreate("file", entry),
      createFolder: () => context.requestCreate("directory", entry),
      rename: () => context.requestRename(entry),
      duplicate: () => void context.duplicate([entry]),
      cut: () => context.setClipboard("cut", [entry]),
      copy: () => context.setClipboard("copy", [entry]),
      paste: () => void context.pasteInto(context.pasteTargetFor(entry)),
      canPaste: context.canPaste,
      mention: () => context.mention([entry]),
      openDefault: () => context.openNative(entry),
      reveal: () => context.revealNative(entry),
      copyPath: () => void context.copyText(absolutePath, "path"),
      copyRelativePath: () =>
        void context.copyText(entry.path, "relative path"),
      remove: () => context.requestDelete([entry]),
    },
    context.isDesktop,
    {
      ...menuIcons,
      open: entry.kind === "directory" ? FolderOpen : FileText,
    },
    launchMenu(context, entry),
    shortcuts,
  );
}
