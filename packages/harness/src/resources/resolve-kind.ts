import type { ExecutionEnv, FileInfo } from "../environment/contracts.js";

export interface FileInfoDiagnosticSink {
  push(diagnostic: {
    type: "warning";
    code: "file_info_failed";
    message: string;
    path: string;
  }): unknown;
}

export async function resolveKind(
  env: ExecutionEnv,
  info: FileInfo,
  diagnostics: FileInfoDiagnosticSink,
): Promise<"file" | "directory" | undefined> {
  if (info.kind === "file" || info.kind === "directory") return info.kind;
  const canonicalPath = await env.canonicalPath(info.path);
  if (!canonicalPath.ok) {
    if (canonicalPath.error.code !== "not_found") {
      diagnostics.push({
        type: "warning",
        code: "file_info_failed",
        message: canonicalPath.error.message,
        path: info.path,
      });
    }
    return undefined;
  }
  const target = await env.fileInfo(canonicalPath.value);
  if (!target.ok) {
    if (target.error.code !== "not_found") {
      diagnostics.push({
        type: "warning",
        code: "file_info_failed",
        message: target.error.message,
        path: info.path,
      });
    }
    return undefined;
  }
  return target.value.kind === "file" || target.value.kind === "directory"
    ? target.value.kind
    : undefined;
}
