import type { InitializedStorage } from "./initialize.js";

const pendingMutations = new WeakMap<InitializedStorage, Promise<void>>();

/** Serialize home-document read/modify/write operations, including runtime publication. */
export function serializeSettingsMutation<T>(
  storage: InitializedStorage,
  mutate: () => Promise<T>,
): Promise<T> {
  const result = (pendingMutations.get(storage) ?? Promise.resolve()).then(
    mutate,
  );
  // A rejected save must not prevent the next mutation from running.
  pendingMutations.set(
    storage,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}
