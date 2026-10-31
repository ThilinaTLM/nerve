import type { FilesystemSignal } from "$lib/api";
import { pathKey } from "$lib/domain/filesystem/project-path";

/** A dropped path after the daemon has classified it. */
export type DroppedItem = {
  path: string;
  kind: "folder" | "file";
  signals?: FilesystemSignal[];
  /** For files: the folder that contains it, as validated on the daemon. */
  containingFolder?: { path: string; signals?: FilesystemSignal[] };
};

export type DropProject = { id: string; name: string; directory: string };

export type DropRow = {
  path: string;
  name: string;
  kind: "folder" | "file";
  signals: FilesystemSignal[];
  /** Set when the folder is already a project. */
  projectId?: string;
  /** Only folders can be opened. */
  selectable: boolean;
};

export type DropVariant = "folder" | "project" | "file" | "several" | "none";

export type DropPlan = {
  variant: DropVariant;
  title: string;
  description: string;
  rows: DropRow[];
  /** Index into `rows` preselected for opening, or -1 when nothing can open. */
  defaultPick: number;
};

/** Last path segment, tolerant of both separators and trailing separators. */
export function dropBaseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const name = trimmed.split(/[\\/]/).pop();
  return name || path;
}

/** Parent directory of `path` using whichever separator the path uses. */
export function dropParentPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (index < 0) return path;
  if (index === 0) return trimmed.slice(0, 1);
  const parent = trimmed.slice(0, index);
  // `C:` -> `C:\`
  return /^[A-Za-z]:$/.test(parent) ? `${parent}${trimmed[index]}` : parent;
}

function folderRow(
  path: string,
  signals: FilesystemSignal[] | undefined,
  projects: readonly DropProject[],
  caseInsensitive: boolean,
): DropRow {
  const key = pathKey(path, caseInsensitive);
  const project = projects.find(
    (p) => pathKey(p.directory, caseInsensitive) === key,
  );
  return {
    path,
    name: project?.name ?? dropBaseName(path),
    kind: "folder",
    signals: [...new Set(signals ?? [])],
    projectId: project?.id,
    selectable: true,
  };
}

/** Turn classified dropped items into the confirmation dialog's case model. */
export function buildDropPlan(
  items: readonly DroppedItem[],
  projects: readonly DropProject[],
  caseInsensitive = false,
): DropPlan {
  if (items.length === 1) {
    const [item] = items;
    if (item.kind === "folder") {
      const row = folderRow(item.path, item.signals, projects, caseInsensitive);
      return row.projectId
        ? {
            variant: "project",
            title: `Switch to ${row.name}?`,
            description: "This folder is already one of your projects.",
            rows: [row],
            defaultPick: 0,
          }
        : {
            variant: "folder",
            title: "Open dropped folder?",
            description: "It will be added to your projects.",
            rows: [row],
            defaultPick: 0,
          };
    }
    if (item.containingFolder) {
      const row = folderRow(
        item.containingFolder.path,
        item.containingFolder.signals,
        projects,
        caseInsensitive,
      );
      return {
        variant: "file",
        title: "Open the containing folder?",
        description: `You dropped ${dropBaseName(item.path)}. Nerve opens folders, not files.`,
        rows: [row],
        defaultPick: 0,
      };
    }
  }

  const rows: DropRow[] = items.map((item) =>
    item.kind === "folder"
      ? folderRow(item.path, item.signals, projects, caseInsensitive)
      : {
          path: item.path,
          name: dropBaseName(item.path),
          kind: "file",
          signals: [],
          selectable: false,
        },
  );
  const defaultPick = rows.findIndex((row) => row.selectable);
  if (defaultPick < 0) {
    return {
      variant: "none",
      title: "Nothing to open",
      description: "None of the dropped items are folders.",
      rows,
      defaultPick: -1,
    };
  }
  return {
    variant: "several",
    title: "Open one of the dropped folders",
    description: "Pick the folder to open as a project.",
    rows,
    defaultPick,
  };
}

/** Primary action label for the picked row. */
export function dropActionLabel(row: DropRow | undefined): string {
  return row?.projectId ? "Switch to project" : "Open project";
}
