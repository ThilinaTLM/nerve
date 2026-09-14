import type { AgentMessage } from "@nervekit/harness/agent";
import type { ConversationEntry } from "@nervekit/contracts/conversations";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type { CanonicalProviderSettlementService } from "../../conversations/timeline/canonical-provider-settlement.service.js";
import type { CanonicalProviderDispatchSnapshot } from "../../conversations/timeline/canonical-provider-dispatch.service.js";
import type { CanonicalRunExecutionSession } from "./canonical-run-execution-boundary.js";
import {
  projectHarnessCanonicalEntry,
  projectHarnessMessageEntry,
} from "./message-mirror.js";

/** Commits one assistant response without legacy transcript persistence. */
export async function settleCanonicalHarnessProviderResponse(input: {
  agent: AgentRecord;
  session: CanonicalRunExecutionSession;
  settlement: CanonicalProviderSettlementService;
  snapshot: CanonicalProviderDispatchSnapshot;
  workerId: string;
  response: AgentMessage;
  now: string;
  prepareToolProposals(
    message: AgentMessage,
  ): Promise<
    Parameters<
      CanonicalProviderSettlementService["commitResponse"]
    >[0]["toolProposals"]
  >;
}): Promise<ConversationEntry[]> {
  const toolProposals = await input.prepareToolProposals(input.response);
  const pending = (await input.session.storage.getEntries()).filter(
    (entry) =>
      entry.type === "message" &&
      !input.session.materializedEntryIds.has(entry.id),
  );
  const result = await input.settlement.commitResponse({
    snapshot: input.snapshot,
    workerId: input.workerId,
    response: input.response,
    toolProposals,
    entries: pending.flatMap((entry) =>
      entry.type === "message"
        ? [projectHarnessCanonicalEntry({ entry, agentId: input.agent.id })]
        : [],
    ),
    now: input.now,
  });
  if (result.kind === "rejected") {
    throw new Error(
      `Canonical provider settlement rejected: ${result.outcome.kind}.`,
    );
  }
  for (const entry of pending) input.session.materializedEntryIds.add(entry.id);
  return pending.flatMap((entry) => {
    if (entry.type !== "message") return [];
    const projected = projectHarnessMessageEntry({
      entry,
      conversationId: input.agent.conversationId,
      agentId: input.agent.id,
    });
    return projected ? [projected] : [];
  });
}
