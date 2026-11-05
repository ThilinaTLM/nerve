import type { FilesystemProjectEntry } from "@nervekit/contracts/filesystem";
import type {
  ContextMenuItem,
  MenuIcon,
} from "@nervekit/ui-kit/components/composites/context-menu-list";

export type FileExplorerMenuIcons = {
  open: MenuIcon;
  copy: MenuIcon;
  openDefault: MenuIcon;
  newFile: MenuIcon;
  reveal: MenuIcon;
  newFolder: MenuIcon;
  trash: MenuIcon;
  rename: MenuIcon;
  duplicate: MenuIcon;
  cut: MenuIcon;
  paste: MenuIcon;
  mention: MenuIcon;
};

/** Platform-aware shortcut labels, e.g. `Ctrl+C` or `⌘C`. */
export type FileExplorerShortcutLabels = {
  rename: string;
  duplicate: string;
  cut: string;
  copy: string;
  paste: string;
  delete: string;
};

export type ProjectRootMenuActions = {
  createFile: () => void;
  createFolder: () => void;
  paste: () => void;
  canPaste: boolean;
  openDefault: () => void;
  reveal: () => void;
  copyPath: () => void;
};

export type FileExplorerMenuActions = {
  open: () => void;
  createFile: () => void;
  createFolder: () => void;
  rename: () => void;
  duplicate: () => void;
  cut: () => void;
  copy: () => void;
  paste: () => void;
  canPaste: boolean;
  mention: () => void;
  openDefault: () => void;
  reveal: () => void;
  copyPath: () => void;
  copyRelativePath: () => void;
  /** Trash on desktop, permanent delete elsewhere. */
  remove: () => void;
};

export type FileExplorerSelectionMenuActions = {
  count: number;
  cut: () => void;
  copy: () => void;
  mention: () => void;
  copyPaths: () => void;
  remove: () => void;
};

export function absoluteProjectPath(
  root: string,
  relativePath: string,
  platform?: string,
): string {
  const separator = platform === "win32" ? "\\" : "/";
  const normalizedRelative = relativePath
    .replaceAll("\\", "/")
    .split("/")
    .join(separator);
  const trimmedRoot = root.trim().replace(/[\\/]+$/, "");
  const base = trimmedRoot || separator;
  return base.endsWith(separator)
    ? `${base}${normalizedRelative}`
    : `${base}${separator}${normalizedRelative}`;
}

export function buildProjectRootMenu(
  actions: ProjectRootMenuActions,
  nativeActions: boolean,
  icons: FileExplorerMenuIcons,
  launchItems: ContextMenuItem[] = [],
  shortcuts?: FileExplorerShortcutLabels,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    {
      label: "New file",
      icon: icons.newFile,
      movesFocus: true,
      onSelect: actions.createFile,
    },
    {
      label: "New folder",
      icon: icons.newFolder,
      movesFocus: true,
      onSelect: actions.createFolder,
    },
  ];
  if (actions.canPaste)
    items.push({
      label: "Paste",
      icon: icons.paste,
      shortcut: shortcuts?.paste,
      onSelect: actions.paste,
    });
  if (launchItems.length > 0) {
    items.push({ type: "separator" }, ...launchItems);
  }
  if (nativeActions) {
    items.push(
      { type: "separator" },
      {
        label: "Open with default app",
        icon: icons.openDefault,
        onSelect: actions.openDefault,
      },
      {
        label: "Show in file manager",
        icon: icons.reveal,
        onSelect: actions.reveal,
      },
    );
  }
  items.push(
    { type: "separator" },
    { label: "Copy path", icon: icons.copy, onSelect: actions.copyPath },
  );
  return items;
}

export function buildFileExplorerMenu(
  entry: FilesystemProjectEntry,
  actions: FileExplorerMenuActions,
  nativeActions: boolean,
  icons: FileExplorerMenuIcons,
  launchItems: ContextMenuItem[] = [],
  shortcuts?: FileExplorerShortcutLabels,
): ContextMenuItem[] {
  const directory = entry.kind === "directory" && !entry.symlink;
  const items: ContextMenuItem[] = [
    {
      label: "Open",
      icon: icons.open,
      disabled: entry.kind === "directory" && entry.symlink,
      onSelect: actions.open,
    },
  ];
  if (directory) {
    items.push(
      { type: "separator" },
      {
        label: "New file",
        icon: icons.newFile,
        movesFocus: true,
        onSelect: actions.createFile,
      },
      {
        label: "New folder",
        icon: icons.newFolder,
        movesFocus: true,
        onSelect: actions.createFolder,
      },
    );
  }
  items.push(
    { type: "separator" },
    {
      label: "Rename",
      icon: icons.rename,
      shortcut: shortcuts?.rename,
      movesFocus: true,
      onSelect: actions.rename,
    },
    {
      label: "Duplicate",
      icon: icons.duplicate,
      shortcut: shortcuts?.duplicate,
      onSelect: actions.duplicate,
    },
    {
      label: "Cut",
      icon: icons.cut,
      shortcut: shortcuts?.cut,
      onSelect: actions.cut,
    },
    {
      label: "Copy",
      icon: icons.copy,
      shortcut: shortcuts?.copy,
      onSelect: actions.copy,
    },
  );
  if (directory && actions.canPaste)
    items.push({
      label: "Paste",
      icon: icons.paste,
      shortcut: shortcuts?.paste,
      onSelect: actions.paste,
    });
  items.push(
    { type: "separator" },
    {
      label: "Mention in conversation",
      icon: icons.mention,
      onSelect: actions.mention,
    },
  );
  if (launchItems.length > 0) {
    items.push({ type: "separator" }, ...launchItems);
  }
  if (nativeActions) {
    items.push(
      { type: "separator" },
      {
        label: "Open with default app",
        icon: icons.openDefault,
        onSelect: actions.openDefault,
      },
      {
        label: "Show in file manager",
        icon: icons.reveal,
        onSelect: actions.reveal,
      },
    );
  }
  items.push(
    { type: "separator" },
    { label: "Copy path", icon: icons.copy, onSelect: actions.copyPath },
    {
      label: "Copy relative path",
      icon: icons.copy,
      onSelect: actions.copyRelativePath,
    },
    { type: "separator" },
    {
      label: nativeActions ? "Move to trash" : "Delete",
      icon: icons.trash,
      shortcut: shortcuts?.delete,
      destructive: true,
      onSelect: actions.remove,
    },
  );
  return items;
}

/** Menu for a right-click inside a multi-item selection. */
export function buildFileExplorerSelectionMenu(
  actions: FileExplorerSelectionMenuActions,
  nativeActions: boolean,
  icons: FileExplorerMenuIcons,
  shortcuts?: FileExplorerShortcutLabels,
): ContextMenuItem[] {
  return [
    { type: "label", label: `${actions.count} items selected` },
    {
      label: "Cut",
      icon: icons.cut,
      shortcut: shortcuts?.cut,
      onSelect: actions.cut,
    },
    {
      label: "Copy",
      icon: icons.copy,
      shortcut: shortcuts?.copy,
      onSelect: actions.copy,
    },
    { type: "separator" },
    {
      label: "Mention in conversation",
      icon: icons.mention,
      onSelect: actions.mention,
    },
    { label: "Copy paths", icon: icons.copy, onSelect: actions.copyPaths },
    { type: "separator" },
    {
      label: nativeActions ? "Move to trash" : "Delete",
      icon: icons.trash,
      shortcut: shortcuts?.delete,
      destructive: true,
      onSelect: actions.remove,
    },
  ];
}
