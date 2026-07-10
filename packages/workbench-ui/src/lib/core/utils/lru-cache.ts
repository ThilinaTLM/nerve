/**
 * Minimal insertion-order LRU cache backed by a `Map`.
 *
 * `get` promotes the entry to most-recently-used; `set` evicts the oldest entry
 * once `max` is exceeded. Used to memoize pure, content-keyed render products
 * (markdown parse/decoration/highlight) so re-mounts and scroll/completion
 * re-renders reuse work instead of re-parsing.
 */
export class LruCache<K, V> {
  readonly #map = new Map<K, V>();

  constructor(private readonly max: number) {
    if (max <= 0) throw new Error("LruCache max must be a positive integer.");
  }

  get(key: K): V | undefined {
    const value = this.#map.get(key);
    if (value === undefined) return this.#map.has(key) ? value : undefined;
    // Promote to most-recently-used.
    this.#map.delete(key);
    this.#map.set(key, value);
    return value;
  }

  has(key: K): boolean {
    return this.#map.has(key);
  }

  set(key: K, value: V): void {
    if (this.#map.has(key)) this.#map.delete(key);
    this.#map.set(key, value);
    if (this.#map.size > this.max) {
      const oldest = this.#map.keys().next().value as K;
      this.#map.delete(oldest);
    }
  }

  delete(key: K): void {
    this.#map.delete(key);
  }

  clear(): void {
    this.#map.clear();
  }

  get size(): number {
    return this.#map.size;
  }
}
