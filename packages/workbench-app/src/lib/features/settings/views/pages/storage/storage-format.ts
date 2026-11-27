import type {
  StorageCategoryKey,
  StorageCategoryUsage,
  StorageCleanupTarget,
} from "@nervekit/contracts/storage";

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 100 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function percentOfTotal(bytes: number, totalBytes: number): number {
  return totalBytes > 0
    ? Math.min(100, Math.round((bytes / totalBytes) * 100))
    : 0;
}

/** "46%", or "<1%" for a share that rounds to nothing. */
export function percentLabel(bytes: number, totalBytes: number): string {
  const percent = percentOfTotal(bytes, totalBytes);
  return percent === 0 && bytes > 0 ? "<1%" : `${percent}%`;
}

/** Colours of the largest categories, biggest first; the rest share one neutral. */
export const BREAKDOWN_TONES = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-5",
  "bg-chart-4",
] as const;
export const BREAKDOWN_REST_TONE = "bg-muted-foreground";

/** Categories under this share fold behind "Show smaller items". */
export const SMALL_CATEGORY_SHARE = 0.01;

export type BreakdownCategory = StorageCategoryUsage & { tone: string };

/**
 * Non-empty categories, largest first, each with its colour; the categories
 * that are at least 1% of the total (always at least the top colours) are
 * `major`, the rest `minor`.
 */
export function storageBreakdown(
  categories: readonly StorageCategoryUsage[],
  totalBytes: number,
): { major: BreakdownCategory[]; minor: BreakdownCategory[] } {
  const sorted = categories
    .filter((category) => category.bytes > 0)
    .sort((left, right) => right.bytes - left.bytes)
    .map((category, index) => ({
      ...category,
      tone: BREAKDOWN_TONES[index] ?? BREAKDOWN_REST_TONE,
    }));
  const isMajor = (category: BreakdownCategory, index: number) =>
    index < BREAKDOWN_TONES.length ||
    category.bytes >= totalBytes * SMALL_CATEGORY_SHARE;
  return {
    major: sorted.filter(isMajor),
    minor: sorted.filter((category, index) => !isMajor(category, index)),
  };
}

/** The cleanup choice that frees a category's space, if one does. */
export function categoryCleanupTarget(
  key: StorageCategoryKey,
): StorageCleanupTarget | undefined {
  const targets: Partial<Record<StorageCategoryKey, StorageCleanupTarget>> = {
    payloads: "conversations",
    logs: "datedLogs",
    crashReports: "crashReports",
    cache: "cache",
    temporaryFiles: "tmp",
  };
  return targets[key];
}
