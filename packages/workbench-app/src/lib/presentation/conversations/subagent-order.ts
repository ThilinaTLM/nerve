/** Fields shared by child summaries and presentation agent records. */
export type SubagentOrderKey = {
  id: string;
  lastParentPromptAt?: string | null | undefined;
  createdAt: string;
  name?: string | undefined;
  title?: string | undefined;
};

function timestamp(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Newest parent prompt first, never latest activity or runtime status. */
export function compareSubagents(
  a: SubagentOrderKey,
  b: SubagentOrderKey,
): number {
  return (
    timestamp(b.lastParentPromptAt) - timestamp(a.lastParentPromptAt) ||
    timestamp(b.createdAt) - timestamp(a.createdAt) ||
    (a.name ?? a.title ?? "")
      .trim()
      .localeCompare((b.name ?? b.title ?? "").trim()) ||
    a.id.localeCompare(b.id)
  );
}
