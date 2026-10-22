import type { AppliedAgentProfile } from "@nervekit/contracts/agent-profiles";
import type { ComposerLockedFields } from "$lib/presentation/conversations/conversation-view-contracts";

/**
 * What the conversation's applied profile locks. Driven only by the applied
 * snapshot captured when the profile was applied, never by the current
 * template, so later template edits cannot change it.
 */
export function lockedFieldsOf(
  applied: AppliedAgentProfile | null | undefined,
): ComposerLockedFields {
  if (!applied) return {};
  const { locked } = applied;
  return {
    by: applied.name,
    model: locked.model !== undefined,
    thinking: locked.thinking !== undefined,
    permission: locked.permission !== undefined,
    compaction: locked.compaction !== undefined,
    skills: locked.skills !== undefined,
    tools: Object.keys(locked.tools ?? {}),
  };
}

/** Whether the profile locks anything the composer exposes. */
export function hasLocks(fields: ComposerLockedFields): boolean {
  return Boolean(
    fields.model ||
    fields.thinking ||
    fields.permission ||
    fields.compaction ||
    fields.skills ||
    fields.tools?.length,
  );
}
