import type { AgentRecord } from "@nervekit/contracts/agents";
import type { CanonicalLifecycleWork } from "@nervekit/contracts/runs";
import type { ToolCallRecord, ToolName } from "@nervekit/contracts/tools";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import type { CanonicalToolExternalInvoker } from "../../tools/execution/canonical-tool-external-invoker.js";
import type { CanonicalToolRuntimeService } from "../../tools/execution/canonical-tool-runtime.service.js";
import { CanonicalInteractionResolutionService } from "./canonical-interaction-resolution.service.js";
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
    private readonly tools: CanonicalToolRuntimeService,
  ) {
    this.invocation = new CanonicalToolInvocationService(store);
    this.settlement = new CanonicalToolSettlementService(store);
  }

  async executeInternal(input: {
    agent: AgentRecord;
    work: CanonicalLifecycleWork;
    now: string;
    signal?: AbortSignal;
  }): Promise<ToolCallRecord> {
    if (
      input.work.kind !== "execute_internal_command" ||
      input.work.state !== "leased" ||
      !input.work.inputManifestId
    ) {
      throw new Error("Canonical internal command work is not owned.");
    }
    const manifest = parseInternalManifest(
      await this.store.execution.readArtifactManifest(
        input.work.inputManifestId,
      ),
    );
    if (
      !manifest ||
      manifest.normalizedInputFingerprint !== input.work.inputHash
    ) {
      throw new Error("Canonical internal command manifest is invalid.");
    }
    const terminal = await this.external.invoke({
      agent: input.agent,
      effectId: `effect_internal_${manifest.suffix}`,
      attemptId: `attempt_internal_${manifest.suffix}`,
      providerToolCallId: manifest.providerToolCallId,
      toolName: manifest.toolName,
      normalizedArgs: manifest.normalizedInput,
      cwd: manifest.cwd,
      risk: manifest.risk,
      runId: input.work.runId,
      options: { signal: input.signal },
    });
    const responseText =
      terminal.result === undefined
        ? (terminal.error ?? "Internal command completed.")
        : JSON.stringify(terminal.result);
    const settled = await new CanonicalInteractionResolutionService(
      this.store,
      this.tools,
      () => input.agent,
    ).resolve({
      providerToolCallId: `tool_${manifest.suffix}`,
      decision: "answer",
      responseText,
      settleWork: input.work,
      commandId: `settle-internal:${input.work.workId}:${input.work.generation}`,
      now: new Date().toISOString(),
    });
    if (settled.kind === "rejected") {
      throw new Error(
        `Canonical internal command settlement rejected: ${settled.outcome.kind}.`,
      );
    }
    return terminal;
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
      `tool_${authorized.snapshot.effect.effectId.slice("effect_".length)}` !==
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

interface CanonicalInternalCommandManifest {
  schemaVersion: 1;
  suffix: string;
  toolName: ToolName;
  providerToolCallId: string;
  normalizedInputFingerprint: string;
  normalizedInput: Record<string, unknown>;
  cwd: string;
  risk: ToolCallRecord["risk"];
}

function parseInternalManifest(
  value: unknown,
): CanonicalInternalCommandManifest | undefined {
  const input = value as Partial<CanonicalInternalCommandManifest> | undefined;
  return input?.schemaVersion === 1 &&
    typeof input.suffix === "string" &&
    typeof input.toolName === "string" &&
    typeof input.providerToolCallId === "string" &&
    typeof input.normalizedInputFingerprint === "string" &&
    typeof input.normalizedInput === "object" &&
    input.normalizedInput !== null &&
    typeof input.cwd === "string" &&
    typeof input.risk === "string"
    ? (input as CanonicalInternalCommandManifest)
    : undefined;
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
