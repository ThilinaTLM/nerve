// biome-ignore lint/style/noExcessiveLinesPerFile: Protocol method registry intentionally centralizes v1 method names and schemas.
import { z } from "zod";
import {
  agentRecordSchema,
  continueFromFailureRequestSchema,
  createAgentRequestSchema,
  promptRequestSchema,
  queuedPromptRecordSchema,
  updateAgentRequestSchema,
} from "../agents/index.js";
import { authProviderMetadataSchema } from "../auth/index.js";
import {
  completionItemSchema,
  fileCompletionQuerySchema,
} from "../completions/index.js";
import {
  compactConversationRequestSchema,
  conversationEntrySchema,
  conversationRecordSchema,
  conversationTreeSchema,
  createConversationRequestSchema,
  importConversationRequestSchema,
  navigateConversationRequestSchema,
} from "../conversations/index.js";
import {
  filesystemDirectoryQuerySchema,
  filesystemDirectoryResponseSchema,
} from "../filesystem/index.js";
import {
  createBranchRequestSchema,
  gitBranchListResponseSchema,
  gitDiscoveryResponseSchema,
  gitFileActionRequestSchema,
  githubPrCheckoutResponseSchema,
  githubPrDetailSchema,
  githubPrListResponseSchema,
  githubStatusResponseSchema,
  gitMutationResponseSchema,
  gitOverviewResponseSchema,
  gitRemoteOpRequestSchema,
  switchBranchRequestSchema,
} from "../git/index.js";
import {
  applicationLogPruneRequestSchema,
  applicationLogPruneResponseSchema,
} from "../logs/index.js";
import { contextUsageSchema, modelInfoSchema } from "../models/index.js";
import {
  createPinnedCommandRequestSchema,
  pinnedCommandSchema,
  updatePinnedCommandRequestSchema,
} from "../pinned-commands/index.js";
import {
  planReviewRecordSchema,
  planReviewStatusSchema,
  resolvePlanReviewRequestSchema,
} from "../plans/index.js";
import {
  createProjectRequestSchema,
  openProjectInEditorRequestSchema,
  openProjectInEditorResponseSchema,
  projectRecordSchema,
  pruneProjectConversationsRequestSchema,
  pruneProjectConversationsResponseSchema,
} from "../projects/index.js";
import {
  promptSuggestionListResponseSchema,
  promptSuggestionStatusSchema,
  updatePromptSuggestionTrustRequestSchema,
} from "../prompt-suggestions/index.js";
import {
  providerCatalogSchema,
  upsertCustomProviderRequestSchema,
  upsertModelDefinitionRequestSchema,
} from "../providers/index.js";
import {
  settingsSchema,
  updateSettingsRequestSchema,
} from "../settings/index.js";
import { storageInfoSchema } from "../status/index.js";
import {
  storageCleanupRequestSchema,
  storageCleanupResponseSchema,
  storageUsageResponseSchema,
} from "../storage/index.js";
import { startTaskRequestSchema, taskRecordSchema } from "../tasks/index.js";
import {
  answerUserQuestionRequestSchema,
  approvalRecordSchema,
  approvalStatusSchema,
  dismissUserQuestionRequestSchema,
  executeToolRequestSchema,
  resolveApprovalRequestSchema,
  toolCallRecordSchema,
  toolCallStatusSchema,
  toolCallTranscriptRecordSchema,
  toolDescriptorSchema,
  userQuestionRecordSchema,
  userQuestionStatusSchema,
} from "../tools/index.js";
import { subscriptionUsageSchema } from "../usage/index.js";
import { workerRecordSchema } from "../workers/index.js";
import {
  conversationSnapshotResponseSchema,
  workspaceSnapshotResponseSchema,
} from "./snapshot.schema.js";

export const protocolMethodNameSchema = z.enum([
  "snapshot.workspace.get",
  "snapshot.conversation.get",
  "settings.get",
  "settings.update",
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
  "agent.prompt",
  "agent.promptQueue.list",
  "agent.promptQueue.cancel",
  "agent.requestTool",
  "agent.continueFromFailure",
  "agent.abort",
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
  "task.list",
  "task.start",
  "task.get",
  "task.cancel",
  "task.restart",
  "task.prune",
  "task.delete",
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
]);
export type ProtocolMethodName = z.infer<typeof protocolMethodNameSchema>;

