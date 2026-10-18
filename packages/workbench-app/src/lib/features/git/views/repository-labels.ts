type Repository = { id: string; name: string; path: string };
type Label = { label: string; reason: string };

export type RepositoryLabelOptions = { maxLength?: number };

const semantic = new Set([
  "api",
  "ui",
  "web",
  "app",
  "user",
  "admin",
  "cli",
  "sdk",
  "db",
  "ios",
  "android",
]);
const abbreviations: Record<string, string> = {
  application: "app",
  configuration: "config",
  development: "dev",
  infrastructure: "infra",
  management: "mgmt",
  platform: "plat",
  repository: "repo",
  service: "svc",
};

const key = (value: string) => value.normalize("NFC").toLowerCase();
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const length = (value: string) => Array.from(value).length;

/** Split whole Unicode words, camelCase, and acronym boundaries (UserAPI → User/API). */
function tokens(value: string): string[] {
  return (
    value
      .normalize("NFC")
      .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
      .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
      .match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu) ?? []
  );
}

function display(token: string): string {
  return key(token);
}

function phrase(parts: string[]): string {
  return parts.map(display).join("-");
}

/** Abbreviate from the left, never discard the semantic tail. */
function compress(parts: string[], budget: number): string {
  const result = parts.map(display);
  if (
    parts.length === 1 &&
    length(result[0]) > budget &&
    !semantic.has(key(parts[0]))
  ) {
    const letters = Array.from(result[0]);
    // An opaque lowercase word has no safe semantic split. Keep its outer
    // letters and consonant skeleton rather than clipping an arbitrary tail.
    // Acronyms and scripts without Latin vowels remain intact.
    if (!/^\p{Lu}[\p{Lu}\p{N}]+$/u.test(parts[0])) {
      return letters
        .filter(
          (letter, index) =>
            index === 0 ||
            index === letters.length - 1 ||
            !/^[aeiou]$/i.test(letter.normalize("NFD").replace(/\p{M}/gu, "")),
        )
        .join("");
    }
  }
  for (
    let i = 0;
    i < parts.length - 1 && length(result.join("-")) > budget;
    i++
  ) {
    const token = parts[i];
    if (semantic.has(key(token)) || /^\p{Lu}[\p{Lu}\p{N}]+$/u.test(token))
      continue;
    const shorter = abbreviations[key(token)] ?? key(Array.from(token)[0]);
    if (length(shorter) < length(result[i])) result[i] = shorter;
  }
  for (
    let i = 0;
    i < parts.length - 1 && length(result.join("-")) > budget;
    i++
  ) {
    if (semantic.has(key(parts[i])) || /^\p{Lu}[\p{Lu}\p{N}]+$/u.test(parts[i]))
      continue;
    result[i] = key(Array.from(parts[i])[0]);
  }
  return result.join("-");
}

