type Timestamped = { updatedAt: string };

/** Complete activity snapshots replace only an older or missing projection. */
export function freshestActivity<T extends Timestamped>(
  current: T | undefined,
  replacement: T,
): T {
  return current && current.updatedAt >= replacement.updatedAt
    ? current
    : replacement;
}

/** Hydrates a snapshot without letting a late response undo newer events. */
export function mergeActivitySnapshots<T extends Timestamped>(
  snapshots: readonly T[],
  current: Readonly<Record<string, T>>,
  key: (snapshot: T) => string,
): Record<string, T> {
  return Object.fromEntries(
    snapshots.map((snapshot) => {
      const id = key(snapshot);
      return [id, freshestActivity(current[id], snapshot)];
    }),
  );
}
