import { createHash } from "node:crypto";
import {
  allToolDescriptors,
  requireToolDefinition,
} from "@nervekit/tools/catalog";
import type {
  ExplainImageRequest,
  ExplainImageResponse,
} from "@nervekit/tools/execution";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type { Mode } from "@nervekit/contracts/settings";
import type { ToolName } from "@nervekit/contracts/tools";
import type { CanonicalToolProposalInput } from "../../conversations/timeline/canonical-tool-batch.js";
import type { InitializedStorage } from "../../../infrastructure/storage-bootstrap/index.js";
import type { StreamLogRegistry } from "../../../infrastructure/events/index.js";
import type { WorkbenchTaskService } from "../../tasks/adapters/workbench-task-service.js";
import type { PythonRuntimeService } from "./python-runtime.js";
import type {
  TaskStarter,
  ExploreRunner,
  ToolService,
} from "./tool-service.js";
import type { PlanService } from "../../plans/plan-service.js";
import type { ConversationRuntime } from "../../runs/runtime/conversation-runtime.js";
import type { PermissionPolicyService } from "../../permissions/permission-policy.service.js";
import { policyFailureFingerprint } from "../../permissions/policy-fingerprints.js";
import { evaluateWorkbenchToolPermission } from "../permission/index.js";
import { TodoStateService } from "../orchestration/todo-state.service.js";
import { OrchestrationToolDispatcher } from "../orchestration/dispatcher.js";
import { CanonicalToolExternalInvoker } from "./canonical-tool-external-invoker.js";
import type { ToolResultPayloadStore } from "../artifacts/tool-result-payload-store.js";
import { canonicalConversationJson } from "../../conversations/timeline/command-fingerprint.js";

export interface CanonicalToolRuntimeDependencies {
  storage: InitializedStorage;
  events: StreamLogRegistry;
  tasks: WorkbenchTaskService;
  pythonRuntime: PythonRuntimeService;
  startTask: TaskStarter;
  getAgent(agentId: string): AgentRecord;
  runExplore: ExploreRunner;
  getApiKey(provider: string): Promise<string | undefined>;
  explainImage(request: ExplainImageRequest): Promise<ExplainImageResponse>;
  plans: PlanService;
  setAgentMode(
    agentId: string,
    mode: Mode,
    reason: string,
  ): Promise<AgentRecord>;
  conversationRuntime: ConversationRuntime;
  permissionPolicy: PermissionPolicyService;
  resultPayloads: ToolResultPayloadStore;
}

/** Tool catalog, policy observation, and repository-free host invocation. */
export class CanonicalToolRuntimeService {
  readonly canonicalInvoker: CanonicalToolExternalInvoker;

  constructor(private readonly deps: CanonicalToolRuntimeDependencies) {
    const dispatcher = new OrchestrationToolDispatcher({
      storage: deps.storage,
      events: deps.events,
      tasks: deps.tasks,
      pythonRuntime: deps.pythonRuntime,
      startTask: deps.startTask,
      getAgent: deps.getAgent,
      runExplore: deps.runExplore,
      getApiKey: deps.getApiKey,
      explainImage: deps.explainImage,
      plans: deps.plans,
      setAgentMode: deps.setAgentMode,
      conversationRuntime: deps.conversationRuntime,
      todoState: new TodoStateService(),
    });
    this.canonicalInvoker = new CanonicalToolExternalInvoker(
      dispatcher,
      deps.resultPayloads,
    );
  }

  listTools() {
    return allToolDescriptors;
  }

  async removeRecordsForConversations(): Promise<void> {
    // Canonical deletion removes effect and attempt authority by owner.
  }

  requestToolAndWait(
    ...args: Parameters<ToolService["requestToolAndWait"]>
  ): ReturnType<ToolService["requestToolAndWait"]> {
    void args;
    throw new Error("Non-canonical tool execution is retired.");
  }

  toolResultRecoveryArtifact(
    ...args: Parameters<ToolService["toolResultRecoveryArtifact"]>
  ): ReturnType<ToolService["toolResultRecoveryArtifact"]> {
    void args;
    throw new Error("Legacy tool recovery is retired.");
  }

  findToolCallByProviderToolCallId(
    ...args: Parameters<ToolService["findToolCallByProviderToolCallId"]>
  ): ReturnType<ToolService["findToolCallByProviderToolCallId"]> {
    void args;
    throw new Error("Legacy tool lookup is retired.");
  }

  recordProviderToolCallError(
    ...args: Parameters<ToolService["recordProviderToolCallError"]>
  ): ReturnType<ToolService["recordProviderToolCallError"]> {
    void args;
    throw new Error("Legacy tool recording is retired.");
  }

  getToolCall(
    ...args: Parameters<ToolService["getToolCall"]>
  ): ReturnType<ToolService["getToolCall"]> {
    void args;
    throw new Error("Legacy tool lookup is retired.");
  }

  requestTool(
    ...args: Parameters<ToolService["requestTool"]>
  ): ReturnType<ToolService["requestTool"]> {
    void args;
    throw new Error("Non-canonical tool execution is retired.");
  }

