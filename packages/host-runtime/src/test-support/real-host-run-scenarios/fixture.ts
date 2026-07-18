import type {
  PromptImage,
  RunInteractionRecord,
  ToolCallTranscriptRecord,
} from "@nervekit/contracts";
import type { RunHydratedState } from "../../run-unit-of-work.js";

export const REAL_HOST_PLAN_PATH = "__NERVE_REAL_HOST_PLAN_PATH__";

export type RealHostScriptedStep =
  | { type: "assistantText"; text?: string; chunks?: string[] }
  | { type: "toolCall"; id: string; name: string; args: unknown }
  | { type: "providerError"; message: string; retryable?: boolean }
  | { type: "waitForAbort" };

export interface RealHostScenarioPreparation {
  name: string;
  steps: RealHostScriptedStep[];
  mode?: "coding" | "planning";
  permissionLevel?: "read_only" | "supervised" | "autonomous";
  planContent?: string;
}

export interface NormalizedHostRunSnapshot {
  runId: string;
  status: string;
  entries: Array<{ id: string; role: string; text: string }>;
  toolCalls: Array<{
    id: string;
    toolName: string;
    status: string;
    resultPreview?: unknown;
  }>;
}

export interface RealHostEventObservation {
  id: string;
  type: string;
  delivery: string;
  runId?: string;
  sequence: number;
}

export interface PendingInteractionObservation {
  interactionId: string;
  externalId: string;
  toolCallId: string;
  kind: RunInteractionRecord["kind"];
  status: RunInteractionRecord["status"];
  checkpointId: string;
}

export type CheckpointFault = "missing" | "stale" | "corrupt";

export interface RealHostScenarioSession {
  readonly name: string;
  readonly planPath?: string;
  start(prompt: string, images?: PromptImage[]): Promise<string>;
  steer(runId: string, text: string, images?: PromptImage[]): Promise<string>;
  followUp(
    runId: string,
    text: string,
    images?: PromptImage[],
  ): Promise<string>;
  continue(runId: string): Promise<void>;
  cancel(runId: string): Promise<void>;
  cancelPrompt(runId: string, promptId: string): Promise<void>;
  answerQuestion(externalId: string, answer: string): Promise<void>;
  dismissQuestion(externalId: string, reason?: string): Promise<void>;
  resolveApproval(
    externalId: string,
    decision: "allow" | "deny",
  ): Promise<void>;
  resolvePlan(
    externalId: string,
    decision: "accept" | "request_changes",
    feedback?: string,
  ): Promise<void>;
  restart(): Promise<void>;
  load(runId: string): Promise<RunHydratedState | undefined>;
  snapshot(runId: string): Promise<NormalizedHostRunSnapshot>;
  events(runId: string): Promise<RealHostEventObservation[]>;
  tools(runId: string): Promise<ToolCallTranscriptRecord[]>;
  pendingInteraction(
    runId: string,
    kind?: RunInteractionRecord["kind"],
  ): Promise<PendingInteractionObservation | undefined>;
  waitForStatus(runId: string, statuses: string[]): Promise<RunHydratedState>;
  waitForToolStatus(runId: string, status: string): Promise<void>;
  faultCheckpoint(runId: string, fault: CheckpointFault): Promise<void>;
  removeDeliveryMarker(runId: string, eventType: string): Promise<void>;
  dispose(): Promise<void>;
}

export interface RealHostRunMatrixFixture {
  prepare(
    options: RealHostScenarioPreparation,
  ): Promise<RealHostScenarioSession>;
}

export interface RealHostScenarioSummary {
  name: string;
  runs: number;
  assertions: number;
}

export interface RealHostRunMatrixResult {
  scenarios: RealHostScenarioSummary[];
  totalRuns: number;
  totalAssertions: number;
}
