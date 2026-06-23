const nonStreamingToolDrafts = new Set(["write", "edit"]);
const progressStreamingToolDrafts = new Set(["write", "edit"]);

export function shouldStreamToolDraftArguments(
  toolName: string | undefined,
): boolean {
  if (!toolName) return false;
  return !nonStreamingToolDrafts.has(toolName);
}

export function shouldPublishToolDraftProgress(
  toolName: string | undefined,
): boolean {
  if (!toolName) return false;
  return progressStreamingToolDrafts.has(toolName);
}
