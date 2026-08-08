export const PRODUCT_TOUR_COMPLETION_STORAGE_KEY =
  "nerve.product-tour.completed-version";

type ProductTourStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

function browserStorage(): ProductTourStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function readProductTourCompletionVersion(
  storage: ProductTourStorage | undefined = browserStorage(),
): number {
  if (!storage) return 0;
  try {
    const stored = storage.getItem(PRODUCT_TOUR_COMPLETION_STORAGE_KEY);
    if (!stored || !/^(0|[1-9]\d*)$/.test(stored)) return 0;
    const version = Number(stored);
    return Number.isSafeInteger(version) ? version : 0;
  } catch {
    return 0;
  }
}

export function writeProductTourCompletionVersion(
  version: number,
  storage: ProductTourStorage | undefined = browserStorage(),
): void {
  if (!storage || !Number.isSafeInteger(version) || version < 0) return;
  try {
    storage.setItem(PRODUCT_TOUR_COMPLETION_STORAGE_KEY, String(version));
  } catch {
    // Persistence is best effort; reactive state still covers this session.
  }
}
