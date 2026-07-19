export class KeyedSerialQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.tails.set(key, next);
    const cleanup = () => {
      if (this.tails.get(key) === next) this.tails.delete(key);
    };
    void next.then(cleanup, cleanup);
    return next;
  }

  async wait(key: string): Promise<void> {
    await this.tails.get(key)?.catch(() => undefined);
  }
}
