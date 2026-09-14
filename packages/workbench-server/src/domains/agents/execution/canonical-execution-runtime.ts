import {
  deriveAutoCompactionPolicy,
  estimateTokens,
  shouldAutoCompact,
} from "@nervekit/harness/compaction";
import { getModelContextWindow } from "@nervekit/harness/models";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type { PolicyDocumentObservation } from "@nervekit/contracts/permissions";
import type { CanonicalLifecycleWork } from "@nervekit/contracts/runs";
import type { ToolName } from "@nervekit/contracts/tools";
import { resolveProjectSettings } from "../../../infrastructure/configuration/index.js";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import type { CanonicalToolRuntimeService } from "../../tools/execution/canonical-tool-runtime.service.js";
import type { CanonicalAutoCompactionService } from "../../conversations/timeline/canonical-auto-compaction.service.js";
import type { CanonicalContinuationService } from "../../conversations/timeline/canonical-continuation.service.js";
import type { CanonicalToolWorkerService } from "../../conversations/timeline/canonical-tool-worker.service.js";
import type { CanonicalLiveRunExecutor } from "./canonical-live-run-executor.js";
import type { WorkbenchAgentMechanics } from "./workbench-agent-mechanics.js";
import { activeToolNamesForExploreAgent } from "../../tools/orchestration/agent-tool-adapter.js";

const MAX_CONTEXT_ANCESTRY_PAGES = 2_048;
const CONTEXT_ANCESTRY_PAGE_SIZE = 512;

interface ToolManifest {
  normalizedInput: Record<string, unknown>;
  normalizedInputFingerprint: string;
  policyObservation: PolicyDocumentObservation;
  providerToolCallId: string;
  toolName: ToolName;
  exactApproval?: boolean;
}

/** Owns production handlers for all directly dispatchable canonical work. */
export class CanonicalExecutionRuntime {
  private readonly activeAbortControllers = new Map<
    string,
    Set<AbortController>
  >();

  constructor(
    private readonly deps: {
      store: CanonicalStore;
      live: CanonicalLiveRunExecutor;
      toolWorker: CanonicalToolWorkerService;
      continuation: CanonicalContinuationService;
      autoCompaction: CanonicalAutoCompactionService;
      mechanics: WorkbenchAgentMechanics;
      tools: CanonicalToolRuntimeService;
      workerId: string;
      getAgentForConversation(conversationId: string): AgentRecord | undefined;
      getConversationCreatedAt(conversationId: string): string;
      prepareCompactionSummary(input: {
        agent: AgentRecord;
        entriesDescending: readonly import("@nervekit/contracts/conversations").CanonicalConversationEntry[];
        summaryReserveTokens: number;
      }): Promise<string>;
      onForegroundClosed?(conversationId: string): Promise<void>;
    },
  ) {}

  readonly handlers: Partial<
    Record<
      CanonicalLifecycleWork["kind"],
      (work: CanonicalLifecycleWork) => Promise<void>
    >
  > = {
    prepare_provider_request: (work) =>
      this.withAbortSignal(work, (signal) =>
        this.executeProvider(work, signal),
      ),
    claim_provider_attempt: (work) =>
      this.withAbortSignal(work, (signal) =>
        this.executeProvider(work, signal),
      ),
    claim_tool_attempt: (work) =>
      this.withAbortSignal(work, (signal) => this.executeTool(work, signal)),
    execute_internal_command: (work) =>
      this.withAbortSignal(work, (signal) =>
        this.executeInternalCommand(work, signal),
      ),
    prepare_continuation: (work) => this.prepareContinuation(work),
  };

  abortRun(runId: string, reason = "run_cancelled"): void {
    for (const controller of this.activeAbortControllers.get(runId) ?? []) {
      controller.abort(new Error(reason));
    }
  }

  private async withAbortSignal(
    work: CanonicalLifecycleWork,
    operation: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    const controller = new AbortController();
    const active = this.activeAbortControllers.get(work.runId) ?? new Set();
    active.add(controller);
    this.activeAbortControllers.set(work.runId, active);
    try {
      await operation(controller.signal);
    } finally {
      active.delete(controller);
      if (active.size === 0) this.activeAbortControllers.delete(work.runId);
    }
  }

  private requireAgent(conversationId: string): AgentRecord {
    const agent = this.deps.getAgentForConversation(conversationId);
    if (!agent)
      throw new Error(
        `Canonical conversation '${conversationId}' has no agent.`,
      );
    return agent;
  }

  private async executeProvider(
    work: CanonicalLifecycleWork,
    signal: AbortSignal,
  ): Promise<void> {
    const agent = this.requireAgent(work.conversationId);
    await this.deps.live.execute({
      agent,
      providerWork: work,
      workerId: this.deps.workerId,
      activeToolNames: agent.parentAgentId
        ? activeToolNamesForExploreAgent()
        : await this.deps.mechanics.activeToolNamesFor(agent),
      conversationCreatedAt: this.deps.getConversationCreatedAt(
        work.conversationId,
      ),
      signal,
    });
    const head = await this.deps.store.readTimelineConversationHead(
      work.conversationId,
    );
    if (!head?.foregroundRunId) {
      await this.deps.onForegroundClosed?.(work.conversationId);
    }
  }

  private async executeInternalCommand(
    work: CanonicalLifecycleWork,
    signal: AbortSignal,
  ): Promise<void> {
    await this.deps.toolWorker.executeInternal({
      agent: this.requireAgent(work.conversationId),
      work,
      now: new Date().toISOString(),
      signal,
    });
  }

