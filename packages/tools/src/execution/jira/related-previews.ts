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

export function formatJiraCommentPreview(item: {
  id?: string;
  author?: string;
  created?: string;
  bodyPreview?: string;
}): string {
  return `- ${item.id ?? "unknown id"}${item.author ? ` · ${item.author}` : ""}${item.created ? ` · ${item.created}` : ""}${item.bodyPreview ? ` — ${item.bodyPreview}` : ""}`;
}
