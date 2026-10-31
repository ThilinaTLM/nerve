type Repository = { id: string; name: string; path: string };
type Label = { label: string; reason: string };

export type RepositoryLabelOptions = { maxLength?: number };

/** Words that say what a repository is; never removed or abbreviated. */
const ROLE_WORDS = new Set([
  "api",
  "ui",
  "admin",
  "app",
  "web",
  "fe",
  "be",
  "frontend",
  "backend",
  "bff",
  "iac",
  "infra",
  "cli",
  "sdk",
  "db",
  "mobile",
  "ios",
  "android",
  "server",
  "client",
  "worker",
  "docs",
  "e2e",
]);
const COMPOUNDS: Record<string, string> = {
  "front end": "frontend",
  "back end": "backend",
};

const lower = (value: string) => value.normalize("NFC").toLowerCase();
const length = (value: string) => Array.from(value).length;
const isRole = (word: string) => ROLE_WORDS.has(word);
/** Role words and very short words (no, v2, my) carry meaning and are never stripped. */
const isKept = (word: string) => isRole(word) || length(word) <= 2;

/** Split kebab, snake, camel and acronym boundaries (UserAPI → user/api). */
function words(value: string): string[] {
  const parts = (
    value
      .normalize("NFC")
      .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
      .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
      .match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu) ?? []
  ).map(lower);
  const result: string[] = [];
  for (const part of parts) {
    const compound = COMPOUNDS[`${result.at(-1)} ${part}`];
    if (compound) result[result.length - 1] = compound;
    else result.push(part);
  }
  return result;
}

/** Shared leading/trailing words, never role words, keeping one word per name. */
function sharedEnds(names: string[][]): { prefix: number; suffix: number } {
  if (names.length < 2) return { prefix: 0, suffix: 0 };
  const shortest = Math.min(...names.map((parts) => parts.length));
  const same = (at: (parts: string[]) => string | undefined) => {
    const word = at(names[0]);
    return (
      word !== undefined &&
      !isKept(word) &&
      names.every((parts) => at(parts) === word)
    );
  };
  let prefix = 0;
  while (prefix < shortest - 1 && same((parts) => parts[prefix])) prefix++;
  let suffix = 0;
  while (
    prefix + suffix < shortest - 1 &&
    same((parts) => parts[parts.length - 1 - suffix])
  )
    suffix++;
  return { prefix, suffix };
}

/**
 * Leading words a name shares with at least one other repository, so families
 * such as acme-platform-user-api / acme-platform-web-app shorten to their
 * distinct tails even when other repositories have unrelated names.
 */
function familyPrefix(
  names: string[][],
  index: number,
  suffix: number,
): number {
  const own = names[index];
  let best = 0;
  names.forEach((other, otherIndex) => {
    if (otherIndex === index) return;
    const limit = Math.min(own.length, other.length) - suffix - 1;
    let shared = 0;
    while (
      shared < limit &&
      own[shared] === other[shared] &&
      !isKept(own[shared])
    )
      shared++;
    best = Math.max(best, shared);
  });
  return best;
}

/** Neighbouring abbreviations run together: cu + on + api → cuon-api. */
function render(parts: string[], short: boolean[], letters: number): string {
  const groups: string[] = [];
  let run = "";
  parts.forEach((word, index) => {
    if (short[index]) {
      run += Array.from(word).slice(0, letters).join("");
      return;
    }
    if (run) groups.push(run);
    run = "";
    groups.push(word);
  });
  if (run) groups.push(run);
  return groups.join("-");
}

/** A single long word keeps its first letter, last letter and consonants. */
function contract(word: string, budget: number): string {
  const letters = Array.from(word);
  const skeleton = letters
    .filter(
      (letter, index) =>
        index === 0 ||
        index === letters.length - 1 ||
        !/^[aeiou]$/.test(letter.normalize("NFD").replace(/\p{M}/gu, "")),
    )
    .join("");
  return Array.from(skeleton).slice(0, budget).join("");
}

/**
 * Shorten words from the left to their first `letters` letters until the label
 * fits; role words and numbers stay whole: customer-user-api → cu-user-api.
 */
