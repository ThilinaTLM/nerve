export class ConfigurationSignals<T> {
  private readonly listeners = new Set<(value: T) => void>();
  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  publish(value: T): void {
    for (const listener of this.listeners) {
      try {
        listener(value);
      } catch {
        /* Display observers cannot roll back configuration authority. */
      }
    }
  }
}
