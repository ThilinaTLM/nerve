<!--
  Model setting for a settings dialog: an optional "use the parent's model"
  switch above a ModelPicker. While inheriting, the picker is hidden but the
  last explicit choice is kept, so switching back restores it.
-->
<script lang="ts">
import type { ModelInfo, ModelSelection, ThinkingLevel } from "$lib/api";
import SwitchField from "@nervekit/ui-kit/components/composites/switch-field";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import type { ModelCapability } from "$lib/presentation/utils/model-catalog";
import ModelPicker from "./ModelPicker.svelte";

type Props = {
  label: string;
  models: ModelInfo[];
  model?: ModelSelection;
  thinkingLevel?: ThinkingLevel;
  /** Shows the switch; `inherit` is bound to it. */
  inheritOption?: { label: string; description: string };
  inherit?: boolean;
  requiredCapabilities?: ModelCapability[];
  emptyMessage?: string;
  /** Help under the picker; hidden while inheriting. */
  hint?: string;
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
  hint,
  tourId,
}: Props = $props();

const showPicker = $derived(!inheritOption || !inherit);
</script>

<div class="grid gap-3">
  {#if inheritOption}
    <SwitchField
      bind:checked={inherit}
      label={inheritOption.label}
      description={inheritOption.description}
    />
  {/if}
  {#if showPicker}
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
        onChange={(next) => {
          model = next.model;
          thinkingLevel = next.thinkingLevel;
        }}
      />
      {#if hint}
        <p class="text-xs text-muted-foreground">{hint}</p>
      {/if}
    </div>
  {/if}
</div>