export const protocolMethodKindSchema = z.enum([
  "read",
  "mutation",
  "accepted_async",
]);
export type ProtocolMethodKind = z.infer<typeof protocolMethodKindSchema>;

export const protocolMethodIdempotencySchema = z.enum([
  "none",
  "recommended",
  "required",
]);
export type ProtocolMethodIdempotency = z.infer<
  typeof protocolMethodIdempotencySchema
>;

export interface ProtocolMethodDefinition {
  method: ProtocolMethodName;
  paramsSchema: z.ZodType;
  resultSchema: z.ZodType;
  kind: ProtocolMethodKind;
  idempotency: ProtocolMethodIdempotency;
}

const emptyParamsSchema = z.object({}).optional();
const okResultSchema = z.object({ ok: z.literal(true) });
const countsSchema = z.record(z.string(), z.number().int().nonnegative());

const projectIdSchema = z.string().startsWith("proj_");
const conversationIdSchema = z.string().startsWith("conv_");
const agentIdSchema = z.string().startsWith("agent_");
const taskIdSchema = z.string().startsWith("task_");
const toolCallIdSchema = z.string().startsWith("tool_");
const workerIdSchema = z.string().startsWith("worker_");
const queuedPromptIdSchema = z.string().startsWith("promptq_");
const pinnedCommandIdSchema = z.string().startsWith("pin_");

const projectIdParamsSchema = z.object({ projectId: projectIdSchema });
const conversationIdParamsSchema = z.object({
  conversationId: conversationIdSchema,
});
const agentIdParamsSchema = z.object({ agentId: agentIdSchema });
const taskIdParamsSchema = z.object({ taskId: taskIdSchema });
const workerIdParamsSchema = z.object({ workerId: workerIdSchema });

const conversationSnapshotParamsSchema = conversationIdParamsSchema;
const approvalParamsSchema = z
  .object({ approvalId: z.string().startsWith("approval_") })
  .merge(resolveApprovalRequestSchema);
const userQuestionAnswerParamsSchema = z
  .object({ questionId: z.string().startsWith("question_") })
  .merge(answerUserQuestionRequestSchema);
const userQuestionDismissParamsSchema = z
  .object({ questionId: z.string().startsWith("question_") })
  .merge(dismissUserQuestionRequestSchema);
const planReviewParamsSchema = z
  .object({ reviewId: z.string().startsWith("plan_review_") })
  .merge(resolvePlanReviewRequestSchema);

const deleteProviderParamsSchema = z.object({ id: z.string().min(1) });
const deleteModelParamsSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
});
const toolCallListParamsSchema = z
  .object({
    status: toolCallStatusSchema.optional(),
    limit: z.number().int().positive().max(1_000).optional(),
  })
  .optional();
const toolCallGetParamsSchema = z.object({ toolCallId: toolCallIdSchema });
const approvalListParamsSchema = z
  .object({ status: approvalStatusSchema.optional() })
  .optional();
const userQuestionListParamsSchema = z
  .object({ status: userQuestionStatusSchema.optional() })
  .optional();
const planReviewListParamsSchema = z
  .object({ status: planReviewStatusSchema.optional() })
  .optional();
const conversationNavigateParamsSchema = conversationIdParamsSchema.merge(
  navigateConversationRequestSchema,
);
const conversationCompactParamsSchema = conversationIdParamsSchema.merge(
  compactConversationRequestSchema,
);
const agentConfigureParamsSchema = agentIdParamsSchema.merge(
  updateAgentRequestSchema,
);
const agentPromptParamsSchema = agentIdParamsSchema.merge(promptRequestSchema);
const agentPromptQueueParamsSchema = agentIdParamsSchema;
const agentPromptQueueCancelParamsSchema = agentIdParamsSchema.extend({
  queuedPromptId: queuedPromptIdSchema,
});
const agentRequestToolParamsSchema = agentIdParamsSchema.merge(
  executeToolRequestSchema,
);
const agentContinueFromFailureParamsSchema = agentIdParamsSchema.merge(
  continueFromFailureRequestSchema,
);
const projectOpenEditorParamsSchema = projectIdParamsSchema.merge(
  openProjectInEditorRequestSchema,
);
const projectPruneConversationsParamsSchema = z.intersection(
  projectIdParamsSchema,
  pruneProjectConversationsRequestSchema,
);
const pinnedCommandListParamsSchema = projectIdParamsSchema;
const pinnedCommandCreateParamsSchema = projectIdParamsSchema.merge(
  createPinnedCommandRequestSchema,
);
const pinnedCommandUpdateParamsSchema = projectIdParamsSchema
  .extend({ commandId: pinnedCommandIdSchema })
  .merge(updatePinnedCommandRequestSchema);
