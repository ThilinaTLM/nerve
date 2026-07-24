/* eslint-disable max-lines -- Protocol dispatch table is intentionally exhaustive. */
import type {
  CompletionItem,
  GithubPrListFilters,
  ModelSelection,
  OperationName,
  ThinkingLevel,
} from "@nervekit/contracts";
import type { OrchestratorState } from "../app/orchestrator-state.js";
import {
  providerApiKeySecretName,
  providerOAuthSecretName,
} from "../domains/auth/index.js";
import { listAvailableSkills } from "../domains/agents/prompting/resource-loader.js";
import { FileCompletionService } from "../domains/completions/index.js";
import { planReviewPreview } from "../domains/plans/plan-service.js";
import { toToolCallTranscriptRecord } from "../domains/tools/tool-call-transcript-preview.js";
import { writeSettings } from "../infrastructure/storage/index.js";
import { directoryListing } from "../routes/filesystem-routes.js";
import { handleScratchNoteMethod } from "./scratch-note-method-handler.js";
import {
  getConversationSnapshotResponse,
  getWorkspaceSnapshotResponse,
} from "./snapshots.js";

export const WORKBENCH_OPERATION_METHODS = [
  "snapshot.workspace.get",
  "snapshot.conversation.get",
  "settings.get",
  "settings.update",
  "skill.list",
  "auth.providers.list",
  "providerCatalog.get",
  "providerCatalog.custom.upsert",
  "providerCatalog.custom.delete",
  "providerCatalog.model.upsert",
  "providerCatalog.model.delete",
  "storage.info",
  "storage.rebuildIndex",
  "storage.usage.get",
  "storage.cleanup",
  "storage.cleanup.get",
  "storage.cleanup.cancel",
  "model.list",
  "usage.subscription.get",
  "tool.list",
  "toolCall.list",
  "toolCall.get",
  "approval.list",
  "approval.grant",
  "approval.deny",
  "userQuestion.list",
  "userQuestion.answer",
  "userQuestion.dismiss",
  "planReview.list",
  "planReview.accept",
  "planReview.acceptInNewChat",
  "planReview.requestChanges",
  "planReview.reject",
  "planReview.discard",
  "conversation.create",
  "conversation.import",
  "conversation.list",
  "conversation.get",
  "conversation.delete",
  "conversation.entries.list",
  "conversation.contextUsage.get",
  "conversation.tree.get",
  "conversation.navigate",
  "conversation.compact",
  "agent.create",
  "agent.list",
  "agent.get",
  "agent.configure",
  "run.start",
  "run.steer",
  "run.followUp",
  "agent.promptQueue.list",
  "agent.promptQueue.cancel",
  "agent.requestTool",
  "run.continue",
  "run.cancel",
  "project.create",
  "project.list",
  "project.get",
  "project.openEditor",
  "project.conversations.prune",
  "project.delete",
  "pinnedCommand.list",
  "pinnedCommand.create",
  "pinnedCommand.update",
  "pinnedCommand.delete",
  "scratchNote.list",
  "scratchNote.create",
  "scratchNote.update",
  "scratchNote.delete",
  "task.list",
  "task.start",
  "task.get",
  "task.cancel",
  "task.restart",
  "task.prune",
  "task.delete",
  "task.logs",
  "git.repos.discover",
  "git.overview.get",
  "git.branches.list",
  "git.branch.create",
  "git.branch.switch",
  "git.file.stage",
  "git.file.unstage",
  "git.file.discard",
  "git.sync",
  "git.push",
  "git.pull",
  "git.fetch",
  "git.switchBaseAndPull",
  "github.status.get",
  "github.pr.list",
  "github.pr.get",
  "github.pr.checkout",
  "promptSuggestion.listForProject",
  "promptSuggestion.statuses.list",
  "promptSuggestion.trust.update",
  "completion.slash.list",
  "completion.files.list",
  "filesystem.directories.list",
  "worker.list",
  "worker.get",
  "applicationLog.prune",
] as const satisfies readonly OperationName[];

const slashCompletionItems: CompletionItem[] = [
  {
    label: "/plan",
    detail: "Start in planning mode",
    info: "Ask the agent to inspect first and produce a short plan before changing files.",
    kind: "slash",
  },
  {
    label: "/code",
    detail: "Switch to implementation",
    info: "Frame the next prompt as a coding task.",
    kind: "slash",
  },
  {
    label: "/status",
    detail: "Summarize current conversation state",
    info: "Useful before handing off or resuming a durable conversation.",
    kind: "slash",
  },
  {
    label: "/abort",
    detail: "Stop the active run",
    info: "Cancels the active agent run from the UI.",
    kind: "slash",
  },
];

