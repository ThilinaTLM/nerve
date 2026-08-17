export const PROJECT_ENTRY_DRAG_MIME = "application/x-nerve-project-entries";

export type ProjectEntryDragItem = {
  path: string;
  kind: "file" | "directory";
};

type ProjectEntryDragPayload = {
  version: 1;
  entries: readonly ProjectEntryDragItem[];
};

function normalizeRelativeProjectPath(path: string): string | undefined {
  const normalized = path.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-zA-Z]:\//.test(normalized)
  ) {
    return undefined;
  }
  const segments = normalized.split("/");
  return segments.every(
    (segment) => segment !== "" && segment !== "." && segment !== "..",
  )
    ? normalized
    : undefined;
}

function normalizeProjectEntryDragItem(
  value: unknown,
): ProjectEntryDragItem | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Partial<ProjectEntryDragItem>;
  if (
    (item.kind !== "file" && item.kind !== "directory") ||
    typeof item.path !== "string"
  ) {
    return undefined;
  }
  const path = normalizeRelativeProjectPath(item.path);
  return path ? { path, kind: item.kind } : undefined;
}

export function serializeProjectEntryDrag(
  entries: readonly ProjectEntryDragItem[],
): string {
  const normalized = entries.map(normalizeProjectEntryDragItem);
  if (
    normalized.length === 0 ||
    !normalized.every(
      (entry): entry is ProjectEntryDragItem => entry !== undefined,
    )
  ) {
    throw new Error("Project entry drag payload contains invalid entries.");
  }
  return JSON.stringify({
    version: 1,
    entries: normalized,
  } satisfies ProjectEntryDragPayload);
}

export function parseProjectEntryDrag(
  value: string,
): ProjectEntryDragItem[] | undefined {
  if (!value) return undefined;
  try {
    const payload = JSON.parse(value) as Partial<ProjectEntryDragPayload>;
    if (
      payload.version !== 1 ||
      !Array.isArray(payload.entries) ||
      payload.entries.length === 0
    ) {
      return undefined;
    }
    const entries = payload.entries.map(normalizeProjectEntryDragItem);
    return entries.every(
      (entry): entry is ProjectEntryDragItem => entry !== undefined,
    )
      ? entries
      : undefined;
  } catch {
    return undefined;
  }
}

export function hasProjectEntryDragType(types: readonly string[]): boolean {
  return types.includes(PROJECT_ENTRY_DRAG_MIME);
}

export function formatProjectEntryReference(
  entry: ProjectEntryDragItem,
): string {
  const normalized = normalizeProjectEntryDragItem(entry);
  if (!normalized) {
    throw new Error("Project entry reference contains an invalid path.");
  }
  const reference = `@${normalized.path}${normalized.kind === "directory" ? "/" : ""}`;
  if (!/[\s"]/.test(reference)) return reference;
  return `"${reference.replaceAll('"', '\\"')}"`;
}

export function formatProjectEntryReferences(
  entries: readonly ProjectEntryDragItem[],
): string[] {
  return entries.map(formatProjectEntryReference);
}
