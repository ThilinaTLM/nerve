<script lang="ts">
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type { ModelDefinition } from "$lib/api";
import { upsertModelDefinition } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import type { SelectItem } from "@nervekit/ui-kit/components/composites/select-field";
import ProviderIcon from "$lib/presentation/model-picker/ProviderIcon.svelte";
import PopoverPanel, {
  PopoverCommandList,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { providerSearchKeywords } from "./provider-profiles";
import { CodeMirrorEditor } from "$lib/presentation/code";
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
let providerOpen = $state(false);
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
const commandItems = $derived(
  selectProviderItems.map((item) => ({
    key: item.value,
    label: item.label,
    detail: item.detail,
    group:
      item.detail === "Custom provider"
        ? "Custom providers"
        : "Connected providers",
    keywords: providerSearchKeywords(item.value, item.label),
  })),
);
const selectedProvider = $derived(
  selectProviderItems.find((item) => item.value === provider),
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
  providerOpen = false;
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
      <PopoverPanel
        bind:open={providerOpen}
        variant="field"
        size="lg"
        ariaLabel="Provider"
      >
        {#snippet triggerChild({ props })}
          <Button {...props} variant="outline" disabled={busy || editing}>
            {#if provider}<ProviderIcon {provider} class="size-4" />{/if}
            {selectedProvider?.label ?? "Select a provider"}
          </Button>
        {/snippet}
        {#if providerOpen}
          <PopoverCommandList
            items={commandItems}
            ariaLabel="Providers"
            placeholder="Search providers…"
            isSelected={(item) => item.key === provider}
            onChoose={(item) => {
              provider = item.key;
              providerOpen = false;
            }}
          >
            {#snippet icon(item)}<ProviderIcon
                provider={item.key}
                class="size-4"
              />{/snippet}
          </PopoverCommandList>
        {/if}
      </PopoverPanel>
    </div>

    {#if provider.length > 0 && !providerAvailable}
      <p
        class="flex items-center gap-1.5 text-ui text-destructive"
        role="alert"
      >
        <TriangleAlert class="size-3.5" aria-hidden="true" />
        This provider is not configured or authenticated.
      </p>
    {/if}

    <div class="grid min-h-0 gap-1.5">
      <div class="flex flex-wrap items-end justify-between gap-2">
        <Label>Model JSON</Label>
        <p class="text-ui text-muted-foreground">
          Find model JSON on
          <a
            class="text-info underline underline-offset-2"
            href="https://pi.dev/models"
            target="_blank"
            rel="noreferrer">pi.dev/models</a
          >.
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
          class="flex items-start gap-1.5 text-ui text-destructive"
          role="alert"
        >
          <TriangleAlert class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {parseResult.error}
        </p>
      {:else}
        <p class="text-ui text-muted-foreground">
          Paste one object from a provider's
          <code class="font-mono">models</code> array. Provider URLs and API keys
          stay in provider settings.
        </p>
      {/if}
    </div>

    {#if submitError}
      <p
        class="flex items-center gap-1.5 text-ui text-destructive"
        role="alert"
      >
        <TriangleAlert class="size-3.5" aria-hidden="true" />
        {submitError}
      </p>
    {/if}
  </div>

  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button onclick={() => void submit()} disabled={!canSubmit}>
      {busy ? "Saving…" : editing ? "Save model" : "Add model"}
    </Button>
  {/snippet}
</Dialog>
