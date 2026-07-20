import { SvelteMap } from "svelte/reactivity";

export type SandboxUtilitySectionKey =
  | "git.repository"
  | "git.changes"
  | "git.pullRequests"
  | "git.setup"
  | "tasks.pinned"
  | "tasks.running"
  | "tasks.needsCleanup"
  | "tasks.finished"
  | "context.runtime"
  | "context.details"
  | "context.config";

type StorageLike = Pick<Storage, "getItem" | "setItem">;
type StoredSectionState = Record<string, boolean>;

export const sandboxUtilitySectionStorageKey =
  "nerve.sandboxManager.utilityPanel.sections";

function readStoredState(storage?: StorageLike): StoredSectionState {
  if (!storage) return {};
  try {
    const raw = storage.getItem(sandboxUtilitySectionStorageKey);
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

export function createSandboxUtilitySectionPreferences(
  storage: StorageLike | undefined = browserStorage(),
) {
  const state = new SvelteMap<string, boolean>(
    Object.entries(readStoredState(storage)),
  );

  return {
    isOpen(key: SandboxUtilitySectionKey): boolean {
      return state.get(key) ?? true;
    },
    setOpen(key: SandboxUtilitySectionKey, open: boolean): void {
      state.set(key, open);
      if (!storage) return;
      try {
        storage.setItem(
          sandboxUtilitySectionStorageKey,
          JSON.stringify(Object.fromEntries(state)),
        );
      } catch {
        // Storage is best effort; the in-memory preference still applies.
      }
    },
  };
}

export const sandboxUtilitySectionPreferences =
  createSandboxUtilitySectionPreferences();
