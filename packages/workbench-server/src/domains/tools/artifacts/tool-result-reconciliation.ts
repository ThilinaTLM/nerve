import type { ConversationJournalRepository } from "../../conversations/conversation-journal.repository.js";
import type { ToolResultPayloadStore } from "./tool-result-payload-store.js";

export async function reconcileToolResultPayloads(
  journal: Pick<ConversationJournalRepository, "scanToolCalls">,
  payloads: Pick<ToolResultPayloadStore, "path" | "reconcile">,
): Promise<void> {
  const referenced = new Set<string>();
  let afterId: string | undefined;
  for (;;) {
    const page = await journal.scanToolCalls({
      ...(afterId ? { afterId } : {}),
      maxRows: 256,
      maxBytes: 8 * 1024 * 1024,
    });
    for (const toolCall of page.records) {
      if (toolCall.resultPayload) {
        referenced.add(payloads.path(toolCall.resultPayload));
      }
    }
    if (page.done) break;
    if (!page.nextCursor) {
      throw new Error("Canonical tool-call scan did not advance.");
    }
    afterId = page.nextCursor;
  }
  await payloads.reconcile(referenced);
}
