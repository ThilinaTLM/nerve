const RELATED_PREVIEW_LIMIT = 3;

export function summarizeRelated<T>(
  value: unknown,
  summarize: (item: unknown) => T | undefined,
): { items: T[]; total: number } {
  const raw = Array.isArray(value) ? value : [];
  const summaries = raw.flatMap((item) => {
    const summary = summarize(item);
    return summary ? [summary] : [];
  });
  return {
    items: summaries.slice(0, RELATED_PREVIEW_LIMIT),
    total: summaries.length,
  };
}

export function appendRelatedPreview<T>(
  lines: string[],
  label: string,
  items: T[],
  total: number,
  artifactPath: string | undefined,
  format: (item: T) => string,
): void {
  lines.push(`${label}: ${total}`);
  if (items.length > 0) lines.push(...items.map(format));
  if (total <= items.length) return;
  lines.push(
    artifactPath
      ? `Showing first ${items.length} of ${total}; full data is saved to ${artifactPath}.`
      : `Showing first ${items.length} of ${total}; rerun with save_to_file: true for full data.`,
  );
}

export function formatJiraCommentPreview(item: {
  id?: string;
  author?: string;
  created?: string;
  bodyPreview?: string;
}): string {
  return `- ${item.id ?? "unknown id"}${item.author ? ` · ${item.author}` : ""}${item.created ? ` · ${item.created}` : ""}${item.bodyPreview ? ` — ${item.bodyPreview}` : ""}`;
}