const pinnedCommandDeleteParamsSchema = projectIdParamsSchema.extend({
  commandId: pinnedCommandIdSchema,
});
const taskCancelParamsSchema = taskIdParamsSchema.extend({
  signal: z.enum(["SIGTERM", "SIGINT", "SIGKILL"]).optional(),
  timeoutMs: z.number().int().positive().max(30_000).optional(),
  reason: z.string().min(1).optional(),
});
const gitRepoParamsSchema = projectIdParamsSchema.extend({
  repo: z.string().min(1).default("."),
});
const gitCreateBranchParamsSchema = projectIdParamsSchema.merge(
  createBranchRequestSchema,
);
const gitSwitchBranchParamsSchema = projectIdParamsSchema.merge(
  switchBranchRequestSchema,
);
const gitFileActionParamsSchema = projectIdParamsSchema.merge(
  gitFileActionRequestSchema,
);
const gitRemoteOpParamsSchema = projectIdParamsSchema.merge(
  gitRemoteOpRequestSchema,
);
const githubPrParamsSchema = gitRepoParamsSchema.extend({
  number: z.number().int().positive(),
});
const promptSuggestionListParamsSchema = projectIdParamsSchema.extend({
  conversationId: conversationIdSchema.optional(),
  agentId: agentIdSchema.optional(),
});
const promptSuggestionStatusesParamsSchema = z
  .object({ projectId: projectIdSchema.optional() })
  .optional();

