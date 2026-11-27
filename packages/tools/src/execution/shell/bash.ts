import type { ProjectShellLaunchContext } from "@nervekit/contracts/tools";
import { spawnManagedChildProcess } from "@nervekit/native";
import type {
  ShellExecutionContext,
  ToolExecutionResult,
} from "../execution-context.js";
import { numberArg } from "../process/arguments.js";
import { resolveCommandCwd } from "../process/command-cwd.js";
import type { BoundedProcessOutput } from "../output/bounded-process-output.js";
import { bashProcessPolicy } from "../process/managed-process-policy.js";
import { runManagedProcess } from "../process/run-managed-process.js";
import { buildProcessResult } from "../process/process-result.js";
import { resolveProjectShellInvocation } from "./project-environment.js";
import {
  contextualizeShellSpawnError,
  formatProjectShellFailure,
} from "./launch-diagnostics.js";
import { resolveBashShellConfig } from "./shell-config.js";

function nonInteractiveShellEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PAGER: "cat",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    TERM: "dumb",
  };
}

export async function executeBash(
  args: Record<string, unknown>,
  context: ShellExecutionContext,
): Promise<ToolExecutionResult> {
  if (typeof args.command !== "string" || args.command.trim().length === 0) {
    throw new Error("Tool argument 'command' must be a non-empty string.");
  }

  if (
    args.projectEnvironment !== undefined &&
    typeof args.projectEnvironment !== "boolean"
  ) {
    throw new Error("Tool argument 'projectEnvironment' must be a boolean.");
  }

  const cwd = await resolveCommandCwd(context.cwd, args.cwd);
  const timeoutSeconds =
    typeof args.timeout === "number"
      ? Math.max(0, numberArg(args.timeout, 0))
      : undefined;
  const env = nonInteractiveShellEnv();
  const invocation = resolveProjectShellInvocation(args.command, {
    cwd,
    env,
    projectEnvironment: args.projectEnvironment,
    shellConfig: resolveBashShellConfig({ shellPath: context.shellPath }),
  });

  return await runManagedProcess({
    spawn: () =>
      spawnManagedChildProcess(invocation.shell, invocation.args, {
        cwd,
        env: invocation.env,
        policy: bashProcessPolicy(
          timeoutSeconds && timeoutSeconds > 0
            ? timeoutSeconds * 1000
            : undefined,
        ),
        detachOutputAfterExit: true,
      }),
    signal: context.signal,
    onUpdate: context.onUpdate,
    timeoutSeconds,
    timeoutLabel: "Command",
    abortedMessage: "Command aborted.",
    terminationNoun: "command",
    mapSpawnError: (error) =>
      contextualizeShellSpawnError(error, invocation.launch),
    beforeEnd: ({ code, timedOut, output, liveOutput }) => {
      if (
        !timedOut &&
        invocation.launch.manager &&
        code !== null &&
        code !== 0
      ) {
        const diagnostic = Buffer.from(
          formatProjectShellFailure(invocation.launch),
        );
        output.push("stderr", diagnostic);
        liveOutput.write("stderr", diagnostic);
      }
    },
    buildResult: (close) =>
      buildResult(
        close.output.snapshot(),
        close.code,
        close.signal,
        context.artifactDir,
        {
          launch: invocation.launch,
          durationMs: close.durationMs,
          timedOut: close.timedOut,
          timeoutKilled: close.timeoutKilled,
          timeoutMessage: close.timeoutMessage,
        },
      ),
  });
}

async function buildResult(
  output: ReturnType<BoundedProcessOutput["snapshot"]>,
  code: number | null,
  signal: NodeJS.Signals | null,
  artifactDir: string | undefined,
  options: {
    launch?: ProjectShellLaunchContext;
    durationMs?: number;
    timedOut?: boolean;
    timeoutKilled?: boolean;
    timeoutMessage?: string;
  } = {},
): Promise<ToolExecutionResult> {
  return buildProcessResult({
    stdoutChunks: output.stdoutChunks,
    stderrChunks: output.stderrChunks,
    combinedChunks: output.combinedChunks,
    code,
    signal,
    outputFilePrefix: "nerve-bash",
    agentProfile: "process_output",
    exitMessagePrefix: "Command",
    artifactDir,
    durationMs: options.durationMs,
    timedOut: options.timedOut,
    timeoutKilled: options.timeoutKilled,
    timeoutMessage: options.timeoutMessage,
    details: {
      launch: options.launch,
      outputRetention: {
        totalBytes: output.totalBytes,
        retainedBytes: output.retainedBytes,
        omittedBytes: output.omittedBytes,
        truncated: output.truncated,
      },
    },
    contentFooterLines: output.truncated
      ? [
          `${output.omittedBytes} output bytes were omitted by process retention.`,
        ]
      : [],
  });
}
