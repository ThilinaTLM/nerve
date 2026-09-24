<!--
  Configure dialog for a tool whose only setting is its model (Explore,
  Image explanation). Edits stay local until Save.
-->
<script lang="ts">
import type { ModelInfo, ModelSelection, ThinkingLevel } from "$lib/api";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { ModelCapability } from "$lib/presentation/utils/model-catalog";
import ModelSelectionField from "../../shared/model-picker/ModelSelectionField.svelte";

type Selection = { model?: ModelSelection; thinkingLevel: ThinkingLevel };

type Props = {
  open?: boolean;
  title: string;
  description?: string;
  label: string;
  models: ModelInfo[];
  selectedModel?: ModelSelection;
  selectedThinkingLevel: ThinkingLevel;
  /** Offers "use the parent's model"; saving it clears the model. */
  inheritOption?: { label: string; description: string };
  requiredCapabilities?: ModelCapability[];
  emptyMessage?: string;
  hint?: string;
  tourId?: string;
  onSave: (selection: Selection) => void;
};

let {
  open = $bindable(false),
  title,
  description,
  label,
  models,
  selectedModel,
  selectedThinkingLevel,
  inheritOption,
  requiredCapabilities,
  emptyMessage,
  hint,
  tourId,
  onSave,
}: Props = $props();

let modelDraft = $state<ModelSelection | undefined>();
let thinkingDraft = $state<ThinkingLevel | undefined>();
let inheritDraft = $state(false);
let lastOpen = false;

$effect(() => {
  if (open && !lastOpen) {
    modelDraft = selectedModel;
    thinkingDraft = selectedThinkingLevel;
    inheritDraft = Boolean(inheritOption) && !selectedModel;
  }
  lastOpen = open;
});

const inheriting = $derived(Boolean(inheritOption) && inheritDraft);
const canSave = $derived(inheriting || modelDraft !== undefined);

function save(): void {
  if (!canSave) return;
  onSave(
    inheriting
      ? { model: undefined, thinkingLevel: "off" }
      : { model: modelDraft, thinkingLevel: thinkingDraft ?? "off" },
  );
  open = false;
}
</script>

<Dialog bind:open {title} {description} size="md">
  <ModelSelectionField
    {label}
    {models}
    bind:model={modelDraft}
    bind:thinkingLevel={thinkingDraft}
    bind:inherit={inheritDraft}
    {inheritOption}
    {requiredCapabilities}
    {emptyMessage}
    {hint}
    {tourId}
  />

  {#snippet footer()}
    <Button size="sm" variant="ghost" onclick={() => (open = false)}
      >Cancel</Button
    >
    <Button size="sm" onclick={save} disabled={!canSave}>Save</Button>
  {/snippet}
</Dialog>
