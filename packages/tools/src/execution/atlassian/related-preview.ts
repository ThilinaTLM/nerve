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
      : `Showing first ${items.length} of ${total}; complete data is unavailable.`,
  );
}
