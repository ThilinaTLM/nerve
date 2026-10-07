import {
  foregroundPromptAnchor,
  withPromptCompactionAnchor,
} from "../../conversations/compaction-provenance.js";
import {
  compactionFailureOutcome,
  type CompactionOutcome,
} from "../../conversations/operations/compaction-service.js";
import { disabledToolNamesForCapabilities } from "@nervekit/contracts/capabilities";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  type AgentCustomModel,
  getModelContextWindow,
  resolveAgentModel,
} from "@nervekit/harness/models";
import { type AgentHarness } from "@nervekit/harness";
import { Conversation } from "@nervekit/harness/conversation";
import {
  calculateContextTokens,
  deriveAutoCompactionPolicy,
  isContextOverflowAssistantMessage,
} from "@nervekit/harness/compaction";
import type { ToolExecutionResult } from "@nervekit/tools/execution";
import type { NerveSkillCatalog } from "@nervekit/skills";
import type {
  RunExecutionOutcome,
  RunExecutionSink,
} from "../../runs/runtime/index.js";
import {
  type AgentRecord,
  type CreateAgentRequest,
  type PromptRequest,
} from "@nervekit/contracts/agents";
import { type ContextUsage } from "@nervekit/contracts/models";
import { type ConversationRecord } from "@nervekit/contracts/conversations";
import { type RunRecord } from "@nervekit/contracts/runs";
import { parseInlineCommandPrompt } from "@nervekit/contracts/completions";
import { type ToolCallRecord, type ToolName } from "@nervekit/contracts/tools";
import type { CapabilitySelection } from "@nervekit/contracts/capabilities";
import type { ApplicationLogger } from "../../../infrastructure/diagnostics/index.js";
import type { StreamLogRegistry } from "../../../infrastructure/events/index.js";
import type { InitializedStorage } from "../../../infrastructure/storage-bootstrap/index.js";
import { resolveProjectSettings } from "../../../infrastructure/configuration/index.js";
import type { RuntimeState } from "../../../app/runtime/runtime-projections.js";
import type { AuthManager } from "../../auth/index.js";
import type { ConversationService } from "../../conversations/conversation-service.js";
import type { ImageGenerationService } from "../../image-generation/image-generation.service.js";
import type { ConversationHarnessStorage } from "../../conversations/conversation-harness-storage.js";
import type { CompactionService } from "../../conversations/operations/index.js";
import type { PythonRuntimeService } from "../../tools/execution/python-runtime.js";
import type { PlanService } from "../../plans/plan-service.js";
import type { WorkbenchTaskService } from "../../tasks/adapters/workbench-task-service.js";
import type { CapabilityService } from "../../capabilities/capability.service.js";
import { activeToolNamesForAgent } from "../../tools/orchestration/agent-tool-adapter.js";
import { effectiveIntegrations } from "../../tools/execution/integration-profile-resolution.js";
import type {
  ExploreProgressUpdate,
  ToolService,
} from "../../tools/execution/tool-service.js";
import type { SubscriptionUsageService } from "../../usage/subscription-usage-service.js";
import type { AgentBrowserSkillCatalog } from "../prompting/agent-browser-skills.js";
import type { SubagentTranscriptLiveService } from "../subagent-transcript-live.service.js";
import { executeWorkbenchHarness } from "./workbench-harness-execution.js";
import {
  insertWorkbenchAgentInput,
  assertWorkbenchDispatch,
} from "./workbench-turn-preparation.js";
import { AutoCompactionRunner } from "./auto-compaction-runner.js";
import { compactionSettingsForAgent } from "./subagent-compaction-settings.js";
import { InlineCommandRunner } from "./inline-command-runner.js";
import type { AppendEntryFn, MessageMirror } from "./message-mirror.js";
import { type ExploreReport, SubagentRunner } from "./subagent-runner.js";
import type { WorkbenchLiveExecutionControl } from "../../runs/application/run-live-executions.js";
import type { WorkbenchExploreAdmission } from "./workbench-explore-admission.js";
import type { WorkbenchSubagentExecutions } from "./workbench-subagent-executions.js";

