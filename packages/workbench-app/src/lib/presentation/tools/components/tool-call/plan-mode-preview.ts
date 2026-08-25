export function planReviewContent(
  resultContent: string | undefined,
  hydratedContent: string | undefined,
): string {
  return hydratedContent ?? resultContent ?? "";
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