function shorten(parts: string[], budget: number, letters = 2): string {
  const full = parts.join("-") || "repo";
  if (length(full) <= budget) return full;
  if (parts.length === 1) return contract(parts[0], budget);
  const short = parts.map(() => false);
  let label = full;
  for (let index = 0; index < parts.length && length(label) > budget; index++) {
    if (isRole(parts[index]) || /^\p{N}+$/u.test(parts[index])) continue;
    short[index] = true;
    label = render(parts, short, letters);
  }
  return label;
}

function duplicates<T extends { label: string }>(entries: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const entry of entries)
    groups.set(entry.label, [...(groups.get(entry.label) ?? []), entry]);
  return [...groups.values()].filter((group) => group.length > 1);
}

/**
 * Short, readable repository labels (lowercase kebab-case):
 * 1. remove words every repository shares at the end, and leading words a
 *    repository shares with another one (never role words such as api, ui,
 *    admin, frontend, iac);
 * 2. if still longer than maxLength (default 14), shorten other words to their
 *    first two letters and keep role words whole;
 * 3. resolve duplicates by restoring removed leading words, more letters,
 *    then the parent folder.
 * Callers show the full name and path separately, e.g. in a tooltip.
 * Results are independent of input order.
 */
export function repositoryLabels(
  repos: readonly Repository[],
  options: RepositoryLabelOptions = {},
): Map<string, Label> {
  const requested = options.maxLength ?? 14;
  const budget = Number.isFinite(requested)
    ? Math.max(6, Math.floor(requested))
    : 14;
  const sorted = [...repos].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const names = sorted.map((repo) => words(repo.name));
  const { prefix, suffix } = sharedEnds(names);

  const entries = sorted.map((repo, index) => {
    const end = names[index].length - suffix;
    const family = Math.max(prefix, familyPrefix(names, index, suffix));
    const parts = names[index].slice(family, end);
    const label = shorten(parts, budget);
    const reasons: string[] = [];
    if (family || suffix) reasons.push("Removed shared words");
    if (label !== parts.join("-")) reasons.push("Shortened long words");
    const parent = repo.path.replace(/\\/g, "/").split("/").filter(Boolean);
    return {
      ...repo,
      parts,
      label,
      reasons,
      restored: names[index].slice(prefix, end),
      parents: parent.slice(0, -1),
    };
  });

  // Two families can end the same way (acme-user-api / beta-user-api):
  // bring their leading words back, shortened.
  for (const group of duplicates(entries))
    for (const entry of group) {
      entry.parts = entry.restored;
      entry.label = shorten(entry.parts, budget);
    }

  // Abbreviations that collide get a third letter, then full words if they fit.
  for (const group of duplicates(entries))
    for (const entry of group) entry.label = shorten(entry.parts, budget, 3);
  for (const group of duplicates(entries))
    for (const entry of group) {
      const full = entry.parts.join("-") || "repo";
      if (length(full) <= budget) entry.label = full;
    }

  // Same names in different folders: lead with the nearest parent folders,
  // adding levels only while a label still collides with any other label.
  const collides = (entry: (typeof entries)[number]) =>
    entries.some((other) => other !== entry && other.label === entry.label);
  for (const group of duplicates(entries)) {
    const base = group[0].label;
    const depth = Math.max(...group.map((entry) => entry.parents.length));
    let pending = group;
    for (let level = 1; level <= depth && pending.length; level++) {
      for (const entry of pending)
        entry.label = shorten(
          [...entry.parents.slice(-level).flatMap(words), ...entry.parts],
          budget,
        );
      pending = pending.filter(collides);
    }
    for (const entry of group)
      if (pending.includes(entry)) entry.label = base;
      else entry.reasons.push("Added parent folder");
  }

  // Names that only differ by punctuation: number them in stable ID order.
  const taken = new Set(entries.map((entry) => entry.label));
  for (const group of duplicates(entries))
    for (const entry of group.slice(1)) {
      let counter = 2;
      while (taken.has(`${entry.label}-${counter}`)) counter++;
      entry.label = `${entry.label}-${counter}`;
      taken.add(entry.label);
    }

  return new Map(
    entries.map((entry) => [
      entry.id,
      {
        label: entry.label,
        reason: entry.reasons.join("; ") || "Kept repository name",
      },
    ]),
  );
}
