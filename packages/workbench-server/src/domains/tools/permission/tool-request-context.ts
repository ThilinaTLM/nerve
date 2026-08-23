import { resolve } from "node:path";
import type { AgentRecord } from "@nervekit/contracts";

export function toolRequestContext(
  agent: AgentRecord,
  args: Record<string, unknown>,
): { cwd: string; normalizedArgs: Record<string, unknown> } {
  const cwd =
    typeof args.cwd === "string" && args.cwd.trim().length > 0
      ? resolve(agent.projectDir, args.cwd)
      : resolve(agent.projectDir);
  return { cwd, normalizedArgs: { ...args } };
}
