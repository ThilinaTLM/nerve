/** Small validators shared by the SDK methods. */

export function nonEmptyString(value: unknown, name: string): string {
  const text =
    typeof value === "number"
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : "";
  if (!text) throw new Error(`${name} must be a non-empty string.`);
  return text;
}

export function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/** Up to five candidates close to `input` (substring or small edit distance), best first. */
export function closeMatches(
  input: string,
  candidates: readonly string[],
  limit = 5,
): string[] {
  const needle = input.trim().toLowerCase();
  if (!needle) return [];
  const scored: Array<{ candidate: string; score: number }> = [];
  for (const candidate of new Set(candidates)) {
    const hay = candidate.toLowerCase();
    let score: number;
    if (hay === needle) score = 0;
    else if (hay.includes(needle) || needle.includes(hay)) score = 1;
    else {
      const distance = editDistance(needle, hay);
      if (distance > Math.max(2, Math.floor(needle.length / 3))) continue;
      score = 1 + distance;
    }
    scored.push({ candidate, score });
  }
  return scored
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.candidate.length - b.candidate.length ||
        a.candidate.localeCompare(b.candidate),
    )
    .slice(0, limit)
    .map((entry) => entry.candidate);
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = current;
    }
  }
  return row[b.length];
}
