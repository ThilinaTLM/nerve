/**
 * The profile a sub-agent was created from. New sub-agents are created by a
 * `subagent_prompt` call whose assignment names them (the child's title is the
 * assignment name); sub-agents created before profiles existed carry only the
 * name of the tool that spawned them.
 */
export function deriveSubagentProfile(
  title: string | undefined,
  creatingCall: { toolName: string; arguments: unknown } | undefined,
): string | undefined {
  if (!creatingCall) return undefined;
  const { toolName } = creatingCall;
  if (toolName === "explore") return "explore";
  if (toolName === "subagent_new") return "developer";
  if (toolName !== "subagent_prompt") return undefined;
  const name = title?.trim().toLowerCase();
  if (!name) return undefined;
  const assignments = (creatingCall.arguments as { assignments?: unknown })
    ?.assignments;
  if (!Array.isArray(assignments)) return undefined;
  for (const assignment of assignments) {
    if (!assignment || typeof assignment !== "object") continue;
    const { name: assigned, profile } = assignment as Record<string, unknown>;
    if (
      typeof assigned === "string" &&
      assigned.trim().toLowerCase() === name &&
      typeof profile === "string" &&
      profile
    )
      return profile;
  }
  return undefined;
}
