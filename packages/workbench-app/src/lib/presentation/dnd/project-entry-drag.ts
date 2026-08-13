export const PROJECT_ENTRY_DRAG_MIME = "application/x-nerve-project-entries";

export type ProjectEntryDragItem = {
  path: string;
  kind: "file" | "directory";
};

type ProjectEntryDragPayload = {
  version: 1;
  entries: readonly ProjectEntryDragItem[];
};

function isRelativeProjectPath(path: string): boolean {
  if (!path || path.startsWith("/") || path.startsWith("\\")) return false;
  if (/^[a-zA-Z]:[\\/]/.test(path)) return false;
  const segments = path.replaceAll("\\", "/").split("/");
  return segments.every(
    (segment) => segment !== "" && segment !== "." && segment !== "..",
  );
}

function isProjectEntryDragItem(value: unknown): value is ProjectEntryDragItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ProjectEntryDragItem>;
  return (
    (item.kind === "file" || item.kind === "directory") &&
    typeof item.path === "string" &&
    isRelativeProjectPath(item.path)
  );
}

export function serializeProjectEntryDrag(
  entries: readonly ProjectEntryDragItem[],
): string {
  if (entries.length === 0 || !entries.every(isProjectEntryDragItem)) {
    throw new Error("Project entry drag payload contains invalid entries.");
  }
  return JSON.stringify({
    version: 1,
    entries,
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
      payload.entries.length === 0 ||
      !payload.entries.every(isProjectEntryDragItem)
    ) {
      return undefined;
    }
    return payload.entries;
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
  const normalizedPath = entry.path.replaceAll("\\", "/");
  const reference = `@${normalizedPath}${entry.kind === "directory" ? "/" : ""}`;
  if (!/[\s"]/.test(reference)) return reference;
  return `"${reference.replaceAll('"', '\\"')}"`;
}

export function formatProjectEntryReferences(
  entries: readonly ProjectEntryDragItem[],
): string[] {
  return entries.map(formatProjectEntryReference);
}
