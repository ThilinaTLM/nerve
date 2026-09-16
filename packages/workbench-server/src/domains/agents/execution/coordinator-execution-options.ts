import type { PromptRequest } from "@nervekit/contracts/agents";
import type { ToolName } from "@nervekit/contracts/tools";
import type { AgentMessage, AgentTool } from "@nervekit/harness/agent";
import type { CanonicalToolProposalInput } from "../../conversations/timeline/canonical-tool-batch.js";
import type { RunRecord } from "@nervekit/contracts/runs";
import type { WorkbenchLiveExecutionControl } from "../../runs/application/run-live-executions.js";
import type { CanonicalLifecycleWork } from "@nervekit/contracts/runs";
import type {
  CanonicalRunExecutionBoundary,
  CanonicalRunExecutionSession,
} from "./canonical-run-execution-boundary.js";
import type { CanonicalProviderDispatchSnapshot } from "../../conversations/timeline/canonical-provider-dispatch.service.js";
import type { CanonicalProviderInvocationService } from "../../conversations/timeline/canonical-provider-invocation.service.js";
import type { CanonicalProviderSettlementService } from "../../conversations/timeline/canonical-provider-settlement.service.js";

export interface CoordinatorExecutionOptions {
  run: RunRecord;
  command: "start" | "continue";
  prompt?: string;
  images?: PromptRequest["images"];
  signal: AbortSignal;
  installControl(control: WorkbenchLiveExecutionControl): void;
  canonical: {
    session: CanonicalRunExecutionSession;
    boundary: CanonicalRunExecutionBoundary;
    providerInvocation: CanonicalProviderInvocationService;
    providerSettlement: CanonicalProviderSettlementService;
    providerWork: CanonicalLifecycleWork;
    tools: AgentTool[];
    activeToolNames: readonly ToolName[];
    prepareToolProposals(
      message: AgentMessage,
    ): Promise<readonly CanonicalToolProposalInput[]>;
    workerId: string;
    retryPolicy: { enabled: boolean; maxRetries: number; baseDelayMs: number };
    activeProviderSnapshot?: CanonicalProviderDispatchSnapshot;
    now(): string;
  };
}
