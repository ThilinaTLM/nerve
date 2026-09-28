import type {
  ClipboardImageUploadResponse,
  FilesystemDirectoryResponse,
  FilesystemFileResponse,
  FilesystemFileSaveRequest,
  FilesystemProjectEntriesQuery,
  FilesystemProjectEntriesResponse,
  FilesystemProjectEntryCreateRequest,
  FilesystemProjectEntryCreateResponse,
} from "@nervekit/contracts/filesystem";
import {
  apiGet,
  apiPost,
  apiPut,
  fileToBase64,
} from "$lib/platform/http/api-client";
import { protocolRequest } from "@nervekit/protocol/adapters";
import { workspaceMonitorDemand } from "$lib/application/monitoring/workspace-monitor-demand";

export async function uploadClipboardImage(file: File): Promise<string> {
  const response = await apiPost<ClipboardImageUploadResponse>(
    "/api/filesystem/clipboard-image",
    {
      name: file.name,
      type: file.type,
      dataBase64: await fileToBase64(file),
    },
  );
  return response.path;
}

export async function listDirectories(
  path?: string,
  showHidden = false,
): Promise<FilesystemDirectoryResponse> {
  return (
    await protocolRequest("filesystem.directories.list", { path, showHidden })
  ).result;
}

export async function listProjectEntries(
  query: FilesystemProjectEntriesQuery,
): Promise<FilesystemProjectEntriesResponse> {
  return (await protocolRequest("filesystem.project.entries.list", query))
    .result;
}

export function syncProjectMonitor(
  projectId: string,
  directories: string[],
): Promise<void> {
  return workspaceMonitorDemand.syncProject(projectId, directories);
}

export function clearProjectMonitor(projectId: string): Promise<void> {
  return workspaceMonitorDemand.clearProject(projectId);
}

export async function createProjectEntry(
  request: FilesystemProjectEntryCreateRequest,
): Promise<FilesystemProjectEntryCreateResponse> {
  return (await protocolRequest("filesystem.project.entries.create", request))
    .result;
}

export async function getFileContent(
  projectId: string,
  path: string,
  line?: number,
): Promise<FilesystemFileResponse> {
  const params = new URLSearchParams({ projectId, path });
  if (line !== undefined) params.set("line", String(line));
  return apiGet<FilesystemFileResponse>(
    `/api/filesystem/file?${params.toString()}`,
  );
}

export async function saveFileContent(
  request: FilesystemFileSaveRequest,
): Promise<FilesystemFileResponse> {
  return apiPut<FilesystemFileResponse>("/api/filesystem/file", request);
}
