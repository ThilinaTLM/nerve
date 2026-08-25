import type { NotifyEvent } from "@nervekit/contracts";

export interface NotificationDefinition {
  readonly scope: readonly string[];
  readonly coalescing?:
    | { readonly strategy: "latest_by_scope" }
    | {
        readonly strategy: "concat_delta";
        readonly field: "delta" | "text";
        readonly offsetField?: "offset";
        readonly maxChars: number;
      };
}

export class NotificationBuffer {
  readonly #queue: NotifyEvent[] = [];
  constructor(private readonly limit: number) {}

  enqueue(
    event: NotifyEvent,
    definition: NotificationDefinition,
    parseData: (data: unknown) => unknown,
  ): void {
    const coalescing = definition.coalescing;
    if (coalescing?.strategy === "latest_by_scope") {
      const key = scopeKey(event, definition.scope);
      const index = this.#queue.findIndex(
        (queued) => scopeKey(queued, definition.scope) === key,
      );
      if (index >= 0) this.#queue.splice(index, 1);
    } else if (coalescing?.strategy === "concat_delta") {
      const previous = this.#queue.at(-1);
      const merged = previous
        ? mergeDelta(previous, event, definition.scope, coalescing)
        : undefined;
      if (merged) {
        this.#queue[this.#queue.length - 1] = {
          ...merged,
          data: parseData(merged.data),
        };
        return;
      }
    }
    this.#queue.push(event);
    while (this.#queue.length > this.limit) this.#queue.shift();
  }

  all(): readonly NotifyEvent[] {
    return this.#queue;
  }
  take(): NotifyEvent[] {
    return this.#queue.splice(0);
  }
  clear(): void {
    this.#queue.splice(0);
  }
}

function scopeKey(event: NotifyEvent, scope: readonly string[]): string {
  return `${event.type}:${scope.map((path) => JSON.stringify(readPath(event.data, path))).join(":")}`;
}

function mergeDelta(
  previous: NotifyEvent,
  current: NotifyEvent,
  scope: readonly string[],
  coalescing: {
    readonly field: "delta" | "text";
    readonly offsetField?: "offset";
    readonly maxChars: number;
  },
): NotifyEvent | undefined {
  if (scopeKey(previous, scope) !== scopeKey(current, scope)) return undefined;
  const previousData = previous.data as Record<string, unknown>;
  const currentData = current.data as Record<string, unknown>;
  const left = previousData[coalescing.field];
  const right = currentData[coalescing.field];
  if (typeof left !== "string" || typeof right !== "string") return undefined;
  const combined = `${left}${right}`;
  if (combined.length > coalescing.maxChars) return undefined;
  let firstOffset: number | undefined;
  if (coalescing.offsetField) {
    const previousOffset = previousData[coalescing.offsetField];
    const currentOffset = currentData[coalescing.offsetField];
    if (
      typeof previousOffset !== "number" ||
      typeof currentOffset !== "number" ||
      currentOffset !== previousOffset + left.length
    )
      return undefined;
    firstOffset = previousOffset;
  }
  return {
    ...current,
    data: {
      ...currentData,
      [coalescing.field]: combined,
      ...(coalescing.offsetField
        ? { [coalescing.offsetField]: firstOffset }
        : {}),
    },
  };
}

function readPath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
