import { ATTACHMENT_MAX_BYTES } from "@nervekit/contracts/filesystem";
import type {
  HtmlPreviewCreateRequest,
  HtmlPreviewCreateResponse,
  AttachmentUploadResponse,
  FilesystemDirectoryResponse,
  FilesystemLocations,
  FilesystemFileResponse,
  FilesystemFileSaveRequest,
  FilesystemProjectEntriesQuery,
  FilesystemProjectEntriesResponse,
  FilesystemProjectEntryCreateRequest,
  FilesystemProjectEntryCreateResponse,
  FilesystemProjectEntryResponse,
  FilesystemProjectEntriesDeleteResponse,
  FilesystemProjectUploadResponse,
  FilesystemProjectMonitorState,
  FilesystemProjectContentSearchRequest,
  FilesystemProjectContentSearchResponse,
  FilesystemProjectPathSearchRequest,
  FilesystemProjectPathSearchResponse,
} from "@nervekit/contracts/filesystem";
import {
  apiDeleteNoContent,
  apiGet,
  apiPost,
  apiPut,
  fetchJson,
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

export async function getFilesystemLocations(): Promise<FilesystemLocations> {
  return await requestWorkbench("filesystem.locations.get", undefined);
}

export async function createDirectory(
  parent: string,
  name: string,
): Promise<{ path: string }> {
  return await requestWorkbench("filesystem.directories.create", {
    parent,
    name,
  });
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
): Promise<FilesystemProjectMonitorState | undefined> {
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

export async function moveProjectEntry(
  projectId: string,
  from: string,
  to: string,
): Promise<FilesystemProjectEntryResponse> {
  return await requestWorkbench("filesystem.project.entries.move", {
    projectId,
    from,
    to,
  });
}

export async function copyProjectEntry(
  projectId: string,
  from: string,
  to: string,
): Promise<FilesystemProjectEntryResponse> {
  return await requestWorkbench("filesystem.project.entries.copy", {
    projectId,
    from,
    to,
  });
}

/** Permanent delete, for clients without the desktop trash bridge. */
export async function deleteProjectEntries(
  projectId: string,
  paths: string[],
): Promise<FilesystemProjectEntriesDeleteResponse> {
  return await requestWorkbench("filesystem.project.entries.delete", {
    projectId,
    paths,
  });
}

/**
 * Writes OS files into a project folder. A file's `webkitRelativePath`-style
 * name (with "/") recreates subfolders under `parentPath`.
 */
export async function uploadProjectFiles(
  projectId: string,
  parentPath: string,
  files: ReadonlyArray<{ file: File; name?: string }>,
  options: { overwrite?: boolean } = {},
): Promise<FilesystemProjectUploadResponse> {
  const form = new FormData();
  form.set("projectId", projectId);
  form.set("path", parentPath);
  if (options.overwrite) form.set("overwrite", "true");
  for (const { file, name } of files)
    form.append("files", file, name ?? file.name);
  return await fetchJson<FilesystemProjectUploadResponse>(
    "/api/filesystem/project/upload",
    { method: "POST", body: form },
  );
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

export async function searchProjectPaths(
  request: FilesystemProjectPathSearchRequest,
): Promise<FilesystemProjectPathSearchResponse> {
  return await requestWorkbench("filesystem.project.paths.search", request);
}

export async function searchProjectContent(
  request: FilesystemProjectContentSearchRequest,
): Promise<FilesystemProjectContentSearchResponse> {
  return await requestWorkbench("filesystem.project.content.search", request);
}
