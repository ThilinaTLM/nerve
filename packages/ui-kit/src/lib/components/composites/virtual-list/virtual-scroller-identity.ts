export type VirtualScrollerItemKey = string | number;

/** Capture item identity without retaining a closure over mutable source data. */
export function captureItemKeySnapshot<T>(
  items: readonly T[],
  getKey: (item: T, index: number) => VirtualScrollerItemKey,
): readonly VirtualScrollerItemKey[] {
  return Object.freeze(items.map((item, index) => getKey(item, index)));
}

/** Compare every key so interior replacements/reorders are structural changes. */
export function itemKeySnapshotsEqual(
  previous: readonly VirtualScrollerItemKey[],
  next: readonly VirtualScrollerItemKey[],
): boolean {
  if (previous.length !== next.length) return false;
  return previous.every((key, index) => Object.is(key, next[index]));
}

/**
 * Create a TanStack key accessor whose answers cannot change after creation.
 * Callers must only request indexes within the captured item count.
 */
export function createItemKeyAccessor(
  snapshot: readonly VirtualScrollerItemKey[],
): (index: number) => VirtualScrollerItemKey {
  return (index) => snapshot[index] as VirtualScrollerItemKey;
}

/** Encode key type and value for DOM attributes and renderer-owned keys. */
export function encodeItemKey(key: VirtualScrollerItemKey): string {
  if (typeof key === "string") return `string:${JSON.stringify(key)}`;
  if (Number.isNaN(key)) return "number:NaN";
  if (Object.is(key, -0)) return "number:-0";
  return `number:${String(key)}`;
}

export type VirtualDomIdentity = {
  /** Encoded unsuffixed item key, stored on the measured DOM node. */
  encodedItemKey: string;
  /** Guaranteed-unique key for the Svelte each block. */
  domKey: string;
};

/**
 * Derive stable renderer keys, adding an occurrence suffix only for duplicate
 * virtual keys. The normal path depends solely on immutable item identity.
 */
export function deriveVirtualDomIdentities(
  keys: readonly VirtualScrollerItemKey[],
): VirtualDomIdentity[] {
  const occurrences = new Map<string, number>();
  return keys.map((key) => {
    const encodedItemKey = encodeItemKey(key);
    const occurrence = occurrences.get(encodedItemKey) ?? 0;
    occurrences.set(encodedItemKey, occurrence + 1);
    return {
      encodedItemKey,
      domKey:
        occurrence === 0
          ? encodedItemKey
          : `${encodedItemKey}:duplicate:${occurrence}`,
    };
  });
}

/** Validate a delayed DOM measurement against the current structural keys. */
export function measurementTargetIsCurrent(
  snapshot: readonly VirtualScrollerItemKey[],
  indexValue: string | number | undefined,
  encodedItemKey: string | undefined,
): boolean {
  if (encodedItemKey === undefined || indexValue === undefined) return false;
  const index =
    typeof indexValue === "number" ? indexValue : Number(indexValue.trim());
  if (!Number.isInteger(index) || index < 0 || index >= snapshot.length)
    return false;
  return (
    encodeItemKey(snapshot[index] as VirtualScrollerItemKey) === encodedItemKey
  );
}
