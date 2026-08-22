export async function recoverSnapshotFromNetwork<TSnapshot, TCursor>(options: {
  fetch: () => Promise<TSnapshot>;
  apply: (snapshot: TSnapshot) => TCursor | Promise<TCursor>;
  cache?: (snapshot: TSnapshot) => void;
}): Promise<TCursor> {
  const snapshot = await options.fetch();
  const cursor = await options.apply(snapshot);
  options.cache?.(snapshot);
  return cursor;
}
