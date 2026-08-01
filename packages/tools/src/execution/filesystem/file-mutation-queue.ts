const queues = new Map<string, Promise<void>>();

export function pendingFileMutationQueueCount(): number {
  return queues.size;
}

export async function withFileMutationQueue<T>(
  path: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(path) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = previous.then(
    () => current,
    () => current,
  );
  queues.set(path, chain);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (queues.get(path) === chain) queues.delete(path);
  }
}