export interface WorkbenchAgentMechanicsDeps {
  exploreRuntime: import("./subagent-runner.js").ExploreRuntime;
  agentInputs?: import("../../runs/runtime/agent-inputs.js").AgentInputService;
  loadRunState?: (
    runId: string,
  ) => Promise<
    | import("../../runs/runtime/run-unit-of-work.js").RunHydratedState
    | undefined
  >;
  commitEffectiveConfiguration?: (
    agentId: string,
    revision: number,
    turnId: string,
    runId: string,
  ) => Promise<void>;
  storage: InitializedStorage;
  events: StreamLogRegistry;
  auth: AuthManager;
  imageGeneration: ImageGenerationService;
  tools: ToolService;
  tasks: WorkbenchTaskService;
  pythonRuntime: PythonRuntimeService;
  plans: PlanService;
  harnessStorage: ConversationHarnessStorage;
  conversationService: ConversationService;
  compactionService: CompactionService;
  state: RuntimeState;
  createAgent: (
    request: CreateAgentRequest,
    options?: { allowChildAuthorityExceed?: boolean },
  ) => Promise<AgentRecord>;
  appendEntry: AppendEntryFn;
  updateConversation: (conversation: ConversationRecord) => Promise<void>;
  messageMirror: MessageMirror;
  subscriptionUsage: SubscriptionUsageService;
  logger: ApplicationLogger;
  subagentExecutions: WorkbenchSubagentExecutions;
  exploreAdmission: WorkbenchExploreAdmission;
  nerveSkills: NerveSkillCatalog;
  agentBrowserSkills: AgentBrowserSkillCatalog;
  capabilities: CapabilityService;
  subagentTranscriptLive: SubagentTranscriptLiveService;
  maxParallelToolsPerRun: number;
  customModels?: (projectDir?: string) => Promise<AgentCustomModel[]>;
}

export class WorkbenchAgentMechanics {
  readonly subagents: SubagentRunner;
  readonly inlineCommands: InlineCommandRunner;
  readonly autoCompaction: AutoCompactionRunner;

  constructor(readonly deps: WorkbenchAgentMechanicsDeps) {
    this.autoCompaction = new AutoCompactionRunner(deps);
    this.subagents = new SubagentRunner({
      storage: deps.storage,
      events: deps.events,
      createAgent: deps.createAgent,
      runtime: deps.exploreRuntime,
      logger: deps.logger.child({ component: "subagent-runner" }),
      executions: deps.subagentExecutions,
      exploreAdmission: deps.exploreAdmission,
      capabilities: deps.capabilities,
    });
    this.inlineCommands = new InlineCommandRunner(deps);
  }

  async customModels(projectDir?: string): Promise<AgentCustomModel[]> {
    return (await this.deps.customModels?.(projectDir)) ?? [];
  }

  effectiveSettings(projectDir: string) {
    return resolveProjectSettings(this.deps.storage, projectDir);
  }

  /**
   * Tools advertised to an agent under its resolved capability selection.
   * Integrations use the same resolution as tool execution, so an advertised
   * Jira/Confluence tool always has an enabled, existing profile behind it.
   */
  async activeToolNamesFor(
    agent: AgentRecord,
    selection?: CapabilitySelection,
  ): Promise<ToolName[]> {
    const resolved =
      selection ??
      (await this.deps.capabilities.resolve(
        agent.projectId,
        agent.conversationId,
      ));
    const pythonAvailable = await this.deps.pythonRuntime.isAvailableForProject(
      agent.projectDir,
    );
    const settings = await resolveProjectSettings(
      this.deps.storage,
      agent.projectDir,
    );
    const customModels = await this.customModels(agent.projectDir);
    const primaryModel = resolveAgentModel(agent.model, customModels);
    const imageExplanationSelection = resolved.toolSettings.explain_image.model;
    const imageExplanationModel = imageExplanationSelection
      ? resolveAgentModel(imageExplanationSelection, customModels)
      : undefined;
    const imageExplanationModelValid = Boolean(
      imageExplanationSelection &&
      imageExplanationModel?.provider === imageExplanationSelection.provider &&
      imageExplanationModel.id === imageExplanationSelection.modelId &&
      (imageExplanationModel.input ?? ["text"]).includes("image"),
    );
    const imageExplanationAvailable = Boolean(
      imageExplanationModelValid &&
      imageExplanationModel &&
      (await this.deps.auth
        .requestAuthForPiModel(imageExplanationModel)
        .catch(() => undefined)),
    );
    const imageGenerationAvailable =
      await this.deps.imageGeneration.isAvailable(
        resolved.toolSettings.generate_image,
      );
    const integrations = effectiveIntegrations(settings, resolved);
    return activeToolNamesForAgent(agent, {
      pythonAvailable,
      disabledToolNames: disabledToolNamesForCapabilities(
        resolved.disabledTools,
      ),
      jiraEnabled: integrations.jira.enabled,
      confluenceEnabled: integrations.confluence.enabled,
      imageExplanationAvailable,
      imageGenerationAvailable,
      primaryModelSupportsImages: (primaryModel.input ?? ["text"]).includes(
        "image",
      ),
    });
  }

