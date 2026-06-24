import type {
  ClipboardImageUploadResponse,
  FilesystemDirectoryResponse,
  FilesystemFileResponse,
} from "@nervekit/shared";
import { apiGet, apiPost, fileToBase64 } from "../../../core/api/client";

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
  const params = new URLSearchParams();
  if (path) params.set("path", path);
  if (showHidden) params.set("showHidden", "true");
  const suffix = params.toString();
  return apiGet<FilesystemDirectoryResponse>(
    `/api/filesystem/directories${suffix ? `?${suffix}` : ""}`,
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