function collisionGroups<T extends { label: string }>(entries: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const group = groups.get(key(entry.label)) ?? [];
    group.push(entry);
    groups.set(key(entry.label), group);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

function shortId(value: string): string {
  // Stable, non-security identifier; checked for collisions below.
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Group-aware lowercase kebab-case aliases, bounded to maxLength Unicode code
 * points (default 14, minimum 9; not a pixel-fit guarantee). Shared whole-token
 * prefixes are removed, but semantic tails are retained. When readable aliases
 * cannot fit, use a stable compact identity rather than ellipsizing a name.
 * Callers must expose the original name/path separately, e.g. in a tooltip.
 * IDs must be unique. Results and Map iteration order are input-order independent.
 */
export function repositoryLabels(
  repos: readonly Repository[],
  options: RepositoryLabelOptions = {},
): Map<string, Label> {
  const requested = options.maxLength ?? 14;
  const budget = Number.isFinite(requested)
    ? Math.max(9, Math.floor(requested))
    : 14;
  const sorted = [...repos].sort((a, b) => compare(a.id, b.id));
  const names = sorted.map((repo) => tokens(repo.name));
  let prefix = 0;
  if (names.length > 1) {
    // Leave at least one token in every name, even when one name prefixes another.
    const limit = Math.min(...names.map((parts) => parts.length)) - 1;
    while (
      prefix < limit &&
      names.every((parts) => key(parts[prefix]) === key(names[0][prefix]))
    ) {
      prefix++;
    }
  }

  const entries = sorted.map((repo, index) => {
    const parts = names[index].slice(prefix);
    const readable = phrase(parts) || "repo";
    const base = readable;
    const label =
      length(base) > budget ? compress(parts, budget) || base : base;
    const reasons = [
      prefix
        ? `Removed ${prefix} shared prefix token(s)`
        : "Kept repository tokens",
      "Normalized label to lowercase kebab-case",
    ];
    if (label !== base)
      reasons.push(
        parts.length === 1
          ? "Contracted internal vowels; retained first and last letters"
          : "Abbreviated earlier words; retained semantic tail",
      );
    return {
      ...repo,
      label,
      readable,
      reasons,
      parents: repo.path
        .replace(/\\/g, "/")
        .split("/")
        .filter(Boolean)
        .slice(0, -1)
        .map((parent) => phrase(tokens(parent)))
        .filter(Boolean),
    };
  });

  // Expand compressed collisions first, before adding any path context.
  for (const group of collisionGroups(entries)) {
    for (const entry of group) {
      entry.label = entry.readable;
      entry.reasons.push("Expanded words to distinguish repositories");
    }
  }
  // Tokenization itself can collapse spellings (foo-bar / foo_bar).
  for (const group of collisionGroups(entries)) {
    for (const entry of group) {
      entry.label = phrase(tokens(entry.name)) || "repo";
      entry.reasons.push(
        "Restored full normalized name to distinguish repositories",
      );
    }
  }

  // Add the shortest distinguishing parent-path suffix, retaining full words.
  for (const group of collisionGroups(entries)) {
    const bases = new Map(group.map((entry) => [entry.id, entry.label]));
    const maxDepth = Math.max(...group.map((entry) => entry.parents.length));
    for (let depth = 1; depth <= maxDepth; depth++) {
      for (const entry of group) {
        const context = entry.parents.slice(-depth).join("-");
        entry.label = context
          ? `${bases.get(entry.id)}-${context}`
          : bases.get(entry.id)!;
      }
      if (collisionGroups(group).length === 0) break;
    }
    for (const entry of group)
      entry.reasons.push("Added shortest distinguishing parent context");
  }

  // Also check collisions with labels outside the original group. Allocate in
  // stable ID order and check every reserved label, including hash collisions.
  const collisions = new Set(collisionGroups(entries).flat());
  const reserved = new Set(
    entries
      .filter((entry) => !collisions.has(entry))
      .map((entry) => key(entry.label)),
  );
  for (const entry of entries) {
    if (!collisions.has(entry)) continue;
    const base = `${entry.label}-${shortId(entry.id)}`;
    let candidate = base;
    let counter = 2;
    while (reserved.has(key(candidate))) candidate = `${base}-${counter++}`;
    entry.label = candidate;
    reserved.add(key(candidate));
    entry.reasons.push(
      "Added stable identifier because readable context was not unique",
    );
  }

  {
    const oversized = entries.filter((entry) => length(entry.label) > budget);
    const occupied = new Set(
      entries
        .filter((entry) => length(entry.label) <= budget)
        .map((entry) => key(entry.label)),
    );
    // Four base-36 identity characters leave room for repo at the minimum
    // budget. Probe the finite namespace, never clip names or append overflow.
    const capacity = 36 ** 4;
    for (const entry of oversized) {
      const parts = tokens(entry.name);
      const suffix: string[] = [];
      for (let index = parts.length - 1; index >= 0; index--) {
        if (!semantic.has(key(parts[index]))) break;
        const next = [display(parts[index]), ...suffix];
        if (length(next.join("-")) > budget - 5) break;
        suffix.unshift(display(parts[index]));
      }
      const stem = suffix.join("-") || "repo";
      const seed = parseInt(shortId(entry.id), 36);
      let allocated = false;
      for (let attempt = 0; attempt < capacity; attempt++) {
        const identifier = ((seed + attempt) % capacity)
          .toString(36)
          .padStart(4, "0");
        const candidate = `${stem}-${identifier}`;
        if (occupied.has(key(candidate))) continue;
        entry.label = candidate;
        occupied.add(key(candidate));
        allocated = true;
        break;
      }
      if (!allocated)
        throw new RangeError("Compact repository identity namespace exhausted");
      entry.reasons.push(
        "Identity fallback due to insufficient semantic width; full name/path available from repository",
      );
    }
  }

  return new Map(
    entries.map((entry) => [
      entry.id,
      { label: entry.label, reason: entry.reasons.join("; ") },
    ]),
  );
}
