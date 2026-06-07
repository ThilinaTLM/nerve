export function shouldStreamToolDraftArguments(
  toolName: string | undefined,
): boolean {
  return Boolean(toolName);
}
