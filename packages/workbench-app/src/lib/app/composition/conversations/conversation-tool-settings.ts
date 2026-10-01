import type {
  CapabilityConfiguration,
  CapabilityPatch,
  ProfiledCapabilityToolName,
} from "@nervekit/contracts/capabilities";
import type { ModelSelection, ThinkingLevel } from "@nervekit/contracts/models";
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

/** Label for the choice that returns a profiled tool to its inherited profile. */
export function inheritedProfileLabel(
  configuration: CapabilityConfiguration,
  tool: ProfiledCapabilityToolName,
  inheritedFrom: CapabilityToolState["inheritedFrom"],
): string {
  const source = inheritedFrom === "project" ? "project" : "your settings";
  const profileId = configuration.inherited.toolProfiles[tool];
  if (!profileId) return `Use ${source} (no profile)`;
  const option = configuration.toolProfileOptions[tool].find(
    (item) => item.id === profileId,
  );
  return `Use ${source} (${option?.name ?? "missing profile"})`;
}

/** Conversation patch for a model-only tool; an unset model is omitted. */
export function modelToolSettingsPatch(
  tool: "explore" | "explain_image",
  selection: { model?: ModelSelection; thinkingLevel: ThinkingLevel },
): CapabilityPatch {
  return {
    toolSettings: {
      [tool]: {
        ...(selection.model ? { model: selection.model } : {}),
        thinkingLevel: selection.thinkingLevel,
      },
    },
  };
}
