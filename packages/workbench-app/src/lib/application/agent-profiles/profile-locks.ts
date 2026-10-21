import {
  lockedValue,
  type AgentProfile,
} from "@nervekit/contracts/agent-profiles";
import type { ComposerLockedFields } from "$lib/presentation/conversations/conversation-view-contracts";

/** Pickers the active profile locks; the host enforces the lock every turn. */
export function lockedFieldsOf(
  profile: AgentProfile | undefined,
): ComposerLockedFields {
  if (!profile) return {};
  return {
    model: lockedValue(profile.model) !== undefined,
    thinking: lockedValue(profile.thinking) !== undefined,
    permission: lockedValue(profile.permission) !== undefined,
  };
}

/** Compaction is edited outside the composer, so it is exposed separately. */
export function compactionLocked(profile: AgentProfile | undefined): boolean {
  return profile !== undefined && lockedValue(profile.compaction) !== undefined;
}
