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
export function sourceChain(value?: FieldProvenance, frozen = false): string[] {
  return value?.source === "frozen" || frozen
    ? ["Frozen at creation", "Conversation choice", "Profile requirement"]
    : [
        "Default",
        "User",
        "Project",
        "Process",
        "Profile recommendation",
        "Conversation / launch choice",
        "Profile requirement",
      ];
}

/** One badge for a model/reasoning pair only when both really share a source. */
export function sameConfigurationSource(
  a?: FieldProvenance,
  b?: FieldProvenance,
): boolean {
  return (
    a?.source === b?.source &&
    a?.profile === b?.profile &&
    Boolean(a?.adjusted) === Boolean(b?.adjusted)
  );
}
