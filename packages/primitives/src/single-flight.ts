/**
 * Shares one in-flight call per key. Concurrent callers get the same promise;
 * the entry is removed when it settles (success or failure), so the next call
 * starts fresh. A synchronous throw from `fn` becomes a rejection and is not stored.
 */
export function singleFlight<K, V>(
  inflight: Map<K, Promise<V>>,
  key: K,
  fn: () => Promise<V>,
): Promise<V> {
  const existing = inflight.get(key);
  if (existing) return existing;
  let promise: Promise<V>;
  try {
    promise = fn();
  } catch (error) {
    return Promise.reject(error);
  }
  inflight.set(key, promise);
  const clear = () => {
    if (inflight.get(key) === promise) inflight.delete(key);
  };
  promise.then(clear, clear);
  return promise;
}
