import type { AgentRecord } from "@nervekit/contracts/agents";
import type { WorkbenchAgentMechanics } from "./workbench-agent-mechanics.js";

/** Allocate and announce the provider turn before its effective snapshot is committed. */
export function startWorkbenchLiveTurn(
  mechanics: WorkbenchAgentMechanics,
  agent: AgentRecord,
  runId: string,
): string {
  const turn = mechanics.deps.state.conversationRuntime.startTurn(runId);
  mechanics.deps.events.publishBestEffort(
    "conversation.live.turn.started",
    {
      conversationId: agent.conversationId,
      agentId: agent.id,
      projectId: agent.projectId,
      runId,
      turnId: turn.turnId,
      ordinal: turn.ordinal,
    },
    "conversation.live.turn.started",
  );
  return turn.turnId;
}
