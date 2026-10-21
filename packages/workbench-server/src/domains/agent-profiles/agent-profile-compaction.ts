import type { AutoCompactionSettings } from "@nervekit/contracts/settings";
import type { AgentProfileCompactionOverride } from "@nervekit/contracts/agent-profiles";

const DEFAULT_TRIGGER_PERCENT = 80;

/**
 * Maps a profile's compaction shorthand to the child's conversation override.
 * `inherit` means no override (undefined).
 */
export function agentProfileCompactionToSettings(
  compaction: AgentProfileCompactionOverride | "inherit",
): AutoCompactionSettings | undefined {
  if (compaction === "inherit") return undefined;
  return {
    auto: compaction.auto ?? true,
    profile: compaction.profile,
    customTriggerPercent: compaction.triggerPercent ?? DEFAULT_TRIGGER_PERCENT,
  };
}
