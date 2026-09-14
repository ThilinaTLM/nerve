import type { AgentRecord } from "@nervekit/contracts/agents";
import type { CanonicalLifecycleWork } from "@nervekit/contracts/runs";
import type { ToolCallRecord, ToolName } from "@nervekit/contracts/tools";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import type { CanonicalToolExternalInvoker } from "../../tools/execution/canonical-tool-external-invoker.js";
import { CanonicalToolInvocationService } from "./canonical-tool-invocation.service.js";
import { CanonicalToolSettlementService } from "./canonical-tool-settlement.service.js";

interface CanonicalToolInputManifest {
  schemaVersion: 1;
  effectId: string;
  toolName: ToolName;
  providerToolCallId: string;
  normalizedInputFingerprint: string;
  normalizedInput: Record<string, unknown>;
  cwd: string;
  risk: ToolCallRecord["risk"];
  providerIdentity: Record<string, unknown>;
  providerCapability:
    | "stateless_generation"
    | "contractually_replay_safe"
    | "non_repeatable_or_unknown";
}

/** Executes one canonical tool obligation through the repository-free host boundary. */
export class CanonicalToolWorkerService {
  private readonly invocation: CanonicalToolInvocationService;
  private readonly settlement: CanonicalToolSettlementService;

  constructor(
    private readonly store: CanonicalStore,
    private readonly external: CanonicalToolExternalInvoker,
  ) {
    this.invocation = new CanonicalToolInvocationService(store);
    this.settlement = new CanonicalToolSettlementService(store);
  }

  async execute(input: {
    agent: AgentRecord;
    claimWork: CanonicalLifecycleWork;
    workerId: string;
    now: string;
    signal?: AbortSignal;
    revalidatePolicy(input: {
      effectId: string;
      authorizationId: string;
      normalizedInputFingerprint: string;
    }): Promise<boolean>;
  }): Promise<ToolCallRecord> {
    const authorized = await this.invocation.prepareForDispatch({
      claimWork: input.claimWork,
      workerId: input.workerId,
      now: input.now,
      revalidatePolicy: input.revalidatePolicy,
    });
    if (authorized.kind === "rejected") {
      throw new Error(
        `Canonical tool invocation rejected: ${authorized.outcome.kind}.`,
      );
    }
    const manifestId = authorized.snapshot.work.inputManifestId;
    const manifest = manifestId
      ? parseManifest(
          await this.store.execution.readArtifactManifest(manifestId),
        )
      : undefined;
    if (
      !manifest ||
      manifest.effectId !== authorized.snapshot.effect.effectId ||
      manifest.normalizedInputFingerprint !==
        authorized.snapshot.effect.normalizedInputFingerprint ||
      manifest.providerToolCallId !==
        authorized.snapshot.waitGroup.members.find(
          (member) => member.memberId === authorized.snapshot.effect.memberId,
        )?.ownerId
    ) {
      throw new Error(
        "Canonical tool input manifest does not match authority.",
      );
    }
    const terminal = await this.external.invoke({
      agent: input.agent,
      effectId: authorized.snapshot.effect.effectId,
      attemptId: authorized.snapshot.attempt.attemptId,
      providerToolCallId: manifest.providerToolCallId,
      toolName: manifest.toolName,
      normalizedArgs: manifest.normalizedInput,
      cwd: manifest.cwd,
      risk: manifest.risk,
      runId: authorized.snapshot.runId,
      options: { signal: input.signal },
    });
    const result = await this.settlement.commitResult({
      snapshot: authorized.snapshot,
      workerId: input.workerId,
      resultEntryId: `entry_tool_result_${authorized.snapshot.effect.effectId.slice("effect_".length)}`,
      result: terminal,
      failed: terminal.status !== "completed",
      providerIdentity: manifest.providerIdentity,
      providerCapability: manifest.providerCapability,
      now: new Date().toISOString(),
    });
    if (result.kind === "rejected") {
      throw new Error(
        `Canonical tool settlement rejected: ${result.outcome.kind}.`,
      );
    }
    return terminal;
  }
}

function parseManifest(value: unknown): CanonicalToolInputManifest | undefined {
  const input = value as Partial<CanonicalToolInputManifest> | undefined;
  return input?.schemaVersion === 1 &&
    typeof input.effectId === "string" &&
    typeof input.toolName === "string" &&
    typeof input.providerToolCallId === "string" &&
    typeof input.normalizedInputFingerprint === "string" &&
    typeof input.normalizedInput === "object" &&
    input.normalizedInput !== null &&
    typeof input.cwd === "string" &&
    typeof input.risk === "string" &&
    typeof input.providerIdentity === "object" &&
    input.providerIdentity !== null &&
    typeof input.providerCapability === "string"
    ? (input as CanonicalToolInputManifest)
    : undefined;
}
