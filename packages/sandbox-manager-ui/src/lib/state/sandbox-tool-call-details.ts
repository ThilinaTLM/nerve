import type { ConversationRenderState } from "@nervekit/conversation-ui/state";
import type { ToolCallRecord } from "@nervekit/shared";

/**
 * Resolve a full `ToolCallRecord` for the tool-call details dialog from the
 * conversation snapshot's transcript records. The sandbox transcript carries
 * `argsPreview`/`resultPreview` rather than the raw `args`/`result`, so those
 * previews are promoted to satisfy the fuller record shape the dialog expects.
 * The details dialog reads previews when the raw payloads are absent, so this
 * gives complete parity without an extra round-trip.
 */
export function resolveToolCallDetails(
  richState: ConversationRenderState | undefined,
  toolCallId: string,
): ToolCallRecord {
  const record = (richState?.toolCalls ?? []).find(
    (call) => call.id === toolCallId,
  );
  if (!record) {
    throw new Error("Tool call is no longer available in this transcript.");
  }
  const { argsPreview, resultPreview, previewOverflow, ...base } = record;
  void previewOverflow;
  return {
    ...base,
    args: argsPreview,
    result: resultPreview,
  } as ToolCallRecord;
}
