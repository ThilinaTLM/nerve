import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  type AgentCustomModel,
  resolveAgentModel,
} from "@nervekit/harness/models";
import { type AgentHarness } from "@nervekit/harness";
import { Conversation } from "@nervekit/harness/conversation";
import type { RunExecutionOutcome } from "../../runs/runtime/index.js";
import {
  type AgentRecord,
  type CreateAgentRequest,
  type PromptRequest,
} from "@nervekit/contracts/agents";
import { type ConversationRecord } from "@nervekit/contracts/conversations";
import {
  toolNameSchema,
  type ToolName,
  type UserConfigurableToolName,
} from "@nervekit/contracts/tools";
import type { CapabilityToolName } from "@nervekit/contracts/capabilities";
import type { ApplicationLogger } from "../../../infrastructure/diagnostics/index.js";
import type { StreamLogRegistry } from "../../../infrastructure/events/index.js";
import type { InitializedStorage } from "../../../infrastructure/storage-bootstrap/index.js";
import { resolveProjectSettings } from "../../../infrastructure/configuration/index.js";
import type { RuntimeState } from "../../../app/runtime/runtime-projections.js";
import type { AuthManager } from "../../auth/index.js";
import type { PythonRuntimeService } from "../../tools/execution/python-runtime.js";
import type { PlanService } from "../../plans/plan-service.js";
import type { WorkbenchTaskService } from "../../tasks/adapters/workbench-task-service.js";
import type { CapabilityService } from "../../capabilities/capability.service.js";
import { activeToolNamesForAgent } from "../../tools/orchestration/agent-tool-adapter.js";
import type { CanonicalToolRuntimeService } from "../../tools/execution/canonical-tool-runtime.service.js";
import type { ExploreProgressUpdate } from "../../tools/execution/tool-runtime-ports.js";
import type { SubscriptionUsageService } from "../../usage/subscription-usage-service.js";
import type { AgentBrowserSkillCatalog } from "../prompting/agent-browser-skills.js";
import type { SubagentTranscriptLiveService } from "../subagent-transcript-live.service.js";
import { executeWorkbenchHarness } from "./workbench-harness-execution.js";
import type { CoordinatorExecutionOptions } from "./coordinator-execution-options.js";
import type { AgentMessage } from "@nervekit/harness/agent";
import type { CanonicalToolProposalInput } from "../../conversations/timeline/canonical-tool-batch.js";
import type { AppendEntryFn } from "./canonical-harness-projection.js";
import {
  type ExploreReport,
  CanonicalExploreCoordinator,
} from "./canonical-explore-coordinator.js";
import type { WorkbenchExploreAdmission } from "./workbench-explore-admission.js";

type WorkbenchToolPort = Pick<
  CanonicalToolRuntimeService,
  "prepareCanonicalToolProposal"
>;

export interface WorkbenchAgentMechanicsDeps {
  storage: InitializedStorage;
  events: StreamLogRegistry;
  auth: AuthManager;
  tools: WorkbenchToolPort;
  tasks: WorkbenchTaskService;
  pythonRuntime: PythonRuntimeService;
  plans: PlanService;
  createChildConversation: ConstructorParameters<
    typeof CanonicalExploreCoordinator
  >[0]["createChildConversation"];
  runCanonicalChild: ConstructorParameters<
    typeof CanonicalExploreCoordinator
  >[0]["runCanonicalChild"];
  state: RuntimeState;
  createAgent: (
    request: CreateAgentRequest,
    options?: { allowChildAuthorityExceed?: boolean },
  ) => Promise<AgentRecord>;
  setAgentStatus: (
    agent: AgentRecord,
    status: AgentRecord["status"],
  ) => Promise<void>;
  appendEntry: AppendEntryFn;
  updateConversation: (conversation: ConversationRecord) => Promise<void>;
  subscriptionUsage: SubscriptionUsageService;
  logger: ApplicationLogger;
  exploreAdmission: WorkbenchExploreAdmission;
  agentBrowserSkills: AgentBrowserSkillCatalog;
  capabilities: CapabilityService;
  subagentTranscriptLive: SubagentTranscriptLiveService;
  maxParallelToolsPerRun: number;
  customModels?: (projectDir?: string) => Promise<AgentCustomModel[]>;
}

export class WorkbenchAgentMechanics {
  readonly subagents: CanonicalExploreCoordinator;

  constructor(readonly deps: WorkbenchAgentMechanicsDeps) {
    this.subagents = new CanonicalExploreCoordinator({
      storage: deps.storage,
      events: deps.events,
      createChildConversation: deps.createChildConversation,
      runCanonicalChild: deps.runCanonicalChild,
      createAgent: deps.createAgent,
      setAgentStatus: deps.setAgentStatus,
      logger: deps.logger.child({ component: "canonical-explore" }),
      exploreAdmission: deps.exploreAdmission,
      transcriptLive: deps.subagentTranscriptLive,
    });
  }

  async customModels(projectDir?: string): Promise<AgentCustomModel[]> {
    return (await this.deps.customModels?.(projectDir)) ?? [];
  }

  effectiveSettings(projectDir: string) {
    return resolveProjectSettings(this.deps.storage, projectDir);
  }

  async activeToolNamesFor(
    agent: AgentRecord,
    disabledToolNames?: readonly CapabilityToolName[],
  ): Promise<ToolName[]> {
    const disabled = disabledToolNames
      ? new Set<CapabilityToolName>(disabledToolNames)
      : undefined;
    const pythonAvailable = await this.deps.pythonRuntime.isAvailableForProject(
      agent.projectDir,
    );
    const settings = await resolveProjectSettings(
      this.deps.storage,
      agent.projectDir,
    );
    const customModels = await this.customModels(agent.projectDir);
    const primaryModel = resolveAgentModel(agent.model, customModels);
    const imageExplanationSelection = settings.tools.imageExplanation.model;
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
    return activeToolNamesForAgent(agent, {
      pythonAvailable,
      disabledToolNames: (disabledToolNames ?? settings.tools.disabled).filter(
        (name): name is UserConfigurableToolName =>
          name !== "jira" && name !== "confluence",
      ),
      jiraEnabled: settings.tools.jira.enabled && !disabled?.has("jira"),
      confluenceEnabled:
        settings.tools.confluence.enabled && !disabled?.has("confluence"),
      imageExplanationAvailable,
      primaryModelSupportsImages: (primaryModel.input ?? ["text"]).includes(
        "image",
      ),
    });
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

  async runCoordinatorExecution(
    input: CoordinatorExecutionOptions,
  ): Promise<RunExecutionOutcome> {
    const agent = this.deps.state.getAgent(input.run.agentId);
    return (await executeWorkbenchHarness.call(
      this,
      agent,
      { text: input.prompt ?? "", images: input.images },
      {
        continue: input.command === "continue",
        coordinator: input,
      },
    )) as RunExecutionOutcome;
  }

  async prepareCanonicalToolProposals(
    agent: AgentRecord,
    message: AgentMessage,
  ): Promise<readonly CanonicalToolProposalInput[]> {
    if (message.role !== "assistant") return [];
    return Promise.all(
      message.content.flatMap((content) =>
        content.type === "toolCall"
          ? [
              this.deps.tools.prepareCanonicalToolProposal(
                agent,
                toolNameSchema.parse(content.name),
                content.arguments,
                content.id,
              ),
            ]
          : [],
      ),
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
    canonical?: boolean;
  }): Promise<AssistantMessage> {
    return input.continue
      ? input.harness.continue()
      : input.harness.prompt(input.request.text, {
          images: input.request.images,
        });
  }
}
