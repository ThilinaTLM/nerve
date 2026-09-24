import type { AgentRecord } from "@nervekit/contracts/agents";
import type { Settings } from "@nervekit/contracts/settings";

/** Resolve a teammate's profile without overriding the project's auto-compaction switch. */
export function compactionSettingsForAgent(
  settings: Pick<Settings, "compaction" | "asyncSubagent">,
  agent?: AgentRecord,
): Settings["compaction"] {
  const profile = settings.asyncSubagent.compactionProfile;
  if (agent?.executionKind !== "async_developer" || profile === "inherit")
    return settings.compaction;
  return {
    ...settings.compaction,
    profile,
    customTriggerPercent: settings.asyncSubagent.customTriggerPercent,
    customKeepRecentPercent: settings.asyncSubagent.customKeepRecentPercent,
  };
}
