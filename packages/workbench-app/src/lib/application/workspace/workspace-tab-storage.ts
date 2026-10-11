export const WORKSPACE_TAB_STORAGE_KEY = "nerve.workspaceTabs.v3";
const legacyKey = "nerve.workspaceTabs.v2";

type TabStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function launchId(id: string): string {
  return id.replace(/^task(?=_|def_|grp_)/, "launch");
}

export function readWorkspaceTabStorage(storage: TabStorage): unknown {
  try {
    let stored = storage.getItem(WORKSPACE_TAB_STORAGE_KEY);
    if (stored === null) {
      const legacy = storage.getItem(legacyKey);
      if (legacy === null) return undefined;
      const migrated: unknown = JSON.parse(legacy, (key, value: unknown) => {
        if (key === "mru" && Array.isArray(value)) {
          return value.map((item: unknown) =>
            typeof item === "string" && item.startsWith("task:")
              ? `launch:${launchId(item.slice("task:".length))}`
              : item,
          );
        }
        if (value && typeof value === "object" && !Array.isArray(value)) {
          const tab = value as { kind?: unknown; id?: unknown };
          if (tab.kind === "task" && typeof tab.id === "string") {
            return { ...tab, kind: "launch", id: launchId(tab.id) };
          }
        }
        return value;
      });
      stored = JSON.stringify(migrated);
      storage.setItem(WORKSPACE_TAB_STORAGE_KEY, stored);
    }
    storage.removeItem(legacyKey);
    return JSON.parse(stored) as unknown;
  } catch {
    return undefined;
  }
}
