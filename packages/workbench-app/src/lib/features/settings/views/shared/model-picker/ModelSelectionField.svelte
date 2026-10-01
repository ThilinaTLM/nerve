<!--
  Model setting for a settings dialog: a labelled ModelPicker. With an
  inherit option, the picker's first row uses the parent's model; the last
  explicit choice is kept while inheriting, so choosing it again restores it.
-->
<script lang="ts">
import type { ModelInfo, ModelSelection, ThinkingLevel } from "$lib/api";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import type { ModelCapability } from "$lib/presentation/utils/model-catalog";
import ModelPicker from "./ModelPicker.svelte";

type Props = {
  label: string;
  models: ModelInfo[];
  model?: ModelSelection;
  thinkingLevel?: ThinkingLevel;
  /** Offers "use the parent's model"; `inherit` is bound to it. */
  inheritOption?: { label: string; description: string };
  inherit?: boolean;
  requiredCapabilities?: ModelCapability[];
  emptyMessage?: string;
  tourId?: string;
};

let {
  label,
  models,
  model = $bindable(),
  thinkingLevel = $bindable(),
  inheritOption,
  inherit = $bindable(false),
  requiredCapabilities,
  emptyMessage,
  tourId,
}: Props = $props();
</script>

<div class="grid gap-1.5">
  <Label>{label}</Label>
  <ModelPicker
    {label}
    class="w-full"
    {models}
    value={model}
    {thinkingLevel}
    {requiredCapabilities}
    {emptyMessage}
    {tourId}
    {inheritOption}
    {inherit}
    onInherit={() => (inherit = true)}
    onChange={(next) => {
      model = next.model;
      thinkingLevel = next.thinkingLevel;
      inherit = false;
    }}
  />
</div>
