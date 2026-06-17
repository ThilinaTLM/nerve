import { spawn } from "node:child_process";
import type { ToolExecutionContext, ToolExecutionResult } from "../../types.js";
import { numberArg } from "../common/args.js";
import { buildProcessResult } from "../common/process-result.js";

export async function executeBash(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  if (typeof args.command !== "string" || args.command.trim().length === 0) {
    throw new Error("Tool argument 'command' must be a non-empty string.");
  }

  const timeoutSeconds =
    typeof args.timeout === "number"
      ? Math.max(0, numberArg(args.timeout, 0))
      : undefined;
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const combinedChunks: Buffer[] = [];

  return await new Promise<ToolExecutionResult>((resolve, reject) => {
    if (context.signal?.aborted) {
      reject(new Error("Command aborted."));
      return;
    }

    const child = spawn(args.command as string, {
      cwd: context.cwd,
      shell: true,
      detached: process.platform !== "win32",
      env: process.env,
    });

    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      context.signal?.removeEventListener("abort", onAbort);
    };
    const kill = () => {
      try {
        if (process.platform !== "win32" && child.pid) {
          process.kill(-child.pid, "SIGTERM");
        } else {
          child.kill("SIGTERM");
        }
      } catch {
        child.kill("SIGTERM");
      }
    };
    const onAbort = () => {
      if (settled) return;
      kill();
      settled = true;
      cleanup();
      reject(new Error("Command aborted."));
    };

    context.signal?.addEventListener("abort", onAbort, { once: true });
    if (timeoutSeconds !== undefined && timeoutSeconds > 0) {
      timeout = setTimeout(() => {
        if (settled) return;
        kill();
        settled = true;
        cleanup();
        reject(new Error(`Command timed out after ${timeoutSeconds}s.`));
      }, timeoutSeconds * 1000);
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      combinedChunks.push(chunk);
      context.onUpdate?.({
        kind: "output",
        stream: "stdout",
        chunk: chunk.toString("utf8"),
      });
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      combinedChunks.push(chunk);
      context.onUpdate?.({
        kind: "output",
        stream: "stderr",
        chunk: chunk.toString("utf8"),
      });
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      void buildResult(
        stdoutChunks,
        stderrChunks,
        combinedChunks,
        code,
        signal,
        context.dataDir,
      )
        .then(resolve)
        .catch(reject);
    });
  });
}

async function buildResult(
  stdoutChunks: Buffer[],
  stderrChunks: Buffer[],
  combinedChunks: Buffer[],
  code: number | null,
  signal: NodeJS.Signals | null,
  dataDir: string | undefined,
): Promise<ToolExecutionResult> {
  return buildProcessResult({
    stdoutChunks,
    stderrChunks,
    combinedChunks,
    code,
    signal,
    outputFilePrefix: "nerve-bash",
    exitMessagePrefix: "Command",
    dataDir,
  });
}
