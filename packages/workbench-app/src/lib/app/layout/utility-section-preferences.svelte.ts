import { SvelteMap } from "svelte/reactivity";

export type UtilitySectionKey =
  | "git.repository"
  | "git.changes"
  | "git.pullRequests"
  | "tasks.pinned"
  | "tasks.running"
  | "tasks.needsCleanup"
  | "tasks.finished"
  | "context.active"
  | "context.agents"
  | "context.export"
  | `notes.${string}`;

type StorageLike = Pick<Storage, "getItem" | "setItem">;
type StoredSectionState = Record<string, boolean>;

export const utilitySectionStorageKey = "nerve.utilityPanel.sections";

function readStoredState(storage?: StorageLike): StoredSectionState {
  if (!storage) return {};
  try {
    const raw = storage.getItem(utilitySectionStorageKey);
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

export function createUtilitySectionPreferences(
  storage: StorageLike | undefined = browserStorage(),
) {
  const state = new SvelteMap<string, boolean>(
    Object.entries(readStoredState(storage)),
  );

  return {
    isOpen(key: UtilitySectionKey): boolean {
      return state.get(key) ?? true;
    },
    setOpen(key: UtilitySectionKey, open: boolean): void {
      state.set(key, open);
      if (!storage) return;
      try {
        storage.setItem(
          utilitySectionStorageKey,
          JSON.stringify(Object.fromEntries(state)),
        );
      } catch {
        // Storage is best effort; the in-memory preference still applies.
      }
    },
  };
}

export const utilitySectionPreferences = createUtilitySectionPreferences();
