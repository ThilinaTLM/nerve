import { singleFlight } from "@nervekit/primitives";
import { SvelteMap, SvelteSet } from "svelte/reactivity";

export type KeyedLoaderOptions<K, V> = {
  load(key: K): Promise<V>;
  /** A failed load. The cached value stays unless the hook removes it. */
  onError?(key: K, error: unknown): void;
};

/**
 * A reactive per-key cache of server reads. `ensure` loads a key once and
 * shares the request; `refresh` always starts a new one, and only the newest
 * request of a key may write its value or report its error.
 */
export class KeyedLoader<K, V> {
  readonly #values = new SvelteMap<K, V>();
  readonly #loading = new SvelteSet<K>();
  readonly #inFlight = new Map<K, Promise<V | undefined>>();
  readonly #generations = new Map<K, number>();

  constructor(private readonly options: KeyedLoaderOptions<K, V>) {}

  get(key: K): V | undefined {
    return this.#values.get(key);
  }

  has(key: K): boolean {
    return this.#values.has(key);
  }

  set(key: K, value: V): void {
    this.#values.set(key, value);
  }

  delete(key: K): void {
    this.#values.delete(key);
  }

  /** A request for the key is running. */
  loading(key: K): boolean {
    return this.#loading.has(key);
  }

  /** Every key ever requested, loaded or not. */
  keys(): K[] {
    return [...this.#generations.keys()];
  }

  /** The cached value, or the shared request for it. */
  ensure(key: K): Promise<V | undefined> {
    if (this.#values.has(key)) return Promise.resolve(this.#values.get(key));
    return singleFlight(this.#inFlight, key, () => this.#fetch(key));
  }

  /** Reloads the key, superseding a request already running for it. */
  refresh(key: K): Promise<V | undefined> {
    this.#inFlight.delete(key);
    return singleFlight(this.#inFlight, key, () => this.#fetch(key));
  }

  /** Settles with the key's value once this request is done (the newest one's, if it was superseded). */
  #fetch(key: K): Promise<V | undefined> {
    const generation = (this.#generations.get(key) ?? 0) + 1;
    this.#generations.set(key, generation);
    const current = () => this.#generations.get(key) === generation;
    this.#loading.add(key);
    return this.options
      .load(key)
      .then(
        (value) => {
          if (current()) this.#values.set(key, value);
        },
        (error: unknown) => {
          if (current()) this.options.onError?.(key, error);
        },
      )
      .then(() => {
        if (current()) this.#loading.delete(key);
        return this.#values.get(key);
      });
  }
}
