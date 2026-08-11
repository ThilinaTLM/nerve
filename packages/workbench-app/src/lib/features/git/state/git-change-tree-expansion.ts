const STORAGE_PREFIX = "nerve.git.changeTreeCollapsed.v1";
const MAX_COLLAPSED_FOLDERS = 2_000;

type ExpansionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): ExpansionStorage | undefined {
  if (typeof localStorage === "undefined") return undefined;
  return localStorage;
}

export function gitChangeTreeExpansionStorageKey(
  projectId: string,
  repo: string,
): string {
  return `${STORAGE_PREFIX}:${encodeURIComponent(projectId)}:${encodeURIComponent(repo)}`;
}

export function sanitizeCollapsedGitFolders(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim().length > 0,
      ),
    ),
  ].slice(0, MAX_COLLAPSED_FOLDERS);
}

export function loadCollapsedGitFolders(
  projectId: string,
  repo: string,
  storage: ExpansionStorage | undefined = browserStorage(),
): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(
      gitChangeTreeExpansionStorageKey(projectId, repo),
    );
    return raw ? sanitizeCollapsedGitFolders(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function saveCollapsedGitFolders(
  projectId: string,
  repo: string,
  collapsed: Iterable<string>,
  storage: ExpansionStorage | undefined = browserStorage(),
): void {
  if (!storage) return;
  const values = sanitizeCollapsedGitFolders([...collapsed]);
  const key = gitChangeTreeExpansionStorageKey(projectId, repo);
  try {
    if (values.length === 0) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(values));
  } catch {
    // Persistence is best-effort; the live expansion state still applies.
  }
}
