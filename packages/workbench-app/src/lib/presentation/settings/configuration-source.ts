import type { FieldProvenance } from "@nervekit/contracts/agent-configuration";
const labels = {
  builtin: "Default",
  user: "User",
  project: "Project",
  process: "Process",
  recommendation: "Recommended",
  conversation: "Conversation",
  requirement: "Required",
  frozen: "Frozen at creation",
  launch: "Launch choice",
} as const;
export function sourceLabel(
  value?: FieldProvenance,
  modelLabel?: string,
): string {
  if (!value) return "Unavailable";
  if (value.adjusted) return `Adjusted for ${modelLabel ?? "model"}`;
  const label = labels[value.source];
  return value.profile ? `${label} · ${value.profile}` : label;
}
