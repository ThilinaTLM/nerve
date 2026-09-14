import type { PromptRequest } from "@nervekit/contracts/agents";
import type { RunRecord } from "@nervekit/contracts/runs";
import type {
  CheckpointCommand,
  RunExecutionSink,
} from "../../runs/runtime/index.js";
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
  sink: RunExecutionSink;
  command: "start" | "continue";
  prompt?: string;
  images?: PromptRequest["images"];
  signal: AbortSignal;
  installControl(control: WorkbenchLiveExecutionControl): void;
  checkpointCommand(
    boundary: CheckpointCommand["boundary"],
    interactionId?: string,
  ): Promise<CheckpointCommand>;
  canonical?: {
    session: CanonicalRunExecutionSession;
    boundary: CanonicalRunExecutionBoundary;
    providerInvocation: CanonicalProviderInvocationService;
    providerSettlement: CanonicalProviderSettlementService;
    providerWork: CanonicalLifecycleWork;
    workerId: string;
    activeProviderSnapshot?: CanonicalProviderDispatchSnapshot;
    now(): string;
  };
}
