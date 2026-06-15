const nonStreamingToolDrafts = new Set(["write", "edit", "python"]);

export function shouldStreamToolDraftArguments(
  toolName: string | undefined,
): boolean {
  return Boolean(toolName && !nonStreamingToolDrafts.has(toolName));
}
