<script lang="ts">
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type { ModelDefinition } from "$lib/api";
import { upsertModelDefinition } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import SelectField, {
  type SelectItem,
} from "@nervekit/ui-kit/components/ui/select-field";
import { CodeMirrorEditor } from "$lib/presentation/components/code";
import { refreshProviderCatalog } from "$lib/features/settings/state/provider-catalog-actions.svelte";
import {
  DEFAULT_MODEL_JSON,
  modelDefinitionToJson,
  parseModelDefinitionJson,
} from "./model-definition-json";

type Props = {
  open?: boolean;
  model?: ModelDefinition;
  providerItems?: SelectItem[];
};

let { open = $bindable(false), model, providerItems = [] }: Props = $props();

const editing = $derived(Boolean(model));
let provider = $state("");
let jsonText = $state(DEFAULT_MODEL_JSON);
let busy = $state(false);
let submitError = $state<string | undefined>(undefined);

const selectProviderItems = $derived<SelectItem[]>(
  editing &&
    model?.provider &&
    !providerItems.some((item) => item.value === model.provider)
    ? [
        { value: model.provider, label: model.provider, detail: "Unavailable" },
        ...providerItems,
      ]
    : providerItems,
);
const providerAvailable = $derived(
  providerItems.some((item) => item.value === provider),
);
const parseResult = $derived(
  parseModelDefinitionJson(jsonText, provider, model?.modelId),
);
const canSubmit = $derived(parseResult.success && providerAvailable && !busy);

$effect(() => {
  if (!open) return;
  provider = model?.provider ?? "";
  jsonText = model ? modelDefinitionToJson(model) : DEFAULT_MODEL_JSON;
  submitError = undefined;
});

async function submit() {
  if (!canSubmit || !parseResult.success) return;
  busy = true;
  submitError = undefined;
  try {
    await upsertModelDefinition(parseResult.model);
    await refreshProviderCatalog();
    open = false;
  } catch (error) {
    submitError = error instanceof Error ? error.message : String(error);
  } finally {
    busy = false;
  }
}
</script>

<Dialog
  bind:open
  title={editing ? `Edit ${model?.name}` : "Add model"}
  description="Select a configured provider and define one pi-compatible model."
  size="wide"
>
  <div class="grid min-h-0 gap-3">
    <div class="grid gap-1.5">
      <Label>Provider</Label>
      <SelectField
        items={selectProviderItems}
        value={provider}
        onValueChange={(value) => (provider = value)}
        placeholder="Select a provider"
        ariaLabel="Provider"
        disabled={busy || editing}
      />
    </div>

    {#if provider.length > 0 && !providerAvailable}
      <p
        class="flex items-center gap-1.5 text-xs text-destructive"
        role="alert"
      >
        <TriangleAlert class="size-3.5" aria-hidden="true" />
        This provider is not configured or authenticated.
      </p>
    {/if}

    <div class="grid min-h-0 gap-1.5">
      <div class="flex flex-wrap items-end justify-between gap-2">
        <Label>Model JSON</Label>
        <p class="text-xs text-muted-foreground">
          Paste one object from a provider's
          <code class="font-mono">models</code> array.
        </p>
      </div>
      <div
        class="h-96 min-h-64 overflow-hidden rounded-md border bg-background"
      >
        <CodeMirrorEditor
          value={jsonText}
          onChange={(value) => {
            jsonText = value;
            submitError = undefined;
          }}
          disabled={busy}
          ariaLabel="Model definition JSON"
        />
      </div>
      {#if provider && !parseResult.success}
        <p
          class="flex items-start gap-1.5 text-xs text-destructive"
          role="alert"
        >
          <TriangleAlert class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {parseResult.error}
        </p>
      {:else}
        <p class="text-xs text-muted-foreground">
          Use the model object only. Provider URLs and API keys stay in provider
          settings.
        </p>
      {/if}
    </div>

    {#if submitError}
      <p
        class="flex items-center gap-1.5 text-xs text-destructive"
        role="alert"
      >
        <TriangleAlert class="size-3.5" aria-hidden="true" />
        {submitError}
      </p>
    {/if}
  </div>

  {#snippet footer()}
    <Button size="sm" variant="ghost" onclick={() => (open = false)}
      >Cancel</Button
    >
    <Button size="sm" onclick={() => void submit()} disabled={!canSubmit}>
      {busy ? "Saving…" : editing ? "Save model" : "Add model"}
    </Button>
  {/snippet}
</Dialog>
