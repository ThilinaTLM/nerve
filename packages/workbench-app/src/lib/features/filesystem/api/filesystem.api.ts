import type {
  ClipboardImageUploadResponse,
  FilesystemDirectoryResponse,
  FilesystemFileResponse,
} from "@nervekit/contracts";
import {
  apiGet,
  apiPost,
  fileToBase64,
} from "@nervekit/ui-kit/core/api/client";
import { protocolRequest } from "@nervekit/protocol";

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
