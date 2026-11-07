/**
 * Copies only the fields of `next` that differ from `target`, so a reactive
 * `target` notifies just the readers of the changed fields. Values are JSON
 * data; nested objects compare structurally. With `removeMissing`, fields
 * absent from `next` are deleted (a full replacement); otherwise they are kept
 * (a partial update, like `Object.assign`). Returns whether anything changed.
 */
export function patchChanged<T extends object>(
  target: T,
  next: Partial<T>,
  removeMissing: boolean,
): boolean {
  const current = target as Record<string, unknown>;
  const source = next as Record<string, unknown>;
  let changed = false;
  if (removeMissing)
    for (const key of Object.keys(current))
      if (!(key in source)) {
        delete current[key];
        changed = true;
      }
  for (const [key, value] of Object.entries(source))
    if (!sameValue(current[key], value)) {
      current[key] = value;
      changed = true;
    }
  return changed;
}

/** Structural equality for JSON data. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  )
    return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  return aKeys.every((key) => key in right && sameValue(left[key], right[key]));
}
