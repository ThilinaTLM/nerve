export type {
  Project,
  ConversationSummary,
  ConversationConfig,
  ConversationSnapshot,
} from "@nervekit/contracts/core";
export type { MaintenanceOperation } from "@nervekit/contracts/maintenance";
export type {
  ApplicationLogLevel,
  ApplicationLogPruneRequest,
  ApplicationLogPruneResponse,
  ApplicationLogQueryResponse,
  ApplicationLogSource,
} from "@nervekit/contracts/logs";
export type { ToolDescriptor } from "@nervekit/contracts/tools";
export { openAiCodexImageSizeSchema } from "@nervekit/contracts/settings";
export type {
  AtlassianProfile,
  ColorMode,
  ColorTheme,
  ImageGenerationProvider,
  OpenAiCodexImageBackground,
  OpenAiCodexImageModel,
  OpenAiCodexImageQuality,
  HeaderType,
  Settings,
  TavilyProfile,
  TranscriptionModel,
  UpdateSettingsRequest,
} from "@nervekit/contracts/settings";
export type {
  AuthProviderMetadata,
  CredentialKeyResponse,
  EncryptedSecretEnvelope,
  OAuthFlowInfo,
  RespondOAuthFlowRequest,
} from "@nervekit/contracts/auth";
export type {
  AvailableSkill,
  AvailableSkillsResponse,
} from "@nervekit/contracts/skills";
export type {
  ClipboardImageUploadResponse,
  FilesystemDirectoryResponse,
  FilesystemFileResponse,
  FilesystemSignal,
} from "@nervekit/contracts/filesystem";
export type { CompletionItem } from "@nervekit/contracts/completions";
export type {
  ContextUsage,
  ModelInfo,
  ModelInputModality,
  ModelSelection,
  ThinkingLevel,
} from "@nervekit/contracts/models";
export type {
  CreateTaskDefinitionRequest,
  TaskDefinition,
  UpdateTaskDefinitionRequest,
} from "@nervekit/contracts/task-definitions";
export type {
  CustomProvider,
  ModelCost,
  ModelDefinition,
  PiApi,
  ProviderCatalog,
} from "@nervekit/contracts/providers";
export type { EventEnvelope } from "@nervekit/contracts/events";
export type {
  GitBranchListResponse,
  GitBranchSummary,
  GitDiscoveryResponse,
  GitFileChange,
  GithubChecksSummary,
  GithubPr,
  GithubPrCheckoutResponse,
  GithubPrChecksResponse,
  GithubPrComment,
  GithubPrCommit,
  GithubPrCommitsResponse,
  GithubPrConversation,
  GithubPrCore,
  GithubPrFile,
  GithubPrFileDiffResponse,
  GithubPrFileStatus,
  GithubPrFilesResponse,
  GithubPrHeadSummary,
  GithubPrHeadsResponse,
  GithubPrInitial,
  GithubPrListResponse,
  GithubPrMergeMethod,
  GithubPrMergeResponse,
  GithubPrOverview,
  GithubPrReviewSummary,
  GithubStatusResponse,
  GitMutationResponse,
  GitOverviewResponse,
  GitRecentCommit,
  GitRepoSummary,
  GitStashArea,
  GitStashEntry,
} from "@nervekit/contracts/git";
export type {
  OpenProjectInEditorResponse,
  ProjectEditor,
} from "@nervekit/contracts/projects";
export type {
  ScratchNote,
  UpdateScratchNoteRequest,
} from "@nervekit/contracts/scratch-notes";
export type {
  StartTaskRequest,
  TaskLogEvent,
  TaskLogQueryResponse,
  TaskRecord,
} from "@nervekit/contracts/tasks";
export type { StatusResponse } from "@nervekit/contracts/status";
export type {
  StorageCategoryUsage,
  StorageCleanupRequest,
  StorageCleanupResult,
  StorageCleanupTarget,
  StorageCleanupTargetUsage,
  StorageUsageResponse,
} from "@nervekit/contracts/storage";
export type {
  SubscriptionUsage,
  SubscriptionWindow,
} from "@nervekit/contracts/usage";
export type {
  PermissionException,
  PermissionOverlay,
  PermissionOverlayDocument,
  PermissionOverlayOrigin,
  PermissionPolicyConfiguration,
  PermissionRule,
  PermissionRuleSetSummary,
  ProjectPermissionTrust,
} from "@nervekit/contracts/permissions";

export * from "$lib/platform/http/api-client";
export * from "./features/audio/api/transcription.api";
export * from "./features/auth/api/auth.api";
export * from "./features/auth/api/provider-catalog.api";
export {
  getClientConfig,
  getFileCompletions,
} from "./features/config/api/config.api";
export type {
  ClientConfig,
  ModelOption,
} from "./features/config/api/config.api";
export * from "./features/filesystem/api/filesystem.api";
export * from "./features/git/api/git.api";
export * from "./features/logs/api/logs.api";
export * from "./features/projects/api/projects.api";
export * from "./features/scratch-notes/api/scratch-notes.api";
export * from "./features/settings/api/settings.api";
import { requestConversation } from "./application/startup/conversation-connection";
export async function getModels() {
  return (await requestConversation("model.list", {})).models;
}
export async function getSlashCompletions() {
  return (await requestConversation("completion.slash.list", {})).items;
}
export function listAvailableSkills(projectId?: string) {
  return requestConversation("skill.list", { projectId });
}
export async function listTools() {
  return (await requestConversation("tool.list", {})).tools;
}
export * from "./features/tasks/api/tasks.api";
export * from "./features/usage/api/usage.api";

export * from "./features/prompt-suggestions/api/prompt-suggestions.api";
