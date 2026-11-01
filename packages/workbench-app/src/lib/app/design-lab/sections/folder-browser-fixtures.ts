import type {
  FilesystemDirectoryResponse,
  FilesystemLocations,
  FilesystemSignal,
} from "@nervekit/contracts/filesystem";
import {
  FolderBrowser,
  type FolderBrowserSource,
} from "$lib/features/projects/state/folder-browser.svelte";

type Entry = FilesystemDirectoryResponse["entries"][number];

const HOME = "/home/alex";
export const FOLDER_BROWSER_START = `${HOME}/Projects`;

const locations: FilesystemLocations = {
  platform: "linux",
  separator: "/",
  home: HOME,
  caseInsensitive: false,
  places: [
    { id: "home", label: "Home", path: HOME },
    { id: "desktop", label: "Desktop", path: `${HOME}/Desktop` },
    { id: "documents", label: "Documents", path: `${HOME}/Documents` },
    { id: "projects", label: "Projects", path: FOLDER_BROWSER_START },
  ],
  locations: [{ kind: "root", label: "File System", path: "/" }],
};

function entry(
  parent: string,
  name: string,
  signals: FilesystemSignal[] = [],
): Entry {
  return {
    name,
    path: `${parent}/${name}`,
    kind: "directory",
    hidden: name.startsWith("."),
    signals,
  };
}

function homeEntries(): Entry[] {
  return [
    entry(HOME, ".cache"),
    entry(HOME, ".config"),
    entry(HOME, "Desktop"),
    entry(HOME, "Documents"),
    entry(HOME, "Downloads"),
    entry(HOME, "Music"),
    entry(HOME, "Pictures"),
    entry(HOME, "Projects"),
  ];
}

function projectEntries(): Entry[] {
  const dir = FOLDER_BROWSER_START;
  return [
    entry(dir, ".archive"),
    entry(dir, ".templates"),
    entry(dir, "api-gateway", ["git", "go"]),
    entry(dir, "blog", ["git", "package"]),
    entry(dir, "data-pipeline", ["git", "python"]),
    entry(dir, "design-tokens", ["package"]),
    entry(dir, "dotfiles", ["git"]),
    entry(dir, "monorepo", ["git", "package", "workspace"]),
    entry(dir, "notes"),
    entry(dir, "rust-cli", ["git", "rust"]),
  ];
}

/** Directories a project is already open for in the specimen. */
export const FOLDER_BROWSER_PROJECT_DIRECTORIES = [
  `${FOLDER_BROWSER_START}/monorepo`,
];

export function folderBrowserProjectIdForPath(
  path: string,
): string | undefined {
  return FOLDER_BROWSER_PROJECT_DIRECTORIES.includes(path)
    ? "proj_monorepo"
    : undefined;
}

function sortByName(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => a.name.localeCompare(b.name));
}

/** In-memory filesystem: create() adds the folder to the listing. */
function mockSource(): FolderBrowserSource {
  const folders = new Map<string, Entry[]>([
    [HOME, homeEntries()],
    [FOLDER_BROWSER_START, projectEntries()],
  ]);
  return {
    locations: async () => locations,
    list: async (path, showHidden) => {
      const target = path ?? HOME;
      const entries = folders.get(target) ?? [];
      return {
        path: target,
        parent:
          target === "/" ? undefined : target.replace(/\/[^/]+$/, "") || "/",
        signals: [],
        entries: sortByName(entries).filter(
          (item) => showHidden || !item.hidden,
        ),
      };
    },
    create: async (parent, name) => {
      const created = entry(parent, name);
      folders.set(parent, [...(folders.get(parent) ?? []), created]);
      return { path: created.path };
    },
  };
}

export function createMockFolderBrowser(): FolderBrowser {
  return new FolderBrowser(mockSource());
}

/** A browser whose listings always fail, to show the error state. */
export function createFailingFolderBrowser(): FolderBrowser {
  return new FolderBrowser({
    locations: async () => locations,
    list: async () => {
      throw new Error("Permission denied");
    },
    create: async () => {
      throw new Error("Permission denied");
    },
  });
}