  async executeInlineBashCommand(
    agent: AgentRecord,
    command: string,
    options: {
      runId: string;
      signal?: AbortSignal;
      continueAfterPromotedTask?: boolean;
      useForegroundBash?: boolean;
    },
  ): Promise<ToolCallRecord> {
    this.assertInlineCommandAllowed(agent);
    return this.inlineCommands.executeBashCommand(agent, command, options);
  }

  async executeInlinePromptBlockCommand(
    agent: AgentRecord,
    command: string,
    options: { signal?: AbortSignal },
  ): Promise<ToolExecutionResult> {
    this.assertInlineCommandAllowed(agent);
    return this.inlineCommands.executePromptBlockCommand(
      agent,
      command,
      options,
    );
  }

  private assertInlineCommandAllowed(agent: AgentRecord): void {
    const current = this.deps.state.agents.get(agent.id) ?? agent;
    if (current.readOnlyCeiling || current.permissionLevel === "read_only")
      throw new Error("Read-only agent policy forbids inline shell execution");
  }

  runExplore(
    parent: AgentRecord,
    args: Record<string, unknown>,
    options: {
      onProgress?: (update: ExploreProgressUpdate) => void;
      signal?: AbortSignal;
      parentRunId?: string;
    } = {},
  ): Promise<{
    reports: ExploreReport[];
    contentBlocks: [{ type: "text"; text: string }];
  }> {
    return this.subagents.runExplore(parent, args, options);
  }

  async runCoordinatorExecution(input: {
    run: RunRecord;
    sink: RunExecutionSink;
    command: "start" | "continue";
    prompt?: string;
    images?: PromptRequest["images"];
    signal: AbortSignal;
    withProviderDispatchFence?<T>(action: () => Promise<T>): Promise<T>;
    installControl(control: WorkbenchLiveExecutionControl): void;
    checkpointCommand(
      boundary: "after_provider_response" | "suspension",
      interactionId?: string,
    ): Promise<import("../../runs/runtime/index.js").CheckpointCommand>;
  }): Promise<RunExecutionOutcome> {
    const agent = this.deps.state.getAgent(input.run.agentId);
    const inline =
      input.command === "start"
        ? parseInlineCommandPrompt(input.prompt ?? "")
        : undefined;
    if (inline) {
      try {
        this.assertInlineCommandAllowed(agent);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.deps.agentInputs?.recordAdmissionBlocker(
          agent.id,
          message,
          agent.configurationRevision ?? 1,
        );
        return {
          status: "failed",
          failure: {
            code: "AGENT_CONFIGURATION_BLOCKED",
            message,
            retryable: false,
            continuable: false,
          },
        };
      }
      await assertWorkbenchDispatch(this, agent, input.signal);
      if (this.deps.agentInputs && input.run.initialInputId) {
        const delivered = await this.deps.agentInputs.prepare(
          {
            agentId: agent.id,
            conversationId: agent.conversationId,
            runId: input.run.runId,
            attemptId: input.run.executionId,
            turnId: `inline_${input.run.executionId}`,
            requiresProvider: false,
          },
          (record, id, target) =>
            insertWorkbenchAgentInput(this, agent, input, record, id, target),
          async (id) => {
            const state = await this.deps.loadRunState?.(id);
            return Boolean(
              state &&
              ["completed", "failed", "cancelled"].includes(state.run.status),
            );
          },
          1,
          undefined,
          input.run.initialInputId,
        );
        if (!delivered.some((record) => record.id === input.run.initialInputId))
          return { status: "completed", result: {} };
      }
      await assertWorkbenchDispatch(this, agent, input.signal);
      return this.inlineCommands.runCoordinatorPrompt({
        agent,
        command: inline.command,
        runId: input.run.runId,
        sink: input.sink,
        signal: input.signal,
      });
    }
    return await executeWorkbenchHarness.call(
      this,
      agent,
      { text: input.prompt ?? "", images: input.images },
      {
        continue: input.command === "continue",
        coordinator: input,
      },
    );
  }

  async runHarnessAttempt(input: {
    harness: AgentHarness;
    conversation: Conversation;
    request: PromptRequest;
    continue: boolean;
    runId: string;
    agent: AgentRecord;
    signal?: AbortSignal;
  }): Promise<AssistantMessage> {
    const latestAgent = () =>
      this.deps.state.agents.get(input.agent.id) ?? input.agent;
    input.signal?.throwIfAborted();
    if (!input.continue) {
      await this.autoCompaction.maybeCompactBeforePrompt({
        conversationId: input.agent.conversationId,
        agentId: input.agent.id,
        runId: input.runId,
        text: input.request.text,
        images: input.request.images,
        conversation: input.conversation,
        signal: input.signal,
      });
    }
    input.signal?.throwIfAborted();
    let assistant = input.continue
      ? await input.harness.continue()
      : await withPromptCompactionAnchor(
          input.agent,
          await foregroundPromptAnchor(input.conversation, input.agent),
          () => {
            // Anchor preparation can yield while the run is cancelled.
            input.signal?.throwIfAborted();
            return input.harness.prompt(input.request.text, {
              images: input.request.images,
            });
          },
        );
    const contextWindow = getModelContextWindow(
      latestAgent().model,
      await this.customModels(input.agent.projectDir),
    );
    if (isContextOverflowAssistantMessage(assistant, contextWindow)) {
      const recovered = await this.tryOverflowCompactionRecovery(
        input,
        assistant,
        contextWindow,
      );
      if (recovered.status === "compacted") {
        input.signal?.throwIfAborted();
        assistant = await input.harness.continue();
      }
    }
    return assistant;
  }

