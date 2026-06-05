export const NON_STREAMING_TOOL_DRAFT_ARGUMENTS = new Set<string>([
  "write",
  "edit",
]);

export function shouldStreamToolDraftArguments(
  toolName: string | undefined,
): boolean {
  if (!toolName) return false;
  return !NON_STREAMING_TOOL_DRAFT_ARGUMENTS.has(toolName);
}
