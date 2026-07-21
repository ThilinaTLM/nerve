import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { ToolExecutionError } from "./tool-error.js";

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
  const cwd = isAbsolute(value) ? resolve(value) : resolve(baseCwd, value);
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
