import { realpath } from "node:fs/promises";
export type ToolDecision = {
  allowed: boolean;
  reason?: string;
  approvalRequired?: boolean;
};
export async function assertToolPathAllowed(
  candidate: string,
  workspaceDir: string,
): Promise<void> {
  const [realCandidate, realRoot] = await Promise.all([
    realpath(candidate),
    realpath(workspaceDir),
  ]);
  if (realCandidate !== realRoot && !realCandidate.startsWith(`${realRoot}/`))
    throw new Error("filesystem policy denied path outside workspace");
}
export function decideShellCommand(
  command: string,
  approval: "never" | "risky" | "always" = "risky",
): ToolDecision {
  if (approval === "always")
    return {
      allowed: false,
      approvalRequired: true,
      reason: "approval required",
    };
  if (
    approval === "risky" &&
    /\b(rm\s+-rf|mkfs|shutdown|reboot|dd\s+)/.test(command)
  )
    return {
      allowed: false,
      approvalRequired: true,
      reason: "destructive command requires approval",
    };
  return { allowed: true };
}
