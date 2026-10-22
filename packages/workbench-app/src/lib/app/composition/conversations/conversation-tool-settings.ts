import type {
  CapabilityConfiguration,
  ProfiledCapabilityToolName,
} from "@nervekit/contracts/capabilities";
import type { CapabilityToolState } from "$lib/presentation/composer/capability-origin";

/**
 * Profile stored by the conversation itself. Without one, the dialog selects
 * its "inherit" choice, so the conversation keeps following later changes to
 * the project or your settings.
 */
export function conversationProfileId(
  configuration: CapabilityConfiguration,
  tool: ProfiledCapabilityToolName,
): string | undefined {
  return configuration.conversation?.tools[tool]?.profileId;
}

/** Label for the choice that returns an integration tool to its inherited account. */
export function inheritedProfileLabel(
  configuration: CapabilityConfiguration,
  tool: ProfiledCapabilityToolName,
  inheritedFrom: CapabilityToolState["inheritedFrom"],
): string {
  const source = inheritedFrom === "project" ? "project" : "your settings";
  const profileId = configuration.inherited.toolProfiles[tool];
  if (!profileId) return `Use ${source} (no account)`;
  const option = configuration.toolProfileOptions[tool].find(
    (item) => item.id === profileId,
  );
  return `Use ${source} (${option?.name ?? "missing account"})`;
}
