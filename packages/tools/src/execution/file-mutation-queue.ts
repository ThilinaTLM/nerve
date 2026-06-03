const queues = new Map<string, Promise<void>>();

export async function withFileMutationQueue<T>(
  path: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(path) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  queues.set(path, previous.then(() => current, () => current));
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (queues.get(path) === current) queues.delete(path);
  }
}
