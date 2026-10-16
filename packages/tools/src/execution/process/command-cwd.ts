import { stat } from "node:fs/promises";
import { resolveNativePath } from "../filesystem/native-path.js";
import { ToolExecutionError } from "../errors/tool-error.js";

export async function resolveCommandCwd(
  baseCwd: string,
  value: unknown,
): Promise<string> {
  if (value === undefined) return baseCwd;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ToolExecutionError(
      "INVALID_ARGUMENT",
      "Tool argument 'cwd' must be a non-empty string.",
      { argument: "cwd" },
    );
  }
  const cwd = resolveNativePath(baseCwd, value);
  let info;
  try {
    info = await stat(cwd);
  } catch {
    throw new ToolExecutionError(
      "INVALID_ARGUMENT",
      `Tool argument 'cwd' does not exist: ${cwd}`,
      { argument: "cwd", cwd },
    );
  }
  if (!info.isDirectory()) {
    throw new ToolExecutionError(
      "INVALID_ARGUMENT",
      `Tool argument 'cwd' is not a directory: ${cwd}`,
      { argument: "cwd", cwd },
    );
  }
  return cwd;
}
