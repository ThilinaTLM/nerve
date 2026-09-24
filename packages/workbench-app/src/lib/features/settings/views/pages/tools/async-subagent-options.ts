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

/** Builds the settings patch. An `undefined` model means "use the lead's
 * model", which also inherits the lead's thinking level. */
export function asyncSubagentPatch(
  model: ModelSelection | undefined,
  thinkingLevel: ThinkingLevel | undefined,
  profile: Settings["asyncSubagent"]["compactionProfile"],
  trigger: string,
  keepRecent: string,
):
  | {
      asyncSubagent: {
        model: ModelSelection | null;
        thinkingLevel: ThinkingLevel | null;
        compactionProfile: Settings["asyncSubagent"]["compactionProfile"];
        customTriggerPercent: number;
        customKeepRecentPercent: number;
      };
    }
  | undefined {
  if (
    !validAsyncSubagentPercent(trigger, 60, 90) ||
    !validAsyncSubagentPercent(keepRecent, 5, 40)
  )
    return undefined;
  return {
    asyncSubagent: {
      model: model
        ? { provider: model.provider, modelId: model.modelId }
        : null,
      thinkingLevel: model ? (thinkingLevel ?? null) : null,
      compactionProfile: profile,
      customTriggerPercent: Number(trigger),
      customKeepRecentPercent: Number(keepRecent),
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
