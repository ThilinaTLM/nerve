export function planReviewContent(
  resultContent: string | undefined,
  hydratedContent: string | undefined,
  summaryContent?: string,
): string {
  return hydratedContent ?? resultContent ?? summaryContent ?? "";
}

export function planReviewPreview(
  content: string,
  expanded: boolean,
  collapsedLines: number,
): string {
  if (expanded) return content;
  const lines = content.split("\n");
  return lines.length > collapsedLines
    ? lines.slice(0, collapsedLines).join("\n")
    : content;
}
