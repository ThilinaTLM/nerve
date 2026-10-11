const listeners = new Set<() => void>();

/** Called when any API request is answered with 503 `{ error: "starting" }`. */
export function notifyServerStarting(): void {
  for (const listener of listeners) listener();
}

export function onServerStarting(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
