/** Friendly messages for the file operation error codes the server returns. */

const MESSAGES: Record<string, string> = {
  PROJECT_ENTRY_EXISTS: "An item with that name already exists there.",
  PROJECT_ENTRY_INTO_SELF: "A folder cannot be moved or copied into itself.",
  PROJECT_ENTRY_NOT_FOUND: "That item no longer exists. Refresh the tree.",
  INVALID_PROJECT_PATH: "That name or location is not valid.",
  FILE_PATH_OUTSIDE_PROJECT: "That location is outside the project.",
  INVALID_UPLOAD_NAME: "A dropped file has a name that cannot be written.",
  UPLOAD_TOO_LARGE: "The dropped files are too large to upload.",
};

export function fileOperationErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string") return direct;
  const data = (error as { data?: { code?: unknown } }).data;
  return typeof data?.code === "string" ? data.code : undefined;
}

export function describeFileOperationError(error: unknown): string {
  const code = fileOperationErrorCode(error);
  const known = code ? MESSAGES[code] : undefined;
  if (known) return known;
  return error instanceof Error && error.message
    ? error.message
    : "The file operation failed.";
}
