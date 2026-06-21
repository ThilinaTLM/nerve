const nonStreamingToolDrafts = new Set(["write", "edit", "smart_edit"]);
const progressStreamingToolDrafts = new Set(["write", "edit", "smart_edit"]);

export function shouldStreamToolDraftArguments(
  toolName: string | undefined,
): boolean {
  return Boolean(toolName && !nonStreamingToolDrafts.has(toolName));
}

export function shouldPublishToolDraftProgress(
  toolName: string | undefined,
): boolean {
  return Boolean(toolName && progressStreamingToolDrafts.has(toolName));
}
