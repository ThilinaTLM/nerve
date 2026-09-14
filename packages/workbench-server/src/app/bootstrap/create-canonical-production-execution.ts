import { randomUUID } from "node:crypto";
import { CanonicalWorkbenchRunService } from "../../domains/runs/application/canonical-workbench-run.service.js";
import {
  CanonicalToolApplicationService,
  CanonicalToolInteractionApplicationService,
} from "../../domains/tools/execution/canonical-tool-application.service.js";
import { CanonicalToolQueryService } from "../../domains/tools/execution/canonical-tool-query.service.js";
import type { CanonicalToolRuntimeService } from "../../domains/tools/execution/canonical-tool-runtime.service.js";
import type { WorkbenchAgentMechanics } from "../../domains/agents/execution/workbench-agent-mechanics.js";
import type { RuntimeState } from "../runtime/runtime-projections.js";
import type { InitializedStorage } from "../../infrastructure/storage-bootstrap/index.js";
import type { CanonicalCompactionSummaryPreparer } from "../../domains/conversations/timeline/canonical-compaction-summary-preparer.js";
import type { CanonicalConversationApplicationService } from "../../domains/conversations/timeline/canonical-conversation-application.service.js";
import type { timelineRuntime } from "./create-canonical-timeline-runtime.js";

export function createCanonicalProductionExecution(input: {
  timeline: ReturnType<typeof timelineRuntime>;
  state: RuntimeState;
  storage: InitializedStorage;
  mechanics: WorkbenchAgentMechanics;
  tools: CanonicalToolRuntimeService;
  conversations: CanonicalConversationApplicationService;
  summaryPreparer: CanonicalCompactionSummaryPreparer;
}) {
  const getAgentForConversation = (conversationId: string) =>
    [...input.state.agents.values()].find(
      (agent) =>
        agent.conversationId === conversationId && !agent.parentAgentId,
    ) ??
    [...input.state.agents.values()].find(
      (agent) => agent.conversationId === conversationId,
    );
  const execution = input.timeline.createExecutionRuntime({
    workerId: `canonical-runtime-${randomUUID()}`,
    mechanics: input.mechanics,
    tools: input.tools,
    getAgentForConversation,
    getConversationCreatedAt: (conversationId) =>
      input.conversations.getConversation(conversationId).createdAt,
    prepareCompactionSummary: (summary) =>
      input.summaryPreparer.prepare(summary),
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
  const toolQueries = new CanonicalToolQueryService(
    input.storage.canonicalStore,
  );
  const toolApplication = new CanonicalToolApplicationService(
    input.tools,
    toolQueries,
  );
  const toolInteractions = new CanonicalToolInteractionApplicationService(
    input.timeline.createInteractionResolution(
      input.tools,
      getAgentForConversation,
    ),
    toolQueries,
  );
  return {
    execution,
    runs,
    toolApplication,
    toolInteractions,
  };
}
