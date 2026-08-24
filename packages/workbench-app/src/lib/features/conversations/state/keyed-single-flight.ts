export class KeyedSingleFlight<Key, Value> {
  private readonly inFlight = new Map<Key, Promise<Value>>();

  run(key: Key, task: () => Promise<Value>): Promise<Value> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const pending = task().finally(() => {
      if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
    });
    this.inFlight.set(key, pending);
    return pending;
  }
}