const methodDefinitions = {
  "snapshot.workspace.get": def(
    "snapshot.workspace.get",
    emptyParamsSchema,
    workspaceSnapshotResponseSchema,
    "read",
    "none",
  ),
  "snapshot.conversation.get": def(
    "snapshot.conversation.get",
    conversationSnapshotParamsSchema,
    conversationSnapshotResponseSchema,
    "read",
    "none",
  ),
  "settings.get": def(
    "settings.get",
    emptyParamsSchema,
    settingsSchema,
    "read",
    "none",
  ),
  "settings.update": def(
    "settings.update",
    updateSettingsRequestSchema,
    z.object({ settings: settingsSchema }),
    "mutation",
    "recommended",
  ),
  "auth.providers.list": def(
    "auth.providers.list",
    emptyParamsSchema,
    z.object({ providers: z.array(authProviderMetadataSchema) }),
    "read",
    "none",
  ),
  "providerCatalog.get": def(
    "providerCatalog.get",
    emptyParamsSchema,
    providerCatalogSchema,
    "read",
    "none",
  ),
  "providerCatalog.custom.upsert": def(
    "providerCatalog.custom.upsert",
    upsertCustomProviderRequestSchema,
    providerCatalogSchema,
    "mutation",
    "recommended",
  ),
  "providerCatalog.custom.delete": def(
    "providerCatalog.custom.delete",
    deleteProviderParamsSchema,
    providerCatalogSchema,
    "mutation",
    "recommended",
  ),
  "providerCatalog.model.upsert": def(
    "providerCatalog.model.upsert",
    upsertModelDefinitionRequestSchema,
    providerCatalogSchema,
    "mutation",
    "recommended",
  ),
  "providerCatalog.model.delete": def(
    "providerCatalog.model.delete",
    deleteModelParamsSchema,
    providerCatalogSchema,
    "mutation",
    "recommended",
  ),
  "storage.info": def(
    "storage.info",
    emptyParamsSchema,
    storageInfoSchema,
    "read",
    "none",
  ),
  "storage.rebuildIndex": def(
    "storage.rebuildIndex",
    emptyParamsSchema,
    z.object({ ok: z.literal(true), counts: countsSchema.optional() }),
    "mutation",
    "recommended",
  ),
  "storage.usage.get": def(
    "storage.usage.get",
    emptyParamsSchema,
    storageUsageResponseSchema,
    "read",
    "none",
  ),
  "storage.cleanup": def(
    "storage.cleanup",
    storageCleanupRequestSchema,
    storageCleanupResponseSchema,
    "mutation",
    "recommended",
  ),
  "model.list": def(
    "model.list",
    emptyParamsSchema,
    z.object({ models: z.array(modelInfoSchema) }),
    "read",
    "none",
  ),
  "usage.subscription.get": def(
    "usage.subscription.get",
    emptyParamsSchema,
    z.object({ usage: z.array(subscriptionUsageSchema) }),
    "read",
    "none",
  ),
  "tool.list": def(
    "tool.list",
    emptyParamsSchema,
    z.object({ tools: z.array(toolDescriptorSchema) }),
    "read",
    "none",
  ),
  "toolCall.list": def(
    "toolCall.list",
    toolCallListParamsSchema,
    z.object({ toolCalls: z.array(toolCallTranscriptRecordSchema) }),
    "read",
    "none",
  ),
  "toolCall.get": def(
    "toolCall.get",
    toolCallGetParamsSchema,
    z.object({ toolCall: toolCallRecordSchema }),
    "read",
    "none",
  ),
  "approval.list": def(
    "approval.list",
    approvalListParamsSchema,
    z.object({ approvals: z.array(approvalRecordSchema) }),
    "read",
    "none",
  ),
  "approval.grant": def(
    "approval.grant",
    approvalParamsSchema,
    z.object({ toolCall: toolCallRecordSchema }),
    "mutation",
    "recommended",
  ),
  "approval.deny": def(
    "approval.deny",
    approvalParamsSchema,
    z.object({ toolCall: toolCallRecordSchema }),
    "mutation",
    "recommended",
  ),
  "userQuestion.list": def(
    "userQuestion.list",
    userQuestionListParamsSchema,
    z.object({ questions: z.array(userQuestionRecordSchema) }),
    "read",
    "none",
  ),
  "userQuestion.answer": def(
    "userQuestion.answer",
    userQuestionAnswerParamsSchema,
    z.object({ question: userQuestionRecordSchema }),
    "mutation",
    "recommended",
  ),
  "userQuestion.dismiss": def(
    "userQuestion.dismiss",
    userQuestionDismissParamsSchema,
    z.object({ question: userQuestionRecordSchema }),
    "mutation",
    "recommended",
  ),
  "planReview.list": def(
    "planReview.list",
    planReviewListParamsSchema,
    z.object({ planReviews: z.array(planReviewRecordSchema) }),
    "read",
    "none",
  ),
  "planReview.accept": def(
    "planReview.accept",
    planReviewParamsSchema,
    z.object({ planReview: planReviewRecordSchema }),
    "mutation",
    "recommended",
  ),
  "planReview.acceptInNewChat": def(
    "planReview.acceptInNewChat",
    planReviewParamsSchema,
    z.object({
      planReview: planReviewRecordSchema,
      conversation: conversationRecordSchema,
      agent: agentRecordSchema,
    }),
    "mutation",
    "recommended",
  ),
  "planReview.requestChanges": def(
    "planReview.requestChanges",
    planReviewParamsSchema,
    z.object({ planReview: planReviewRecordSchema }),
    "mutation",
    "recommended",
  ),
  "planReview.reject": def(
    "planReview.reject",
    planReviewParamsSchema,
    z.object({ planReview: planReviewRecordSchema }),
    "mutation",
    "recommended",
  ),
  "planReview.discard": def(
    "planReview.discard",
    planReviewParamsSchema,
    z.object({ planReview: planReviewRecordSchema }),
    "mutation",
    "recommended",
  ),
  "conversation.create": def(
    "conversation.create",
    createConversationRequestSchema,
    z.object({ conversation: conversationRecordSchema }),
    "mutation",
    "recommended",
  ),
  "conversation.import": def(
    "conversation.import",
    importConversationRequestSchema,
    z.object({ conversation: conversationRecordSchema }),
    "mutation",
    "recommended",
  ),
  "conversation.list": def(
    "conversation.list",
    emptyParamsSchema,
    z.object({ conversations: z.array(conversationRecordSchema) }),
    "read",
    "none",
  ),
  "conversation.get": def(
    "conversation.get",
    conversationIdParamsSchema,
    z.object({ conversation: conversationRecordSchema }),
    "read",
    "none",
  ),
  "conversation.delete": def(
    "conversation.delete",
    conversationIdParamsSchema,
    okResultSchema,
    "mutation",
    "recommended",
  ),
  "conversation.entries.list": def(
    "conversation.entries.list",
    conversationIdParamsSchema,
    z.object({ entries: z.array(conversationEntrySchema) }),
    "read",
    "none",
  ),
  "conversation.contextUsage.get": def(
    "conversation.contextUsage.get",
    conversationIdParamsSchema,
    z.object({ contextUsage: contextUsageSchema }),
    "read",
    "none",
  ),
  "conversation.tree.get": def(
    "conversation.tree.get",
    conversationIdParamsSchema,
    z.object({ tree: conversationTreeSchema }),
    "read",
    "none",
  ),
  "conversation.navigate": def(
    "conversation.navigate",
    conversationNavigateParamsSchema,
    z.object({ conversation: conversationRecordSchema }),
    "mutation",
    "recommended",
  ),
  "conversation.compact": def(
    "conversation.compact",
    conversationCompactParamsSchema,
    z.object({
      conversation: conversationRecordSchema,
      entry: conversationEntrySchema,
    }),
    "mutation",
    "recommended",
  ),
  "agent.create": def(
    "agent.create",
    createAgentRequestSchema,
    z.object({ agent: agentRecordSchema }),
    "mutation",
    "recommended",
  ),
  "agent.list": def(
    "agent.list",
    emptyParamsSchema,
    z.object({ agents: z.array(agentRecordSchema) }),
    "read",
    "none",
  ),
  "agent.get": def(
    "agent.get",
    agentIdParamsSchema,
    z.object({ agent: agentRecordSchema }),
    "read",
    "none",
  ),
  "agent.configure": def(
    "agent.configure",
    agentConfigureParamsSchema,
    z.object({ agent: agentRecordSchema }),
    "mutation",
    "recommended",
  ),
  "agent.prompt": def(
    "agent.prompt",
    agentPromptParamsSchema,
    okResultSchema,
    "accepted_async",
    "recommended",
  ),
  "agent.promptQueue.list": def(
    "agent.promptQueue.list",
    agentPromptQueueParamsSchema,
    z.object({ queuedPrompts: z.array(queuedPromptRecordSchema) }),
    "read",
    "none",
  ),
  "agent.promptQueue.cancel": def(
    "agent.promptQueue.cancel",
    agentPromptQueueCancelParamsSchema,
    z.object({ queuedPrompt: queuedPromptRecordSchema }),
    "mutation",
    "recommended",
  ),
  "agent.requestTool": def(
    "agent.requestTool",
    agentRequestToolParamsSchema,
    z.object({
      toolCall: toolCallRecordSchema,
      approval: approvalRecordSchema.optional(),
    }),
    "mutation",
    "recommended",
  ),
  "agent.continueFromFailure": def(
    "agent.continueFromFailure",
    agentContinueFromFailureParamsSchema,
    okResultSchema,
    "accepted_async",
    "recommended",
  ),
  "agent.abort": def(
    "agent.abort",
    agentIdParamsSchema,
    okResultSchema,
    "mutation",
    "recommended",
  ),
  "project.create": def(
    "project.create",
    createProjectRequestSchema,
    z.object({ project: projectRecordSchema }),
    "mutation",
    "recommended",
  ),
  "project.list": def(
    "project.list",
    emptyParamsSchema,
    z.object({ projects: z.array(projectRecordSchema) }),
    "read",
    "none",
  ),
  "project.get": def(
    "project.get",
    projectIdParamsSchema,
    z.object({ project: projectRecordSchema }),
    "read",
    "none",
  ),
  "project.openEditor": def(
    "project.openEditor",
    projectOpenEditorParamsSchema,
    openProjectInEditorResponseSchema,
    "mutation",
    "recommended",
  ),
  "project.conversations.prune": def(
    "project.conversations.prune",
    projectPruneConversationsParamsSchema,
    pruneProjectConversationsResponseSchema,
    "mutation",
    "recommended",
  ),
  "project.delete": def(
    "project.delete",
    projectIdParamsSchema,
    okResultSchema,
    "mutation",
    "recommended",
  ),
  "pinnedCommand.list": def(
    "pinnedCommand.list",
    pinnedCommandListParamsSchema,
    z.object({ commands: z.array(pinnedCommandSchema) }),
    "read",
    "none",
  ),
  "pinnedCommand.create": def(
    "pinnedCommand.create",
    pinnedCommandCreateParamsSchema,
    z.object({ command: pinnedCommandSchema }),
    "mutation",
    "recommended",
  ),
  "pinnedCommand.update": def(
    "pinnedCommand.update",
    pinnedCommandUpdateParamsSchema,
    z.object({ command: pinnedCommandSchema }),
    "mutation",
    "recommended",
  ),
  "pinnedCommand.delete": def(
    "pinnedCommand.delete",
    pinnedCommandDeleteParamsSchema,
    okResultSchema,
    "mutation",
    "recommended",
  ),
  "task.list": def(
    "task.list",
    emptyParamsSchema,
    z.object({ tasks: z.array(taskRecordSchema) }),
    "read",
    "none",
  ),
  "task.start": def(
    "task.start",
    startTaskRequestSchema,
    z.object({ task: taskRecordSchema }),
    "mutation",
    "recommended",
  ),
  "task.get": def(
    "task.get",
    taskIdParamsSchema,
    z.object({ task: taskRecordSchema }),
    "read",
    "none",
  ),
  "task.cancel": def(
    "task.cancel",
    taskCancelParamsSchema,
    z.object({ task: taskRecordSchema }),
    "mutation",
    "recommended",
  ),
  "task.restart": def(
    "task.restart",
    taskIdParamsSchema,
    z.object({ task: taskRecordSchema }),
    "mutation",
    "recommended",
  ),
  "task.prune": def(
    "task.prune",
    emptyParamsSchema,
    z.object({ removed: z.array(taskIdSchema) }),
    "mutation",
    "recommended",
  ),
  "task.delete": def(
    "task.delete",
    taskIdParamsSchema,
    z.object({ removed: z.literal(true) }),
    "mutation",
    "recommended",
  ),
  "git.repos.discover": def(
    "git.repos.discover",
    projectIdParamsSchema,
    gitDiscoveryResponseSchema,
    "read",
    "none",
  ),
  "git.overview.get": def(
    "git.overview.get",
    gitRepoParamsSchema,
    gitOverviewResponseSchema,
    "read",
    "none",
  ),
  "git.branches.list": def(
    "git.branches.list",
    gitRepoParamsSchema,
    gitBranchListResponseSchema,
    "read",
    "none",
  ),
  "git.branch.create": def(
    "git.branch.create",
    gitCreateBranchParamsSchema,
    gitMutationResponseSchema,
    "mutation",
    "recommended",
  ),
  "git.branch.switch": def(
    "git.branch.switch",
    gitSwitchBranchParamsSchema,
    gitMutationResponseSchema,
    "mutation",
    "recommended",
  ),
  "git.file.stage": def(
    "git.file.stage",
    gitFileActionParamsSchema,
    gitMutationResponseSchema,
    "mutation",
    "recommended",
  ),
  "git.file.unstage": def(
    "git.file.unstage",
    gitFileActionParamsSchema,
    gitMutationResponseSchema,
    "mutation",
    "recommended",
  ),
  "git.file.discard": def(
    "git.file.discard",
    gitFileActionParamsSchema,
    gitMutationResponseSchema,
    "mutation",
    "recommended",
  ),
  "git.sync": def(
    "git.sync",
    gitRemoteOpParamsSchema,
    gitMutationResponseSchema,
    "mutation",
    "recommended",
  ),
  "git.push": def(
    "git.push",
    gitRemoteOpParamsSchema,
    gitMutationResponseSchema,
    "mutation",
    "recommended",
  ),
  "git.pull": def(
    "git.pull",
    gitRemoteOpParamsSchema,
    gitMutationResponseSchema,
    "mutation",
    "recommended",
  ),
  "git.fetch": def(
    "git.fetch",
    gitRemoteOpParamsSchema,
    gitMutationResponseSchema,
    "mutation",
    "recommended",
  ),
  "git.switchBaseAndPull": def(
    "git.switchBaseAndPull",
    gitRemoteOpParamsSchema,
    gitMutationResponseSchema,
    "mutation",
    "recommended",
  ),
  "github.status.get": def(
    "github.status.get",
    gitRepoParamsSchema,
    githubStatusResponseSchema,
    "read",
    "none",
  ),
  "github.pr.list": def(
    "github.pr.list",
    gitRepoParamsSchema,
    githubPrListResponseSchema,
    "read",
    "none",
  ),
  "github.pr.get": def(
    "github.pr.get",
    githubPrParamsSchema,
    githubPrDetailSchema,
    "read",
    "none",
  ),
  "github.pr.checkout": def(
    "github.pr.checkout",
    githubPrParamsSchema,
    githubPrCheckoutResponseSchema,
    "mutation",
    "recommended",
  ),
  "promptSuggestion.listForProject": def(
    "promptSuggestion.listForProject",
    promptSuggestionListParamsSchema,
    promptSuggestionListResponseSchema,
    "read",
    "none",
  ),
  "promptSuggestion.statuses.list": def(
    "promptSuggestion.statuses.list",
    promptSuggestionStatusesParamsSchema,
    z.object({ statuses: z.array(promptSuggestionStatusSchema) }),
    "read",
    "none",
  ),
  "promptSuggestion.trust.update": def(
    "promptSuggestion.trust.update",
    updatePromptSuggestionTrustRequestSchema,
    okResultSchema,
    "mutation",
    "recommended",
  ),
  "completion.slash.list": def(
    "completion.slash.list",
    emptyParamsSchema,
    z.object({ items: z.array(completionItemSchema) }),
    "read",
    "none",
  ),
  "completion.files.list": def(
    "completion.files.list",
    fileCompletionQuerySchema,
    z.object({ items: z.array(completionItemSchema) }),
    "read",
    "none",
  ),
  "filesystem.directories.list": def(
    "filesystem.directories.list",
    filesystemDirectoryQuerySchema.optional(),
    filesystemDirectoryResponseSchema,
    "read",
    "none",
  ),
  "worker.list": def(
    "worker.list",
    emptyParamsSchema,
    z.object({ workers: z.array(workerRecordSchema) }),
    "read",
    "none",
  ),
  "worker.get": def(
    "worker.get",
    workerIdParamsSchema,
    z.object({ worker: workerRecordSchema }),
    "read",
    "none",
  ),
  "applicationLog.prune": def(
    "applicationLog.prune",
    applicationLogPruneRequestSchema,
    applicationLogPruneResponseSchema,
    "mutation",
    "recommended",
  ),
} as const satisfies Record<ProtocolMethodName, ProtocolMethodDefinition>;

export function protocolMethodDefinition(
  method: ProtocolMethodName,
): ProtocolMethodDefinition {
  return methodDefinitions[method];
}

export function protocolMethodParamsSchema(
  method: ProtocolMethodName,
): z.ZodType {
  return protocolMethodDefinition(method).paramsSchema;
}

export function protocolMethodResultSchema(
  method: ProtocolMethodName,
): z.ZodType {
  return protocolMethodDefinition(method).resultSchema;
}

export function allProtocolMethodDefinitions(): ProtocolMethodDefinition[] {
  return Object.values(methodDefinitions);
}

function def(
  method: ProtocolMethodName,
  paramsSchema: z.ZodType,
  resultSchema: z.ZodType,
  kind: ProtocolMethodKind,
  idempotency: ProtocolMethodIdempotency,
): ProtocolMethodDefinition {
  return { method, paramsSchema, resultSchema, kind, idempotency };
}
