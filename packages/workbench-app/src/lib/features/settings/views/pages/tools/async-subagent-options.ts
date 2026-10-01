import type { AsyncSubagentSettings } from "@nervekit/contracts/settings";
import type { ModelSelection, Settings, ThinkingLevel } from "$lib/api";
import { compactionProfileItems } from "../compaction/compaction-options";

export function validAsyncSubagentPercent(
  value: string,
  min: number,
  max: number,
): boolean {
  return (
    value.trim() !== "" &&
    Number.isInteger(Number(value)) &&
    Number(value) >= min &&
    Number(value) <= max
  );
}

/** Builds teammate settings from the dialog draft. An `undefined` model means
 * "use the lead's model", which also inherits the lead's thinking level. */
export function asyncSubagentSettingsFromDraft(
  model: ModelSelection | undefined,
  thinkingLevel: ThinkingLevel | undefined,
  profile: AsyncSubagentSettings["compactionProfile"],
  trigger: string,
  keepRecent: string,
): AsyncSubagentSettings | undefined {
  if (
    !validAsyncSubagentPercent(trigger, 60, 90) ||
    !validAsyncSubagentPercent(keepRecent, 5, 40)
  )
    return undefined;
  return {
    ...(model
      ? {
          model: { provider: model.provider, modelId: model.modelId },
          ...(thinkingLevel ? { thinkingLevel } : {}),
        }
      : {}),
    compactionProfile: profile,
    customTriggerPercent: Number(trigger),
    customKeepRecentPercent: Number(keepRecent),
  };
}

/** User settings patch that stores teammate settings, clearing unset fields. */
export function asyncSubagentSettingsPatch(settings: AsyncSubagentSettings): {
  asyncSubagent: {
    model: ModelSelection | null;
    thinkingLevel: ThinkingLevel | null;
    compactionProfile: AsyncSubagentSettings["compactionProfile"];
    customTriggerPercent: number;
    customKeepRecentPercent: number;
  };
} {
  return {
    asyncSubagent: {
      model: settings.model ?? null,
      thinkingLevel: settings.thinkingLevel ?? null,
      compactionProfile: settings.compactionProfile,
      customTriggerPercent: settings.customTriggerPercent,
      customKeepRecentPercent: settings.customKeepRecentPercent,
    },
  };
}

export function asyncSubagentProfileLabel(
  profile: Settings["asyncSubagent"]["compactionProfile"],
): string {
  return profile === "inherit"
    ? "Inherit lead compaction settings"
    : (compactionProfileItems.find((item) => item.value === profile)?.label ??
        profile);
}
