import type { AgentRecord } from "@nervekit/contracts/agents";
import type { Settings } from "@nervekit/contracts/settings";

/** Resolve a teammate's profile without overriding the project's auto-compaction switch. */
export function compactionSettingsForAgent(
  settings: Pick<Settings, "compaction" | "asyncSubagent">,
  _agent?: AgentRecord,
): Settings["compaction"] {
  void _agent;
  // Agent parentage/preset does not impose a hidden context-management policy.
  // Until compaction becomes an explicit agent configuration, project settings own it.
  return settings.compaction;
}