export async function handleProtocolMethod(
  state: OrchestratorState,
  method: OperationName,
  params: unknown,
): Promise<unknown> {
  switch (method) {
    case "snapshot.workspace.get":
      return getWorkspaceSnapshotResponse(state);
    case "snapshot.conversation.get":
      return getConversationSnapshotResponse(
        state,
        (params as { conversationId: string }).conversationId,
      );
    case "settings.get":
      return state.storage.settings;
    case "settings.update":
      return updateSettings(state, params as Record<string, unknown>);
    case "skill.list": {
      const projectId = (params as { projectId?: string } | undefined)
        ?.projectId;
      const projectDir = projectId
        ? state.registry.getProject(projectId).dir
        : undefined;
      return listAvailableSkills(projectDir, {
        storageHome: state.storage.paths.home,
        agentBrowserSkills: state.agentBrowserSkills.skills,
      });
    }
    case "auth.providers.list":
      return {
        providers: await state.auth.listProviderMetadata(
          state.registry.listModels(),
          state.providerCatalog.providerDisplayNames(),
        ),
      };
    case "providerCatalog.get":
      await state.providerCatalog.ensureLoaded();
      return state.providerCatalog.catalog;
    case "providerCatalog.custom.upsert": {
      const provider = params as { id: string };
      const catalog = await state.providerCatalog.upsertProvider(
        provider as never,
      );
      await publishProviderCatalogChanged(state, provider.id);
      return catalog;
    }
    case "providerCatalog.custom.delete": {
      const id = (params as { id: string }).id;
      const catalog = await state.providerCatalog.deleteProvider(id);
      await state.secrets.delete(providerApiKeySecretName(id));
      await state.secrets.delete(providerOAuthSecretName(id));
      await publishProviderCatalogChanged(state, id);
      return catalog;
    }
    case "providerCatalog.model.upsert": {
      const model = params as { provider: string };
      const catalog = await state.providerCatalog.upsertModel(model as never);
      await publishProviderCatalogChanged(state, model.provider);
      return catalog;
    }
    case "providerCatalog.model.delete": {
      const request = params as { provider: string; modelId: string };
      const catalog = await state.providerCatalog.deleteModel(
        request.provider,
        request.modelId,
      );
      await publishProviderCatalogChanged(state, request.provider);
      return catalog;
    }
    case "storage.info":
      return {
        dataDir: state.storage.paths.home,
        sqlitePath: state.storage.paths.sqlitePath,
        configPath: state.storage.paths.configPath,
        counts: state.index.counts(),
      };
    case "storage.rebuildIndex":
      await state.registry.rebuildIndex();
      return { ok: true, counts: state.index.counts() };
    case "storage.usage.get":
      return state.storageUsage.computeUsage();
    case "storage.cleanup":
      return { operation: await state.storageCleanup.start(params as never) };
    case "storage.cleanup.get": {
      const request = (params ?? {}) as { operationId?: string };
      return { operation: state.storageCleanup.get(request.operationId) };
    }
    case "storage.cleanup.cancel": {
      const request = params as { operationId: string };
      return {
        operation: await state.storageCleanup.cancel(request.operationId),
      };
    }
    case "model.list":
      return { models: state.registry.listModels() };
    case "usage.subscription.get":
      return { usage: await state.registry.getSubscriptionUsage() };
    case "tool.list":
      return { tools: state.registry.tools.listTools() };
    case "toolCall.list": {
      const request = (params ?? {}) as { status?: string; limit?: number };
      let toolCalls = state.registry.tools.listToolCalls();
      if (request.status) {
        toolCalls = toolCalls.filter(
          (toolCall) => toolCall.status === request.status,
        );
      }
      if (request.limit !== undefined)
        toolCalls = toolCalls.slice(0, request.limit);
      return { toolCalls: toolCalls.map(toToolCallTranscriptRecord) };
    }
    case "toolCall.get":
      return {
        toolCall: state.registry.tools.getToolCall(
          (params as { toolCallId: string }).toolCallId,
        ),
      };
    case "approval.list":
      return {
        approvals: state.registry.tools.listApprovals(
          (params as { status?: "pending" | "granted" | "denied" } | undefined)
            ?.status,
        ),
      };
    case "approval.grant":
      return {
        toolCall: await state.registry.grantApproval(
          (params as { approvalId: string; note?: string }).approvalId,
          (params as { note?: string }).note,
        ),
      };
    case "approval.deny":
      return {
        toolCall: await state.registry.denyApproval(
          (params as { approvalId: string; note?: string }).approvalId,
          (params as { note?: string }).note,
        ),
      };
    case "userQuestion.list":
      return {
        questions: state.registry.listUserQuestions(
          (
            params as
              | { status?: "pending" | "answered" | "dismissed" }
              | undefined
          )?.status,
        ),
      };
    case "userQuestion.answer":
      return {
        question: await state.registry.answerUserQuestion(
          (params as { questionId: string; answer: string }).questionId,
          (params as { answer: string }).answer,
        ),
      };
    case "userQuestion.dismiss":
      return {
        question: await state.registry.dismissUserQuestion(
          (params as { questionId: string; reason?: string }).questionId,
          (params as { reason?: string }).reason,
        ),
      };
    case "planReview.list":
      return {
        planReviews: state.registry
          .listPlanReviews((params as { status?: never } | undefined)?.status)
          .map(planReviewPreview),
      };
    case "planReview.accept": {
      const request = params as PlanReviewParams;
      const planReview = await state.registry.acceptPlanReview(
        request.reviewId,
        request.feedback,
        implementation(request),
      );
      return { planReview: planReviewPreview(planReview) };
    }
    case "planReview.acceptInNewChat": {
      const request = params as PlanReviewParams;
      const result = await state.registry.acceptPlanReviewInNewChat(
        request.reviewId,
        request.feedback,
        implementation(request),
      );
      return { ...result, planReview: planReviewPreview(result.planReview) };
    }
    case "planReview.requestChanges": {
      const request = params as PlanReviewParams;
      const planReview = await state.registry.requestPlanChanges(
        request.reviewId,
        request.feedback,
      );
      return { planReview: planReviewPreview(planReview) };
    }
    case "planReview.reject": {
      const request = params as PlanReviewParams;
      const planReview = await state.registry.rejectPlanReview(
        request.reviewId,
        request.feedback,
      );
      return { planReview: planReviewPreview(planReview) };
    }
    case "planReview.discard": {
      const request = params as PlanReviewParams;
      const planReview = await state.registry.discardPlanReview(
        request.reviewId,
        request.feedback,
      );
      return { planReview: planReviewPreview(planReview) };
    }
    case "conversation.create":
      return {
        conversation: await state.registry.createConversation(params as never),
      };
    case "conversation.import":
      return state.registry.importConversation(params as never);
    case "conversation.list":
      return { conversations: state.registry.listConversations() };
    case "conversation.get":
      return {
        conversation: state.registry.getConversation(
          (params as { conversationId: string }).conversationId,
        ),
      };
    case "conversation.delete":
      await state.registry.removeConversation(
        (params as { conversationId: string }).conversationId,
      );
      return { ok: true };
    case "conversation.entries.list":
      return {
        entries: state.registry.getConversationEntries(
          (params as { conversationId: string }).conversationId,
        ),
      };
    case "conversation.contextUsage.get":
      return {
        contextUsage: await state.registry.getContextUsage(
          (params as { conversationId: string }).conversationId,
        ),
      };
    case "conversation.tree.get":
      return {
        tree: state.registry.getConversationTree(
          (params as { conversationId: string }).conversationId,
        ),
      };
    case "conversation.navigate": {
      const request = params as { conversationId: string };
      return {
        conversation: await state.registry.navigateConversation(
          request.conversationId,
          request as never,
        ),
      };
    }
    case "conversation.compact": {
      const request = params as { conversationId: string };
      return state.registry.compactConversation(
        request.conversationId,
        request as never,
      );
    }
    case "conversation.compaction.cancel":
      return state.registry.cancelConversationCompaction(
        (params as { conversationId: string }).conversationId,
      );
    case "agent.create":
      return { agent: await state.registry.createAgent(params as never) };
    case "agent.list":
      return { agents: state.registry.listAgents() };
    case "agent.get":
      return {
        agent: state.registry.getAgent((params as { agentId: string }).agentId),
      };
    case "agent.configure": {
      const request = params as { agentId: string };
      return {
        agent: await state.registry.configureAgent(
          request.agentId,
          request as never,
        ),
      };
    }
    case "run.start":
    case "run.steer":
    case "run.followUp": {
      const request = params as {
        agentId?: string;
        text: string;
        images?: unknown[];
      };
      if (!request.agentId) throw new Error(`${method} requires agentId`);
      await state.registry.promptAgent(request.agentId, {
        ...request,
        behavior:
          method === "run.steer"
            ? "steer"
            : method === "run.followUp"
              ? "follow-up"
              : "reject-if-busy",
      } as never);
      return { accepted: true, agentId: request.agentId };
    }
    case "agent.promptQueue.list":
      return {
        queuedPrompts: await state.registry.listQueuedPrompts(
          (params as { agentId: string }).agentId,
        ),
      };
    case "agent.promptQueue.cancel":
      return {
        queuedPrompt: await state.registry.cancelQueuedPrompt(
          (params as { agentId: string }).agentId,
          (params as { queuedPromptId: string }).queuedPromptId,
        ),
      };
    case "agent.requestTool": {
      const request = params as {
        agentId: string;
        toolName: Parameters<OrchestratorState["registry"]["requestTool"]>[1];
        args: Record<string, unknown>;
      };
      return state.registry.requestTool(
        request.agentId,
        request.toolName,
        request.args,
      );
    }
    case "run.continue": {
      const request = params as { agentId?: string; runId?: string };
      if (!request.agentId || !request.runId)
        throw new Error("run.continue requires agentId and runId");
      await state.registry.continueRun(request.agentId, request.runId);
      return {
        accepted: true,
        agentId: request.agentId,
        runId: request.runId,
      };
    }
    case "run.cancel": {
      const request = params as {
        agentId?: string;
        runId?: string;
        reason?: string;
      };
      if (!request.agentId && !request.runId) {
        throw new Error("run.cancel requires agentId or runId");
      }
      await state.registry.abortRun(request);
      return {
        accepted: true,
        agentId: request.agentId,
        runId: request.runId,
        status: "cancelled",
      };
    }
    case "project.create":
      return { project: await state.registry.createProject(params as never) };
    case "project.list":
      return { projects: state.registry.listProjects() };
    case "project.get":
      return {
        project: state.registry.getProject(
          (params as { projectId: string }).projectId,
        ),
      };
    case "project.openEditor": {
      const request = params as { projectId: string };
      return state.registry.openProjectInEditor(
        request.projectId,
        request as never,
      );
    }
    case "project.conversations.prune": {
      const request = params as { projectId: string };
      return state.registry.pruneProjectConversations(
        request.projectId,
        request as never,
      );
    }
    case "project.delete":
      await state.registry.removeProject(
        (params as { projectId: string }).projectId,
      );
      return { ok: true };
    case "pinnedCommand.list":
      return {
        commands: await state.registry.listPinnedCommands(
          (params as { projectId: string }).projectId,
        ),
      };
    case "pinnedCommand.create": {
      const request = params as { projectId: string };
      return {
        command: await state.registry.createPinnedCommand(
          request.projectId,
          request as never,
        ),
      };
    }
    case "pinnedCommand.update": {
      const request = params as { projectId: string; commandId: string };
      return {
        command: await state.registry.updatePinnedCommand(
          request.projectId,
          request.commandId,
          request as never,
        ),
      };
    }
    case "pinnedCommand.delete":
      await state.registry.removePinnedCommand(
        (params as { projectId: string }).projectId,
        (params as { commandId: string }).commandId,
      );
      return { ok: true };
    case "scratchNote.list":
    case "scratchNote.create":
    case "scratchNote.update":
    case "scratchNote.delete":
      return handleScratchNoteMethod(state, method, params);
    case "task.list":
      return { tasks: state.registry.listTasks() };
    case "task.start":
      return { task: await state.registry.startTask(params as never) };
    case "task.get":
      return {
        task: state.registry.getTask((params as { taskId: string }).taskId),
      };
    case "task.cancel": {
      const request = params as { taskId: string };
      state.registry.getTask(request.taskId);
      return {
        task: await state.registry.cancelTask(request.taskId, request as never),
      };
    }
    case "task.restart": {
      const taskId = (params as { taskId: string }).taskId;
      state.registry.getTask(taskId);
      return { task: await state.registry.restartTask(taskId) };
    }
    case "task.prune":
      return { removed: await state.registry.pruneTasks() };
    case "task.delete": {
      const taskId = (params as { taskId: string }).taskId;
      state.registry.getTask(taskId);
      await state.registry.removeTask(taskId);
      return { removed: true };
    }
    case "task.logs": {
      const request = params as { taskId: string };
      const { taskId, ...query } = request;
      return state.registry.queryTaskLogs(taskId, query);
    }
    case "git.repos.discover":
      return state.registry.git.discoverRepos(
        (params as { projectId: string }).projectId,
      );
    case "git.overview.get":
      return state.registry.git.overview(
        (params as { projectId: string }).projectId,
        repo(params),
      );
    case "git.branches.list":
      return state.registry.git.listBranches(
        (params as { projectId: string }).projectId,
        repo(params),
      );
    case "git.branch.create":
      return state.registry.git.createBranch(
        (params as { projectId: string }).projectId,
        repo(params),
        (params as { name: string }).name,
      );
    case "git.branch.switch":
      return state.registry.git.switchBranch(
        (params as { projectId: string }).projectId,
        repo(params),
        (params as { name: string }).name,
      );
    case "git.file.stage":
      return state.registry.git.stageFile(
        (params as { projectId: string }).projectId,
        repo(params),
        (params as { path: string }).path,
      );
    case "git.file.unstage":
      return state.registry.git.unstageFile(
        (params as { projectId: string }).projectId,
        repo(params),
        (params as { path: string }).path,
      );
    case "git.file.discard":
      return state.registry.git.discardFile(
        (params as { projectId: string }).projectId,
        repo(params),
        (params as { path: string }).path,
      );
    case "git.sync":
      return state.registry.git.syncBranch(
        (params as { projectId: string }).projectId,
        repo(params),
      );
    case "git.push":
      return state.registry.git.push(
        (params as { projectId: string }).projectId,
        repo(params),
      );
    case "git.pull":
      return state.registry.git.pull(
        (params as { projectId: string }).projectId,
        repo(params),
      );
    case "git.fetch":
      return state.registry.git.fetch(
        (params as { projectId: string }).projectId,
        repo(params),
      );
    case "git.switchBaseAndPull":
      return state.registry.git.switchBaseAndPull(
        (params as { projectId: string }).projectId,
        repo(params),
      );
    case "github.status.get":
      return state.registry.git.githubStatus(
        (params as { projectId: string }).projectId,
        repo(params),
      );
    case "github.pr.list":
      return state.registry.git.listOpenPrs(
        (params as { projectId: string }).projectId,
        repo(params),
        (params as { filters: GithubPrListFilters }).filters,
      );
    case "github.pr.get":
      return state.registry.git.prDetail(
        (params as { projectId: string }).projectId,
        repo(params),
        (params as { number: number }).number,
      );
    case "github.pr.checkout":
      return state.registry.git.checkoutPr(
        (params as { projectId: string }).projectId,
        repo(params),
        (params as { number: number }).number,
      );
    case "promptSuggestion.listForProject": {
      const request = params as {
        projectId: string;
        conversationId?: string;
        agentId?: string;
      };
      return state.registry.promptSuggestions.listForProject(
        request.projectId,
        {
          conversationId: request.conversationId,
          agentId: request.agentId,
        },
      );
    }
    case "promptSuggestion.statuses.list":
      return {
        statuses: await state.registry.promptSuggestions.listStatuses(
          (params as { projectId?: string } | undefined)?.projectId,
        ),
      };
    case "promptSuggestion.trust.update":
      await state.registry.promptSuggestions.updateTrust(params as never);
      return { ok: true };
    case "completion.slash.list":
      return { items: slashCompletionItems };
    case "completion.files.list": {
      const files = new FileCompletionService((projectId) =>
        state.registry.getProject(projectId),
      );
      const request = params as {
        projectId?: string;
        q?: string;
        limit?: number;
      };
      return {
        items: await files.completeFiles(request.projectId, request.q ?? "", {
          limit: request.limit,
        }),
      };
    }
    case "filesystem.directories.list":
      return directoryListing(
        (params as { path?: string; showHidden?: boolean } | undefined)?.path,
        (params as { showHidden?: boolean } | undefined)?.showHidden,
      );
    case "worker.list":
      return { workers: state.registry.listWorkers() };
    case "worker.get":
      return {
        worker: state.registry.getWorker(
          (params as { workerId: string }).workerId,
        ),
      };
    case "applicationLog.prune":
      return state.logger.prune(params as never);
  }
}

interface PlanReviewParams {
  reviewId: string;
  feedback?: string;
  implementationModel?: ModelSelection;
  implementationThinkingLevel?: ThinkingLevel;
}

function implementation(request: PlanReviewParams) {
  return {
    implementationModel: request.implementationModel,
    implementationThinkingLevel: request.implementationThinkingLevel,
  };
}

async function updateSettings(
  state: OrchestratorState,
  patch: Record<string, unknown>,
) {
  const settings = await writeSettings(state.storage, patch as never);
  if (
    patch.runtime &&
    typeof patch.runtime === "object" &&
    "pythonExecutablePath" in patch.runtime
  ) {
    await state.registry.pythonRuntime.refresh();
  }
  await state.events.publish("settings.updated", { settings });
  return { settings };
}

async function publishProviderCatalogChanged(
  state: OrchestratorState,
  provider?: string,
): Promise<void> {
  await state.events.publish("providers.catalog_changed", { provider });
  await state.events.publish("auth.providers_changed", { provider });
}

function repo(params: unknown): string {
  return (params as { repo?: string }).repo || ".";
}
