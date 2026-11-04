/** Pure project-relative path helpers shared by file operations and drag and drop. */

export function parentPath(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

export function isSameOrDescendant(path: string, ancestor: string): boolean {
  return (
    ancestor === "" || path === ancestor || path.startsWith(`${ancestor}/`)
  );
}

/** Rewrites `path` when it equals or lives under `from`, otherwise returns it. */
export function retargetPath(path: string, from: string, to: string): string {
  if (path === from) return to;
  if (path.startsWith(`${from}/`)) return `${to}${path.slice(from.length)}`;
  return path;
}

/** Selection length for the rename editor: the base name without its extension. */
export function renameSelectionEnd(name: string, isDirectory: boolean): number {
  if (isDirectory) return name.length;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? dot : name.length;
}

export function validateEntryName(
  name: string,
  siblings: ReadonlySet<string>,
  current?: string,
): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return "Enter a name.";
  if (trimmed === "." || trimmed === "..") return "That name is not allowed.";
  if (/[\\/]/.test(trimmed)) return "Names cannot contain slashes.";
  if (trimmed !== current && siblings.has(trimmed))
    return `“${trimmed}” already exists here.`;
  return undefined;
}

/** `name copy.ext`, `name copy 2.ext`, … — the first name not in `taken`. */
export function duplicateName(
  name: string,
  isDirectory: boolean,
  taken: ReadonlySet<string>,
): string {
  const dot = isDirectory ? -1 : name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  for (let index = 1; ; index += 1) {
    const candidate = `${stem} copy${index === 1 ? "" : ` ${index}`}${extension}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export type DropDecision =
  | { ok: true; moves: Array<{ from: string; to: string }> }
  | { ok: false; reason: string };

/**
 * Validates dropping `sources` into the directory `target` ("" is the root).
 * Dropping into a source itself or its descendants is refused; entries that are
 * already in `target` are skipped for moves (copies get a new name instead).
 */
export function planDrop(
  sources: ReadonlyArray<{ path: string; kind: "file" | "directory" }>,
  target: string,
  mode: "move" | "copy",
): DropDecision {
  const moves: Array<{ from: string; to: string }> = [];
  const seen = new Set<string>();
  for (const source of sources) {
    if (source.path === "")
      return { ok: false, reason: "Cannot move the root." };
    if (source.kind === "directory" && isSameOrDescendant(target, source.path))
      return { ok: false, reason: "Cannot drop a folder into itself." };
    if (mode === "move" && parentPath(source.path) === target) continue;
    const to = joinPath(target, baseName(source.path));
    if (seen.has(to))
      return { ok: false, reason: "Two items would have the same name." };
    seen.add(to);
    moves.push({ from: source.path, to });
  }
  if (moves.length === 0)
    return { ok: false, reason: "Already in that folder." };
  return { ok: true, moves };
}

/** Drops entries nested under another entry of the list (they move with it). */
export function topLevelPaths(paths: readonly string[]): string[] {
  const sorted = [...new Set(paths)].sort(
    (left, right) => left.length - right.length,
  );
  const result: string[] = [];
  for (const path of sorted) {
    if (!result.some((kept) => isSameOrDescendant(path, kept)))
      result.push(path);
  }
  return paths.filter((path) => result.includes(path));
}
