export type ProjectEntryDragItem = {
  path: string;
  kind: "file" | "directory";
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

export function normalizeProjectEntryDragItem(
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
