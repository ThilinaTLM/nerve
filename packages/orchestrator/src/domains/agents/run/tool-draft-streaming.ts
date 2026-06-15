const nonStreamingToolDrafts = new Set(["write", "edit"]);

export function shouldStreamToolDraftArguments(
  toolName: string | undefined,
): boolean {
  return Boolean(toolName && !nonStreamingToolDrafts.has(toolName));
}
