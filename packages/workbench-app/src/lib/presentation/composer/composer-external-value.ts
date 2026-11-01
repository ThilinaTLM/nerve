export type ExternalValueChange = {
  from: number;
  to: number;
  insert: string;
  /** Caret after the change: the end of the inserted text. */
  caret: number;
};

/**
 * Minimal single-range edit turning `previous` into `next`. Applying only the
 * differing span keeps widgets (dictation chip) and the caret mapped in place,
 * and the caret follows text inserted from outside the editor (e.g. quotes).
 */
export function externalValueChange(
  previous: string,
  next: string,
): ExternalValueChange {
  const max = Math.min(previous.length, next.length);
  let prefix = 0;
  while (prefix < max && previous[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const insert = next.slice(prefix, next.length - suffix);
  return {
    from: prefix,
    to: previous.length - suffix,
    insert,
    caret: prefix + insert.length,
  };
}
