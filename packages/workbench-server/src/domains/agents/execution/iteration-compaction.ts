import type { AgentHarness } from "@nervekit/harness";
import type { CompactionOutcome } from "../../conversations/operations/compaction-service.js";

/** Partial tool batches must remain contiguous in the owner model tree. */
export function installIterationCompaction(
  harness: Pick<AgentHarness, "on">,
  compact: (signal?: AbortSignal) => Promise<CompactionOutcome>,
  continuation: () => string | undefined,
): void {
  harness.on("iteration_boundary", async (event) => {
    if (event.hasMoreToolCalls) return undefined;
    const outcome = await compact(event.signal);
    if (
      outcome.status !== "compacted" ||
      event.message.content.some((item) => item.type === "toolCall")
    )
      return undefined;
    const followUp = continuation();
    return followUp ? { followUp } : undefined;
  });
}
