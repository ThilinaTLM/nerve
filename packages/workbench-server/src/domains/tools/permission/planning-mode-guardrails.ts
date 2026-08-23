import type { ToolName } from "@nervekit/contracts";
import {
  assessToolRisk,
  isAllowedPlanModeBashCommand,
  isReadOnlyNetworkToolForApproval,
} from "@nervekit/tools";
import {
  isPathInsidePlanDir,
  planDirForStorageHome,
  resolvePlanPath,
} from "../../plans/plan-paths.js";

export function planningModeGuardrails(input: {
  toolName: ToolName;
  args: Record<string, unknown>;
  normalizedArgs: Record<string, unknown>;
  cwd: string;
  dataDir: string;
}): { normalizedArgs: Record<string, unknown>; denial?: string } {
  const allowedInteractionTools = new Set<ToolName>([
    "ask_user",
    "todos_set",
    "plan_mode_enter",
    "plan_mode_present",
    "plan_mode_force_exit",
  ]);
  if (allowedInteractionTools.has(input.toolName)) {
    return { normalizedArgs: input.normalizedArgs };
  }

  const assessment = assessToolRisk(input.toolName, input.args);
  if (input.toolName === "bash") {
    const command =
      typeof input.args.command === "string" ? input.args.command : "";
    return isAllowedPlanModeBashCommand(command)
      ? { normalizedArgs: input.normalizedArgs }
      : {
          normalizedArgs: input.normalizedArgs,
          denial:
            "Planning mode blocks bash commands that look destructive, write files, install/update dependencies, deploy, or run long-running tasks.",
        };
  }
  if (
    assessment.risk === "read" ||
    assessment.risk === "network" ||
    isReadOnlyNetworkToolForApproval(input.toolName) ||
    input.toolName === "python_exec" ||
    input.toolName === "explore"
  ) {
    return { normalizedArgs: input.normalizedArgs };
  }
  if (input.toolName === "edit" || input.toolName === "write") {
    try {
      const targetPath = resolvePlanPath(input.cwd, input.args.path);
      const planDir = planDirForStorageHome(input.dataDir);
      if (!isPathInsidePlanDir(planDir, targetPath)) {
        return {
          normalizedArgs: input.normalizedArgs,
          denial: `Planning mode allows ${input.toolName} only for plan files inside ${planDir}. Attempted: ${targetPath}`,
        };
      }
      return {
        normalizedArgs: { ...input.normalizedArgs, path: targetPath },
      };
    } catch (error) {
      return {
        normalizedArgs: input.normalizedArgs,
        denial: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return {
    normalizedArgs: input.normalizedArgs,
    denial: `Planning mode cannot run '${input.toolName}' because it may mutate workspace files, tasks, or runtime state outside plan review.`,
  };
}
