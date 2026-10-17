import type { MetaItem } from "./card-presentation";

/** Stable chip identity: an explicit key, else the text. */
export function chipKey(item: Pick<MetaItem, "key" | "text">): string {
  return item.key ?? item.text;
}

/**
 * Append-only chip order: chips render in order of first appearance, so a chip
 * that arrives later never pushes earlier ones around, and a chip that
 * disappears and returns keeps its slot. Duplicate keys collapse to the first.
 */
export class ChipOrder {
  private seen = new Map<string, number>();

  order<T extends Pick<MetaItem, "key" | "text">>(chips: readonly T[]): T[] {
    const unique = new Map<string, T>();
    for (const chip of chips) {
      const key = chipKey(chip);
      if (!unique.has(key)) unique.set(key, chip);
      if (!this.seen.has(key)) this.seen.set(key, this.seen.size);
    }
    return [...unique.entries()]
      .sort(([a], [b]) => (this.seen.get(a) ?? 0) - (this.seen.get(b) ?? 0))
      .map(([, chip]) => chip);
  }

  reset(): void {
    this.seen.clear();
  }
}
