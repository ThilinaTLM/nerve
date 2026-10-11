import type { StatusTone } from "@nervekit/ui-kit/display/status";

/** What the UI knows about a sub-agent from the lead's conversation snapshot. */
export type SubagentRef = {
  id: string;
  name: string;
  status: "idle" | "running" | "waiting" | "failed" | "interrupted";
};

export function findSubagent(
  agents: readonly SubagentRef[],
  name: string,
): SubagentRef | undefined {
  const key = name.trim().toLowerCase();
  return agents.find((agent) => agent.name.trim().toLowerCase() === key);
}

/** Label and tone of a sub-agent's live state, as shown on assignment rows. */
export function subagentLiveState(status: SubagentRef["status"]): {
  label: string;
  tone: StatusTone;
} {
  switch (status) {
    case "running":
      return { label: "working", tone: "info" };
    case "waiting":
      return { label: "needs you", tone: "warning" };
    case "failed":
      return { label: "failed", tone: "destructive" };
    case "interrupted":
      return { label: "stopped", tone: "warning" };
    default:
      return { label: "idle", tone: "neutral" };
  }
}
