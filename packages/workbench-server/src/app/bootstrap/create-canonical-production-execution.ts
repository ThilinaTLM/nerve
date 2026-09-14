import { randomUUID } from "node:crypto";
import { CanonicalWorkbenchRunService } from "../../domains/runs/application/canonical-workbench-run.service.js";
import type { ToolService } from "../../domains/tools/execution/tool-service.js";
import type { WorkbenchAgentMechanics } from "../../domains/agents/execution/workbench-agent-mechanics.js";
import type { RuntimeState } from "../runtime/runtime-projections.js";
import type { InitializedStorage } from "../../infrastructure/storage-bootstrap/index.js";
import type { CanonicalConversationApplicationService } from "../../domains/conversations/timeline/canonical-conversation-application.service.js";
import type { timelineRuntime } from "./create-canonical-timeline-runtime.js";

export function createCanonicalProductionExecution(input: {
  timeline: ReturnType<typeof timelineRuntime>;
  state: RuntimeState;
  storage: InitializedStorage;
  mechanics: WorkbenchAgentMechanics;
  tools: ToolService;
  conversations: CanonicalConversationApplicationService;
}) {
  const execution = input.timeline.createExecutionRuntime({
    workerId: `canonical-runtime-${randomUUID()}`,
    mechanics: input.mechanics,
    tools: input.tools,
    getAgentForConversation: (conversationId) =>
      [...input.state.agents.values()].find(
        (agent) =>
          agent.conversationId === conversationId && !agent.parentAgentId,
      ),
    getConversationCreatedAt: (conversationId) =>
      input.conversations.getConversation(conversationId).createdAt,
    onForegroundClosed: async (conversationId) => {
      await runs.acceptNextQueuedPrompt(conversationId);
    },
  });
  const runs = new CanonicalWorkbenchRunService({
    state: input.state,
    store: input.storage.canonicalStore,
    starts: input.timeline.runStart,
    termination: input.timeline.runTermination,
    mechanics: input.mechanics,
    execution,
  });
  return { execution, runs };
}
