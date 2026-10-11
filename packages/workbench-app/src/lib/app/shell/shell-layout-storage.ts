export const SHELL_LAYOUT_STORAGE_KEY = "nerve.layout.v2";
const legacyKey = "nerve.layout.v1";

type LayoutStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readShellLayoutStorage(storage: LayoutStorage): unknown {
  try {
    let stored = storage.getItem(SHELL_LAYOUT_STORAGE_KEY);
    if (stored === null) {
      const legacy = storage.getItem(legacyKey);
      if (legacy === null) return undefined;
      const migrated: unknown = JSON.parse(legacy, (_key, value: unknown) =>
        value === "tasks" ? "launches" : value,
      );
      stored = JSON.stringify(migrated);
      storage.setItem(SHELL_LAYOUT_STORAGE_KEY, stored);
    }
    storage.removeItem(legacyKey);
    return JSON.parse(stored) as unknown;
  } catch {
    return undefined;
  }
}
