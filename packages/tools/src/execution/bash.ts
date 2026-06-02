import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { ToolExecutionContext, ToolExecutionResult } from "../types.js";
import { numberArg } from "./common.js";

const execAsync = promisify(exec);

export async function executeBash(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  if (typeof args.command !== "string" || args.command.trim().length === 0) {
    throw new Error("Tool argument 'command' must be a non-empty string.");
  }
  const timeoutSeconds = Math.min(numberArg(args.timeout, 30), 120);
  try {
    const { stdout, stderr } = await execAsync(args.command, {
      cwd: context.cwd,
      timeout: timeoutSeconds * 1000,
      maxBuffer: 1024 * 1024 * 4,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const failure = error as Error & {
      stdout?: string;
      stderr?: string;
      code?: number;
    };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? failure.message,
      exitCode: typeof failure.code === "number" ? failure.code : 1,
    };
  }
}
