import { ATTACHMENT_MAX_BYTES } from "@nervekit/contracts/filesystem";
import type {
  HtmlPreviewCreateRequest,
  HtmlPreviewCreateResponse,
  AttachmentUploadResponse,
  FilesystemDirectoryResponse,
  FilesystemFileResponse,
  FilesystemFileSaveRequest,
  FilesystemProjectEntriesQuery,
  FilesystemProjectEntriesResponse,
  FilesystemProjectEntryCreateRequest,
  FilesystemProjectEntryCreateResponse,
} from "@nervekit/contracts/filesystem";
import {
  apiDeleteNoContent,
  apiGet,
  apiPost,
  apiPut,
  fileToBase64,
} from "$lib/platform/http/api-client";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";
import { workspaceMonitorDemand } from "$lib/application/monitoring/workspace-monitor-demand";

export function createHtmlPreview(
  request: HtmlPreviewCreateRequest,
): Promise<HtmlPreviewCreateResponse> {
  return apiPost<HtmlPreviewCreateResponse>(
    "/api/filesystem/html-preview",
    request,
  );
}

export function revokeHtmlPreview(id: string): Promise<void> {
  return apiDeleteNoContent(
    `/api/filesystem/html-preview/${encodeURIComponent(id)}`,
  );
}

export async function uploadAttachment(file: File): Promise<string> {
  if (file.size > ATTACHMENT_MAX_BYTES)
    throw new Error("Attachments must be 20 MiB or smaller.");
  const response = await apiPost<AttachmentUploadResponse>(
    "/api/filesystem/attachment",
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
  return await requestWorkbench("filesystem.directories.list", {
    path,
    showHidden,
  });
}

export async function listProjectEntries(
  query: FilesystemProjectEntriesQuery,
): Promise<FilesystemProjectEntriesResponse> {
  return await requestWorkbench("filesystem.project.entries.list", query);
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
  return await requestWorkbench("filesystem.project.entries.create", request);
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
