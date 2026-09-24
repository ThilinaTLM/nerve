import type { ModelInfo, ModelSelection, Settings } from "$lib/api";
import type { SelectItem } from "@nervekit/ui-kit/components/composites/select-field";
import {
  contextualModelLabel,
  modelKey,
  providerDisplayName,
} from "$lib/presentation/utils/model";
import { compactionProfileItems } from "../compaction/compaction-options";

export const leadModelOption = "$lead";

export function asyncSubagentModelOptions(
  models: ModelInfo[],
  configured?: ModelSelection,
): SelectItem[] {
  const options: SelectItem[] = [
    {
      value: leadModelOption,
      label: "Lead agent model",
      detail: "Use the lead's model when each teammate is created.",
    },
  ];
  if (
    configured &&
    !models.some((model) => modelKey(model) === modelKey(configured))
  ) {
    options.push({
      value: modelKey(configured),
      label: `${configured.provider}/${configured.modelId} (unavailable)`,
      detail: "This configured model is no longer available.",
      disabled: true,
    });
  }
  return options.concat(
    models.map((model) => ({
      value: modelKey(model),
      label: contextualModelLabel(model, models),
      detail: providerDisplayName(model.provider),
    })),
  );
}

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

export function asyncSubagentPatch(
  modelKeyDraft: string,
  configured: ModelSelection | undefined,
  models: ModelInfo[],
  profile: Settings["asyncSubagent"]["compactionProfile"],
  trigger: string,
  keepRecent: string,
):
  | {
      asyncSubagent: {
        model: ModelSelection | null;
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
  const chosen = models.find((model) => modelKey(model) === modelKeyDraft);
  // A saved model that became unavailable may be retained, but not replaced by
  // an arbitrary key no longer in the available catalog.
  if (
    modelKeyDraft !== leadModelOption &&
    !chosen &&
    (!configured || modelKey(configured) !== modelKeyDraft)
  )
    return undefined;
  return {
    asyncSubagent: {
      model:
        modelKeyDraft !== leadModelOption
          ? chosen
            ? { provider: chosen.provider, modelId: chosen.modelId }
            : configured!
          : null,
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
