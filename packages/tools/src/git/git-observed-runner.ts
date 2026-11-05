import { resolve } from "node:path";
import {
  type ExecResult,
  type GitCommandOptions,
  runGitCommand,
} from "./git-command.js";
import type { GitCommandObservation } from "./git-observability.js";
import {
  currentGitCommandOptions,
  inGitCreationLane,
  inGitLane,
} from "./git-operation-context.js";

/** Runs `git`/`gh` inside the repository lane, reporting a completion observation. */
export async function runObservedCommand(
  observe: (observation: GitCommandObservation) => void,
  bin: "git" | "gh",
  cwd: string,
  args: string[],
  commandOptions: GitCommandOptions = {},
): Promise<ExecResult> {
  const startedAt = performance.now();
  try {
    let commandIndex = 0;
    while (args[commandIndex]?.startsWith("-")) {
      const option = args[commandIndex++];
      if (
        option === "-c" ||
        option === "-C" ||
        option === "--git-dir" ||
        option === "--work-tree"
      )
        commandIndex++;
    }
    const verb = args[commandIndex];
    const network =
      bin === "git" && ["fetch", "pull", "push", "clone"].includes(verb ?? "");
    const commandArgs =
      network && !args.includes("--progress")
        ? [
            ...args.slice(0, commandIndex + 1),
            "--progress",
            ...args.slice(commandIndex + 1),
          ]
        : args;
    const execute = () =>
      runGitCommand(bin, cwd, commandArgs, {
        ...currentGitCommandOptions(),
        ...commandOptions,
        network,
      });
    const createsRepository =
      bin === "git" && (verb === "init" || verb === "clone");
    const destination = createsRepository
      ? resolve(cwd, args.at(-1) ?? ".")
      : undefined;
    // Creation reserves the real parent plus basename before .git exists.
    const result = destination
      ? await inGitCreationLane(
          destination,
          network,
          execute,
          currentGitCommandOptions(),
        )
      : bin === "git"
        ? await inGitLane(cwd, network, execute)
        : await execute();
    observe({
      bin,
      command: observedCommand(args),
      cwd,
      durationMs: performance.now() - startedAt,
      succeeded: true,
    });
    return result;
  } catch (error) {
    observe({
      bin,
      command: observedCommand(args),
      cwd,
      durationMs: performance.now() - startedAt,
      succeeded: false,
    });
    throw error;
  }
}

function observedCommand(args: readonly string[]): string {
  return args[0] === "--no-optional-locks"
    ? (args[1] ?? "unknown")
    : (args[0] ?? "unknown");
}
