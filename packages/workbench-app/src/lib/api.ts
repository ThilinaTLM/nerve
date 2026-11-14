export type { Project } from "@nervekit/contracts/core";
export type { MaintenanceOperation } from "@nervekit/contracts/maintenance";
export type {
  AtlassianProfile,
  ColorTheme,
  HeaderType,
  Settings,
  TavilyProfile,
  TranscriptionModel,
  UpdateSettingsRequest,
} from "@nervekit/contracts/settings";
export type {
  AuthProviderMetadata,
  OAuthFlowInfo,
} from "@nervekit/contracts/auth";
export type { AvailableSkill } from "@nervekit/contracts/skills";
export type {
  FilesystemDirectoryResponse,
  FilesystemLocations,
  FilesystemLocation,
  FilesystemPlace,
  FilesystemFileResponse,
  FilesystemSignal,
} from "@nervekit/contracts/filesystem";
export type { ModelInfo, ModelSelection } from "@nervekit/contracts/models";
export type {
  CustomProvider,
  ModelDefinition,
  PiApi,
} from "@nervekit/contracts/providers";
export type {
  GitBranchSummary,
  GithubChecksSummary,
  GithubPr,
  GithubPrChecksResponse,
  GithubPrCommitsResponse,
  GithubPrConversation,
  GithubPrCore,
  GithubPrFileDiffResponse,
  GithubPrFilesResponse,
  GithubPrMergeMethod,
  GithubPrOverview,
  GithubStatusResponse,
  GitRepoSummary,
} from "@nervekit/contracts/git";
export type { ProjectEditor } from "@nervekit/contracts/projects";
export type {
  LaunchLogQueryResponse,
  LaunchRecord,
} from "@nervekit/contracts/launches";
export type { StatusResponse } from "@nervekit/contracts/status";
export type {
  StorageCleanupTarget,
  StorageUsageResponse,
} from "@nervekit/contracts/storage";
export type {
  SubscriptionUsage,
  SubscriptionWindow,
} from "@nervekit/contracts/usage";

export * from "$lib/platform/http/api-client";
export * from "./features/audio/api/transcription.api";
export * from "./features/auth/api/auth.api";
export * from "./features/auth/api/provider-catalog.api";
export { getClientConfig } from "./features/config/api/config.api";
export type { ClientConfig } from "./features/config/api/config.api";
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

export function listAvailableSkills(projectId?: string) {
  return requestConversation("skill.list", { projectId });
}
export async function listTools() {
  return (await requestConversation("tool.list", {})).tools;
}
export * from "./features/launches/api/launches.api";
export * from "./features/usage/api/usage.api";

export * from "./features/prompt-suggestions/api/prompt-suggestions.api";
