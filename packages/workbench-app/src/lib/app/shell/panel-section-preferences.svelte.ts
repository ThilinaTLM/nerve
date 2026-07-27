import { SvelteMap } from "svelte/reactivity";

/** Free-form section keys, namespaced by panel view (e.g. `git.changes`). */
export type PanelSectionKey = string;

type StorageLike = Pick<Storage, "getItem" | "setItem">;
type StoredSectionState = Record<string, boolean>;

export const panelSectionStorageKey = "nerve.panel.sections.v1";

function readStoredState(storage?: StorageLike): StoredSectionState {
  if (!storage) return {};
  try {
    const raw = storage.getItem(panelSectionStorageKey);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
      ),
    );
  } catch {
    return {};
  }
}

function browserStorage(): StorageLike | undefined {
  return typeof localStorage === "undefined" ? undefined : localStorage;
}

export function createPanelSectionPreferences(
  storage: StorageLike | undefined = browserStorage(),
) {
  const state = new SvelteMap<string, boolean>(
    Object.entries(readStoredState(storage)),
  );

  return {
    isOpen(key: PanelSectionKey): boolean {
      return state.get(key) ?? true;
    },
    setOpen(key: PanelSectionKey, open: boolean): void {
      state.set(key, open);
      if (!storage) return;
      try {
        storage.setItem(
          panelSectionStorageKey,
          JSON.stringify(Object.fromEntries(state)),
        );
      } catch {
        // Storage is best effort; the in-memory preference still applies.
      }
    },
  };
}

export const panelSectionPreferences = createPanelSectionPreferences();
