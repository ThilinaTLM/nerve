import type { SandboxConfigV1 } from "@nervekit/shared";
import { computeToolGroupStatus } from "./tool-groups.js";
import { decideShellCommand, type ToolDecision } from "./tool-policy.js";
export class SandboxToolRuntime {
  constructor(private readonly config: SandboxConfigV1) {}
  groups() {
    return computeToolGroupStatus(this.config);
  }
  decide(tool: string, args: unknown): ToolDecision {
    if (tool === "bash")
      return decideShellCommand(
        String((args as { command?: unknown })?.command ?? ""),
      );
    return { allowed: true };
  }
}
