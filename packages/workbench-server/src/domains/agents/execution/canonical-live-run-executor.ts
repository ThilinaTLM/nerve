import type { AgentRecord } from "@nervekit/contracts/agents";
import type { CanonicalLifecycleWork } from "@nervekit/contracts/runs";
import type { ToolName } from "@nervekit/contracts/tools";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import type { ToolService } from "../../tools/execution/tool-service.js";
import type { CanonicalToolWorkerService } from "../../conversations/timeline/canonical-tool-worker.service.js";
import { createCanonicalAgentTools } from "./canonical-agent-tools.js";
import type { CanonicalHarnessLifecycleExecutor } from "./canonical-harness-lifecycle-executor.js";
import type { WorkbenchAgentMechanics } from "./workbench-agent-mechanics.js";

/** Composes canonical provider and tool execution for one leased provider work item. */
export class CanonicalLiveRunExecutor {
  constructor(
    private readonly deps: {
      store: CanonicalStore;
      mechanics: WorkbenchAgentMechanics;
      harness: CanonicalHarnessLifecycleExecutor;
      toolWorker: CanonicalToolWorkerService;
      tools: ToolService;
    },
  ) {}

  async execute(input: {
    agent: AgentRecord;
    providerWork: CanonicalLifecycleWork;
    workerId: string;
    activeToolNames: readonly ToolName[];
    conversationCreatedAt: string;
    signal: AbortSignal;
  }): Promise<void> {
    const tools = createCanonicalAgentTools({
      store: this.deps.store,
      worker: this.deps.toolWorker,
      workerId: input.workerId,
      agent: input.agent,
      runId: input.providerWork.runId,
      activeToolNames: input.activeToolNames,
      tools: this.deps.tools,
    });
    await this.deps.harness.execute({
      agent: input.agent,
      providerWork: input.providerWork,
      workerId: input.workerId,
      conversationCreatedAt: input.conversationCreatedAt,
      signal: input.signal,
      tools,
      prepareToolProposals: (message) =>
        this.deps.mechanics.prepareCanonicalToolProposals(input.agent, message),
      now: () => new Date().toISOString(),
    });
  }
}
