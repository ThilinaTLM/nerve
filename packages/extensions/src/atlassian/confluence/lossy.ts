/** Structured storage elements a Markdown-style rewrite silently drops, counted by kind. */
const KINDS: Array<[label: (m: RegExpMatchArray) => string, re: RegExp]> = [
  [(m) => m[1], /<ac:structured-macro\b[^>]*?\bac:name="([^"]*)"/g],
  [() => "layout", /<ac:layout\b/g],
  [() => "image", /<ac:image\b/g],
  [() => "task-list", /<ac:task-list\b/g],
  [() => "link", /<ac:link\b/g],
  [() => "mention", /<ri:user\b/g],
  [(m) => `adf ${m[1]}`, /<ac:adf-node\b[^>]*?\btype="([^"]*)"/g],
];

function counts(storage: string): Map<string, number> {
  const found = new Map<string, number>();
  for (const [label, re] of KINDS) {
    for (const match of storage.matchAll(re)) {
      const key = label(match);
      found.set(key, (found.get(key) ?? 0) + 1);
    }
  }
  return found;
}

/** "2 status, 1 layout" for kinds whose count drops from `before` to `after`; empty when none do. */
export function removedElements(before: string, after: string): string {
  const next = counts(after);
  return [...counts(before)]
    .map(([key, n]) => [key, n - (next.get(key) ?? 0)] as const)
    .filter(([, dropped]) => dropped > 0)
    .map(([key, dropped]) => `${dropped} ${key}`)
    .join(", ");
}
