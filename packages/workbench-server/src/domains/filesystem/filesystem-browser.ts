import { readdir, realpath, stat, mkdir } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { posix, win32 } from "node:path";
import type {
  FilesystemLocation,
  FilesystemLocations,
  FilesystemPlace,
} from "@nervekit/contracts/filesystem";
import { ApplicationError } from "../../core/application-error.js";

const nativePaths = (platform: string) =>
  platform === "win32" ? win32 : posix;

/** Cheap fallback: Node stat does not expose Windows FILE_ATTRIBUTE_HIDDEN or
 * macOS UF_HIDDEN. Until the native addon exposes metadata, recognize dot names,
 * the standard hidden home directories, and Windows' hidden root directories.
 * Custom hidden attributes/flags are not detected; no subprocess per entry.
 */
export function isHiddenDirectory(
  path: string,
  platform: string = process.platform,
  home = homedir(),
): boolean {
  const paths = nativePaths(platform);
  const name = paths.basename(path);
  if (name.startsWith(".")) return true;
  if (platform === "darwin") return path === paths.join(home, "Library");
  if (platform !== "win32") return false;
  const normalized = paths.normalize(path).toLowerCase();
  if (normalized === paths.join(home, "AppData").toLowerCase()) return true;
  return (
    paths.dirname(normalized) === paths.parse(normalized).root &&
    ["$recycle.bin", "system volume information", "recovery"].includes(
      name.toLowerCase(),
    )
  );
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function directoryNames(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

type LocationsEnvironment = {
  platform?: string;
  home?: string;
  username?: string;
  isDirectory?: (path: string) => Promise<boolean>;
  directoryNames?: (path: string) => Promise<string[]>;
  realpath?: (path: string) => Promise<string>;
};

export async function getFilesystemLocations(
  environment: LocationsEnvironment = {},
): Promise<FilesystemLocations> {
  const platform = environment.platform ?? process.platform;
  const paths = nativePaths(platform);
  const home = environment.home ?? homedir();
  const exists = environment.isDirectory ?? isDirectory;
  const names = environment.directoryNames ?? directoryNames;
  const canonical = environment.realpath ?? realpath;
  const places: FilesystemPlace[] = [];
  const candidates: FilesystemPlace[] = [
    { id: "home", label: "Home", path: home },
    { id: "desktop", label: "Desktop", path: paths.join(home, "Desktop") },
    {
      id: "documents",
      label: "Documents",
      path: paths.join(home, "Documents"),
    },
    {
      id: "downloads",
      label: "Downloads",
      path: paths.join(home, "Downloads"),
    },
  ];
  for (const candidate of candidates) {
    if (await exists(candidate.path)) places.push(candidate);
  }
  for (const name of ["Projects", "projects", "code", "src", "dev"]) {
    const path = paths.join(home, name);
    if (await exists(path)) {
      places.push({ id: "projects", label: "Projects", path });
      break;
    }
  }

  const locations: FilesystemLocation[] = [];
  if (platform === "win32") {
    const drives = await Promise.all(
      Array.from({ length: 26 }, async (_, index) => {
        const label = `${String.fromCharCode(65 + index)}:`;
        const path = `${label}\\`;
        return (await exists(path))
          ? { kind: "drive" as const, label, path }
          : undefined;
      }),
    );
    for (const drive of drives) if (drive) locations.push(drive);
  } else {
    locations.push({
      kind: "root",
      label: platform === "darwin" ? "Macintosh HD" : "Computer",
      path: "/",
    });
    if (platform === "darwin") {
      const root = await canonical("/").catch(() => "/");
      for (const name of (await names("/Volumes")).sort()) {
        const path = posix.join("/Volumes", name);
        if (!(await exists(path))) continue;
        if ((await canonical(path).catch(() => path)) === root) {
          locations[0].label = name;
          continue;
        }
        locations.push({ kind: "volume", label: name, path });
      }
    } else if (platform === "linux") {
      const username = environment.username ?? userInfo().username;
      for (const parent of [`/media/${username}`, `/run/media/${username}`]) {
        for (const name of (await names(parent)).sort()) {
          const path = posix.join(parent, name);
          if (await exists(path))
            locations.push({ kind: "removable", label: name, path });
        }
      }
    }
  }
  return {
    platform:
      platform === "linux" || platform === "darwin" || platform === "win32"
        ? platform
        : "other",
    separator: platform === "win32" ? "\\" : "/",
    home,
    caseInsensitive: platform === "win32" || platform === "darwin",
    places,
    locations,
  };
}

export function validateDirectoryName(
  name: string,
  platform: string = process.platform,
): void {
  const invalid =
    !name ||
    name === "." ||
    name === ".." ||
    /[/\\]/.test(name) ||
    name.includes("\0") ||
    (platform === "win32" &&
      (/[<>:"|?*]/.test(name) ||
        Array.from(name).some((character) => character.charCodeAt(0) < 32) ||
        /[. ]$/.test(name) ||
        /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)));
  if (invalid)
    throw new ApplicationError(
      422,
      "INVALID_DIRECTORY_NAME",
      "Invalid folder name.",
    );
}

export async function createDirectory(
  parent: string,
  name: string,
): Promise<{ path: string }> {
  validateDirectoryName(name);
  if (
    !nativePaths(process.platform).isAbsolute(parent) ||
    parent.includes("\0")
  ) {
    throw new ApplicationError(
      422,
      "INVALID_DIRECTORY_PARENT",
      "Parent must be an absolute directory path.",
    );
  }
  const path = nativePaths(process.platform).join(parent, name);
  try {
    const info = await stat(parent);
    if (!info.isDirectory())
      throw new ApplicationError(
        422,
        "INVALID_DIRECTORY_PARENT",
        "Parent must be a directory.",
      );
    // Non-recursive creation rejects existing targets (including symlinks).
    await mkdir(path);
    return { path };
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST")
      throw new ApplicationError(
        409,
        "DIRECTORY_EXISTS",
        "A file or folder with that name already exists.",
      );
    if (code === "ENOENT" || code === "ENOTDIR")
      throw new ApplicationError(
        404,
        "DIRECTORY_PARENT_NOT_FOUND",
        "Parent directory does not exist.",
      );
    if (code === "EACCES" || code === "EPERM")
      throw new ApplicationError(
        403,
        "DIRECTORY_CREATE_DENIED",
        "Cannot create a folder here.",
      );
    throw error;
  }
}
