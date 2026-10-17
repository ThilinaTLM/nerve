import type { AutoCompactionSettings } from "@nervekit/contracts/settings";
import type { SubagentProfileCompaction } from "@nervekit/contracts/subagents";

const DEFAULT_TRIGGER_PERCENT = 80;

/**
 * Maps a profile's compaction shorthand to the child's conversation override.
 * `inherit` means no override (undefined).
 */
export function subagentCompactionToSettings(
  compaction: SubagentProfileCompaction,
): AutoCompactionSettings | undefined {
  if (compaction === "inherit") return undefined;
  return {
    auto: compaction.auto ?? true,
    profile: compaction.profile,
    customTriggerPercent: compaction.triggerPercent ?? DEFAULT_TRIGGER_PERCENT,
  };
}