  async prepareCanonicalToolProposal(
    agent: AgentRecord,
    toolName: ToolName,
    args: Record<string, unknown>,
    providerToolCallId: string,
  ): Promise<CanonicalToolProposalInput> {
    const latestAgent = this.deps.getAgent(agent.id);
    const resolved = await this.deps.permissionPolicy.resolve(latestAgent);
    const evaluation = evaluateWorkbenchToolPermission(
      latestAgent,
      toolName,
      args,
      {
        dataDir: this.deps.storage.paths.home,
        exceptions: [],
        policy: resolved.policy,
        roots: resolved.roots,
        policyDiagnostic: resolved.diagnostics.at(-1),
      },
    );
    const definition = requireToolDefinition(toolName);
    const admission = resolved.executionBlocked
      ? "policy_blocked"
      : evaluation.decision === "allow"
        ? definition.executionRecovery.executionClass === "external_effect"
          ? "authorized"
          : toolName === "ask_user"
            ? "user_input"
            : toolName === "plan_mode_present"
              ? "plan_review"
              : "internal_command"
        : evaluation.decision === "approval"
          ? "awaiting_approval"
          : "denied";
    const normalizedInputFingerprint = digest({
      toolName,
      args: evaluation.normalizedArgs,
      cwd: evaluation.cwd,
    });
    const observedAt = new Date().toISOString();
    const completeDocumentDigest = digest({
      selectedRuleSetDigest: resolved.selectedRuleSetDigest,
      sources: resolved.sourceDocuments,
    });
    const suffix = createHash("sha256")
      .update(
        `${providerToolCallId}:${normalizedInputFingerprint}:${completeDocumentDigest}`,
      )
      .digest("hex")
      .slice(0, 32);
    return {
      admission,
      providerToolCallId,
      toolName,
      normalizedInputFingerprint,
      normalizedInput: evaluation.normalizedArgs,
      cwd: evaluation.cwd,
      risk: evaluation.risk,
      capability:
        definition.executionRecovery.executionClass === "external_effect"
          ? definition.executionRecovery.capability
          : { kind: "non_repeatable_or_unknown", version: 1 },
      policyObservation: {
        schemaVersion: 1,
        observationId: `policy_observation_${suffix}`,
        scope: { kind: "conversation", ownerId: agent.conversationId },
        documentIdentity: `effective:${resolved.selectedRuleSetId}`,
        completeDocumentDigest,
        selectedRuleSetId: resolved.selectedRuleSetId,
        selectedRuleSetDigest: resolved.selectedRuleSetDigest,
        applicableOverlayDigests: resolved.sourceDocuments.map((source) => ({
          scope: {
            kind: source.origin,
            ownerId:
              source.origin === "user"
                ? "user"
                : source.origin === "project"
                  ? agent.projectId
                  : agent.conversationId,
          },
          documentIdentity: source.documentIdentity,
          digest: source.digest,
        })),
        normalizedInputFingerprint,
        trustEvidence: {
          fallback: resolved.fallback,
          diagnostics: resolved.diagnostics,
        },
        observedAt,
      },
      authorizationEvidence: {
        decision: evaluation.decision,
        reason: evaluation.reason,
        permissionEvaluation: evaluation.permissionEvaluation,
        interactionKind: resolved.fallback
          ? "policy_fallback_confirmation"
          : admission === "awaiting_approval"
            ? "tool_approval"
            : admission,
      },
      ...(resolved.executionBlocked
        ? {
            policyFailure: {
              scope: {
                kind: "conversation" as const,
                ownerId: agent.conversationId,
              },
              documentIdentity: resolved.fallback
                ? `rule-set:${agent.permissionRuleSetId ?? agent.permissionLevel}`
                : "applicable-permission-overlay",
              failureFingerprint: policyFailureFingerprint({
                selectedRuleSetId: resolved.selectedRuleSetId,
                diagnostics: resolved.diagnostics,
              }),
              failureKind: resolved.fallback
                ? ("invalid_rule_set" as const)
                : resolved.diagnostics.some((message) =>
                      /json|malformed|invalid/i.test(message),
                    )
                  ? ("malformed_overlay" as const)
                  : ("unreadable_overlay" as const),
            },
          }
        : {}),
      owner: {
        conversationId: agent.conversationId,
        projectId: agent.projectId,
        agentId: agent.id,
      },
    };
  }

  async revalidateCanonicalToolProposal(input: {
    agent: AgentRecord;
    toolName: ToolName;
    args: Record<string, unknown>;
    providerToolCallId: string;
    normalizedInputFingerprint: string;
    completeDocumentDigest: string;
    selectedRuleSetDigest: string;
    exactApproval?: boolean;
  }): Promise<boolean> {
    const current = await this.prepareCanonicalToolProposal(
      input.agent,
      input.toolName,
      input.args,
      input.providerToolCallId,
    );
    return (
      (current.admission === "authorized" ||
        (input.exactApproval === true &&
          current.admission === "awaiting_approval")) &&
      current.normalizedInputFingerprint === input.normalizedInputFingerprint &&
      current.policyObservation.completeDocumentDigest ===
        input.completeDocumentDigest &&
      current.policyObservation.selectedRuleSetDigest ===
        input.selectedRuleSetDigest
    );
  }
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(canonicalConversationJson(value))
    .digest("hex")}`;
}
