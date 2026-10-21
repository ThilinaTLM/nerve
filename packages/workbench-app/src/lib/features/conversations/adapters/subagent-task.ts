/** A `subagent_prompt` assignment names a child by its title. */
type CreatingCall = { toolName: string; arguments: unknown };

/** Latest non-empty prompt assigned to this named child, including follow-ups. */
export function deriveSubagentTask(
  title: string | undefined,
  calls: readonly CreatingCall[],
): string | undefined {
  const name = title?.trim().toLowerCase();
  if (!name) return undefined;
  for (let index = calls.length - 1; index >= 0; index--) {
    const call = calls[index];
    if (!call || call.toolName !== "subagent_prompt") continue;
    const assignments = (call.arguments as { assignments?: unknown })
      ?.assignments;
    if (!Array.isArray(assignments)) continue;
    for (const assignment of assignments) {
      if (!assignment || typeof assignment !== "object") continue;
      const { name: assigned, prompt } = assignment as Record<string, unknown>;
      if (
        typeof assigned === "string" &&
        assigned.trim().toLowerCase() === name &&
        typeof prompt === "string" &&
        prompt.trim()
      )
        return prompt;
    }
  }
  return undefined;
}