  private async executeTool(
    work: CanonicalLifecycleWork,
    signal: AbortSignal,
  ): Promise<void> {
    const agent = this.requireAgent(work.conversationId);
    const manifest = work.inputManifestId
      ? ((await this.deps.store.execution.readArtifactManifest(
          work.inputManifestId,
        )) as ToolManifest | undefined)
      : undefined;
    if (!manifest)
      throw new Error("Canonical tool work has no input manifest.");
    await this.deps.toolWorker.execute({
      agent,
      claimWork: work,
      workerId: this.deps.workerId,
      now: new Date().toISOString(),
      signal,
      revalidatePolicy: () =>
        this.deps.tools.revalidateCanonicalToolProposal({
          agent,
          toolName: manifest.toolName,
          args: manifest.normalizedInput,
          providerToolCallId: manifest.providerToolCallId,
          normalizedInputFingerprint: manifest.normalizedInputFingerprint,
          completeDocumentDigest:
            manifest.policyObservation.completeDocumentDigest,
          selectedRuleSetDigest:
            manifest.policyObservation.selectedRuleSetDigest,
          exactApproval: manifest.exactApproval,
        }),
    });
  }

  private async prepareContinuation(
    work: CanonicalLifecycleWork,
  ): Promise<void> {
    const manifest = work.inputManifestId
      ? ((await this.deps.store.execution.readArtifactManifest(
          work.inputManifestId,
        )) as
          | {
              providerIdentity: Record<string, unknown>;
              providerCapability:
                | "stateless_generation"
                | "contractually_replay_safe"
                | "non_repeatable_or_unknown";
            }
          | undefined)
      : undefined;
    const head = await this.deps.store.readTimelineConversationHead(
      work.conversationId,
    );
    if (!manifest || !head?.activeEntryId) {
      throw new Error("Canonical continuation evidence is unavailable.");
    }
    const entries =
      [] as import("@nervekit/contracts/conversations").CanonicalConversationEntry[];
    const seen = new Set<string>();
    let next: string | undefined = head.activeEntryId;
    let pages = 0;
    while (next && pages < MAX_CONTEXT_ANCESTRY_PAGES) {
      const page = await this.deps.store.readTimelineAncestrySegment(
        work.conversationId,
        next,
        CONTEXT_ANCESTRY_PAGE_SIZE,
      );
      for (const entry of page.entries) {
        if (seen.has(entry.entryId)) {
          throw new Error("Canonical context ancestry contains an overlap.");
        }
        seen.add(entry.entryId);
        entries.push(entry);
      }
      next = page.nextAncestorEntryId;
      pages += 1;
    }
    if (next) {
      throw new RangeError("Canonical context ancestry exceeds proof limit.");
    }
    const agent = this.requireAgent(work.conversationId);
    const settings = await resolveProjectSettings(
      this.deps.mechanics.deps.storage,
      agent.projectDir,
    );
    const policy = deriveAutoCompactionPolicy(
      getModelContextWindow(agent.model),
      settings.compaction,
    );
    const contextTokens = entries.reduce((total, entry) => {
      const content = entry.inlineContent as Record<string, unknown>;
      const exact = content.exactHarnessMessage;
      if (exact && typeof exact === "object" && "role" in exact) {
        return (
          total +
          estimateTokens(
            exact as import("@nervekit/harness/agent").AgentMessage,
          )
        );
      }
      const text = typeof content.text === "string" ? content.text : "";
      if (!text) return total;
      return (
        total +
        estimateTokens({
          role: "harness",
          eventType: "canonical_context_entry",
          content: text,
          timestamp: 0,
        })
      );
    }, 0);
    const now = new Date().toISOString();
    if (shouldAutoCompact(contextTokens, policy)) {
      const identity = await this.deps.store.readTimelineStateIdentity();
      if (!identity)
        throw new Error("Canonical timeline identity is unavailable.");
      const result =
        await this.deps.autoCompaction.compactThenPrepareProviderPhase({
          namespaceId: identity.namespaceId,
          executionIncarnationId: identity.executionIncarnationId,
          conversationId: work.conversationId,
          runId: work.runId,
          policyVersion: 1,
          providerAdapterVersion: "canonical-v1",
          providerIdentity: manifest.providerIdentity,
          providerCapability: manifest.providerCapability,
          recipeVersion: 1,
          preparedAt: now,
          continuationWork: work,
          scheduleProviderPreparation: true,
          prepareSummary: async (source) => ({
            summary: await this.deps.prepareCompactionSummary({
              agent,
              entriesDescending: source,
              summaryReserveTokens: policy.summaryReserveTokens,
            }),
            anchorEntryId: null,
          }),
          prepareProviderPhase: async () => undefined,
        });
      if (result.kind === "stale") {
        throw new Error(
          `Canonical compaction rejected: ${result.outcome.kind}.`,
        );
      }
      return;
    }
    const result = await this.deps.continuation.commitWithoutCompaction({
      continuationWork: work,
      workerId: this.deps.workerId,
      now,
      compactionDecisionEvidence: {
        decision: "not_required",
        contextTokens,
        contextWindow: policy.contextWindow,
        thresholdTokens: policy.thresholdTokens,
        profile: policy.profile,
      },
    });
    if (result.kind === "rejected") {
      throw new Error(
        `Canonical continuation rejected: ${result.outcome.kind}.`,
      );
    }
  }
}
