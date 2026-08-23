import type { FilesystemProjectEntry } from "@nervekit/contracts";
import type {
  ContextMenuItem,
  MenuIcon,
} from "@nervekit/ui-kit/components/ui/context-menu-list";

export type FileExplorerMenuIcons = {
  open: MenuIcon;
  copy: MenuIcon;
  openDefault: MenuIcon;
  newFile: MenuIcon;
  reveal: MenuIcon;
  newFolder: MenuIcon;
  trash: MenuIcon;
};

export type ProjectRootMenuActions = {
  createFile: () => void;
  createFolder: () => void;
  openDefault: () => void;
  reveal: () => void;
  copyPath: () => void;
};

export type FileExplorerMenuActions = {
  open: () => void;
  createFile: () => void;
  createFolder: () => void;
  openDefault: () => void;
  reveal: () => void;
  copyPath: () => void;
  copyRelativePath: () => void;
  trash: () => void;
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
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    { label: "New file", icon: icons.newFile, onSelect: actions.createFile },
    {
      label: "New folder",
      icon: icons.newFolder,
      onSelect: actions.createFolder,
    },
  ];
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
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    {
      label: "Open",
      icon: icons.open,
      disabled: entry.kind === "directory" && entry.symlink,
      onSelect: actions.open,
    },
  ];
  if (entry.kind === "directory" && !entry.symlink) {
    items.push(
      { type: "separator" },
      { label: "New file", icon: icons.newFile, onSelect: actions.createFile },
      {
        label: "New folder",
        icon: icons.newFolder,
        onSelect: actions.createFolder,
      },
    );
  }
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
  );
  if (nativeActions) {
    items.push(
      { type: "separator" },
      {
        label: "Move to trash",
        icon: icons.trash,
        destructive: true,
        onSelect: actions.trash,
      },
    );
  }
  return items;
}