  async tryOverflowCompactionRecovery(
    input: {
      conversation: Conversation;
      runId: string;
      agent: AgentRecord;
      signal?: AbortSignal;
    },
    assistant: AssistantMessage,
    contextWindow: number,
  ): Promise<CompactionOutcome> {
    const leafId = await input.conversation.getLeafId();
    const leaf = leafId ? await input.conversation.getEntry(leafId) : undefined;
    if (leaf?.type !== "message" || leaf.message.role !== "assistant") {
      return { status: "blocked", reason: "invalid_overflow_source" };
    }
    const failedEntryId = leaf.id;
    const settings = compactionSettingsForAgent(
      await this.deps.capabilities.settings(
        input.agent.projectId,
        input.agent.conversationId,
      ),
      input.agent,
    );
    if (!settings.auto)
      return { status: "not_needed", reason: "auto_disabled" };
    const policy = deriveAutoCompactionPolicy(contextWindow, settings);
    try {
      await this.deps.compactionService.compactConversation(
        input.agent.conversationId,
        {
          instructions:
            "Overflow recovery after the selected model hit its context limit.",
        },
        {
          reason: "overflow",
          agentId: input.agent.id,
          runId: input.runId,
          contextWindow: policy.contextWindow,
          contextTokens: calculateContextTokens(assistant.usage),
          thresholdTokens: policy.thresholdTokens,
          triggerReserveTokens: policy.triggerReserveTokens,
          keepRecentTokens: policy.keepRecentTokens,
          summaryReserveTokens: policy.summaryReserveTokens,
          profile: policy.profile,
          thresholdPercent: policy.thresholdPercent,
          keepRecentPercent: policy.keepRecentPercent,
          safetyHeadroomTokens: policy.safetyHeadroomTokens,
          failedEntryId,
          activeConversation: input.conversation,
          signal: input.signal,
        },
      );
      await this.deps.logger.info(
        "Recovered context overflow with compaction",
        {
          agentId: input.agent.id,
          conversationId: input.agent.conversationId,
          projectId: input.agent.projectId,
          runId: input.runId,
          context: { failedEntryId, contextWindow: policy.contextWindow },
        },
      );
      return { status: "compacted", reason: "checkpoint_committed" };
    } catch (error) {
      const outcome = compactionFailureOutcome(error, input.signal);
      await this.deps.logger.warn("Context overflow compaction failed", {
        agentId: input.agent.id,
        conversationId: input.agent.conversationId,
        projectId: input.agent.projectId,
        runId: input.runId,
        context: { failedEntryId },
        error,
      });
      return outcome;
    }
  }

  /** Compute compaction-aware context-window usage for a conversation. */
  async getContextUsage(conversationId: string): Promise<ContextUsage> {
    return this.autoCompaction.getContextUsage(conversationId);
  }

  async publishContextUsage(
    conversationId: string,
    agentId: string,
    runId: string,
  ): Promise<void> {
    return this.autoCompaction.publishContextUsage(
      conversationId,
      agentId,
      runId,
    );
  }

  async maybeAutoCompactBeforeQueuedTurn(
    input: Parameters<AutoCompactionRunner["maybeCompactBeforePrompt"]>[0],
  ) {
    return this.autoCompaction.maybeCompactBeforePrompt(input);
  }

  async maybeAutoCompactAtIteration(
    conversationId: string,
    agentId: string,
    runId: string,
    conversation: Conversation,
    signal?: AbortSignal,
  ): Promise<CompactionOutcome> {
    return this.autoCompaction.maybeCompactAtIteration({
      conversationId,
      agentId,
      runId,
      conversation,
      signal,
    });
  }

  takeAutoCompactionContinuation(
    runId: string,
    child = false,
  ): string | undefined {
    return this.autoCompaction.takeContinuation(runId, child);
  }

  finishAutoCompactionRun(runId: string): void {
    this.autoCompaction.finishRun(runId);
  }
}
