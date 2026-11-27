<script lang="ts">
import { untrack } from "svelte";
import type { LeadSettingsOverrides } from "@nervekit/contracts/agent-configuration";
import type { ModelSelection } from "@nervekit/contracts/models";
import { implementationModelCompatible } from "./profile-choice-constraints";
import type {
  AgentRecord,
  ModelInfo,
  PlanReviewResolveOptions,
} from "../../state/tool-types";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import DialogShell from "@nervekit/ui-kit/components/composites/dialog-shell";
import { ModelPickerPanel } from "$lib/presentation/model-picker";
import { modelKey } from "$lib/presentation/utils/model";
import { clampThinkingLevelForModel } from "../../state/thinking-levels";

type ThinkingLevel = NonNullable<AgentRecord["thinkingLevel"]>;

type Props = {
  requirements?: LeadSettingsOverrides;
  open?: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  models: ModelInfo[];
  initialModelKey: string;
  initialThinkingLevel: ThinkingLevel;
  onOpenChange?: (open: boolean) => void;
  onConfirm?: (options: PlanReviewResolveOptions) => void | Promise<void>;
};

let {
  open = $bindable(false),
  title,
  description,
  confirmLabel,
  models,
  initialModelKey,
  initialThinkingLevel,
  onOpenChange,
  onConfirm,
  requirements = {},
}: Props = $props();

let selectionChanged = $state(false);
let selectedModel = $state<ModelSelection>();
let selectedThinkingLevel = $state<ThinkingLevel>("off");

const selectedInfo = $derived(
  selectedModel
    ? models.find((model) => modelKey(model) === modelKey(selectedModel!))
    : undefined,
);
const canConfirm = $derived(
  !!selectedInfo && implementationModelCompatible(selectedInfo, requirements),
);

function handleOpenChange(next: boolean) {
  open = next;
  onOpenChange?.(next);
}

function confirmSelection() {
  if (!selectedModel || !canConfirm) return;
  // Capture the selection and close immediately; the parent plan card owns
  // the action's progress and error presentation.
  const options = selectionChanged
    ? {
        implementationModel: selectedModel,
        implementationThinkingLevel: selectedThinkingLevel,
      }
    : {};
  handleOpenChange(false);
  void onConfirm?.(options);
}

$effect(() => {
  if (!open) return;
  // Reinitialize from incoming confirmation only, not from edits to local selection.
  void initialModelKey;
  void initialThinkingLevel;
  void models;
  void requirements;
  untrack(() => {
    selectionChanged = false;
    const initial =
      models.find((model) => modelKey(model) === initialModelKey) ?? models[0];
    const model = requirements.model ?? initial;
    selectedModel = model
      ? { provider: model.provider, modelId: model.modelId }
      : undefined;
    selectedThinkingLevel =
      requirements.reasoningLevel ??
      clampThinkingLevelForModel(
        initialThinkingLevel,
        models.find(
          (m) => selectedModel && modelKey(m) === modelKey(selectedModel),
        ),
      );
  });
});
</script>

<DialogShell
  {open}
  {title}
  {description}
  onOpenChange={handleOpenChange}
  class="max-w-xl"
>
  <div class="grid gap-2">
    <ModelPickerPanel
      label="Implementation model"
      {models}
      value={selectedModel}
      thinkingLevel={selectedThinkingLevel}
      emptyMessage="No models available. Configure a provider or adjust Scoped Models in Settings."
      modelDisabled={!!requirements.model}
      thinkingDisabled={requirements.reasoningLevel !== undefined}
      lockReason="Required by the implementation profile"
      isModelCompatible={(model) =>
        implementationModelCompatible(model, requirements)}
      onChange={(next) => {
        selectionChanged = true;
        selectedModel = next.model;
        selectedThinkingLevel = next.thinkingLevel;
      }}
    />
  </div>

  {#snippet footer()}
    <Button variant="ghost" onclick={() => handleOpenChange(false)}
      >Cancel</Button
    >
    <Button onclick={confirmSelection} disabled={!canConfirm}
      >{confirmLabel}</Button
    >
  {/snippet}
</DialogShell>
