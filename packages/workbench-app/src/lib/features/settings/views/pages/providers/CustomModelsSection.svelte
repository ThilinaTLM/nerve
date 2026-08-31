<script lang="ts">
import type {
  AuthProviderMetadata,
  ModelDefinition,
  ModelInfo,
} from "$lib/api";
import { deleteModelDefinition } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import { SettingsListItem } from "$lib/presentation/settings";
import { providerCatalogState } from "$lib/features/settings/state/provider-catalog-state.svelte";
import { refreshProviderCatalog } from "$lib/features/settings/state/provider-catalog-actions.svelte";
import SettingsEntityListSection from "../../shared/settings-entity-list-section.svelte";
import ModelDefinitionDialog from "./ModelDefinitionDialog.svelte";

type Props = {
  models?: ModelInfo[];
  authProviders?: AuthProviderMetadata[];
};

let { models = [], authProviders = [] }: Props = $props();

let dialogOpen = $state(false);
let editing = $state<ModelDefinition | undefined>(undefined);
let pendingDelete = $state<ModelDefinition | undefined>(undefined);

const customProviderIds = $derived(
  new Set(providerCatalogState.customProviders.map((custom) => custom.id)),
);
const modelProviderIds = $derived(
  new Set(models.filter((model) => !model.faux).map((model) => model.provider)),
);
const authenticatedBuiltInProviders = $derived(
  authProviders
    .filter(
      (provider) =>
        provider.configured &&
        modelProviderIds.has(provider.provider) &&
        !customProviderIds.has(provider.provider),
    )
    .sort((a, b) => a.displayName.localeCompare(b.displayName)),
);
const providerItems = $derived([
  ...providerCatalogState.customProviders
    .map((custom) => ({
      value: custom.id,
      label: custom.displayName,
      detail: "Custom provider",
    }))
    .sort((a, b) => a.label.localeCompare(b.label)),
  ...authenticatedBuiltInProviders.map((provider) => ({
    value: provider.provider,
    label: provider.displayName,
    detail:
      provider.credentialType === "oauth"
        ? "Subscription login"
        : "API key configured",
  })),
]);
const eligibleProviderIds = $derived(
  new Set(providerItems.map((provider) => provider.value)),
);

const definitions = $derived(
  [...providerCatalogState.modelDefinitions].sort(
    (a, b) =>
      a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name),
  ),
);

function providerLabel(id: string): string {
  return (
    providerCatalogState.customProviders.find((custom) => custom.id === id)
      ?.displayName ??
    authProviders.find((provider) => provider.provider === id)?.displayName ??
    id
  );
}

function isUnavailable(model: ModelDefinition): boolean {
  return !eligibleProviderIds.has(model.provider);
}

function openAdd(): void {
  if (providerItems.length === 0) return;
  editing = undefined;
  dialogOpen = true;
}

function openEdit(model: ModelDefinition): void {
  editing = model;
  dialogOpen = true;
}

async function confirmDelete(): Promise<void> {
  const model = pendingDelete;
  if (!model) return;
  try {
    await deleteModelDefinition(model.provider, model.modelId);
    await refreshProviderCatalog();
  } catch {
    // Catalog events keep the list in sync on failure.
  } finally {
    pendingDelete = undefined;
  }
}
</script>

<SettingsEntityListSection
  sectionId="custom-models"
  title="Custom models"
  addLabel="Add model"
  addDisabled={providerItems.length === 0}
  emptyTitle="No custom models"
  emptyDescription={providerItems.length === 0
    ? "Authenticate a provider before adding custom models."
    : "Add a model to expose it in the composer picker."}
  items={definitions}
  listAriaLabel="Custom models"
  itemKey={(model) => `${model.provider}:${model.modelId}`}
  onAdd={openAdd}
>
  {#snippet row(model)}
    <SettingsListItem variant="card" title={model.name}>
      {#snippet meta()}
        <span class="truncate">
          {providerLabel(model.provider)} ·
          <span class="font-mono">{model.modelId}</span>
          {#if isUnavailable(model)}
            · <span class="text-warning">Unavailable</span>
          {/if}
          {#if model.reasoning}
            · <span class="text-info">Reasoning</span>
          {/if}
        </span>
      {/snippet}
      {#snippet actions()}
        <Button variant="ghost" size="xs" onclick={() => openEdit(model)}
          >Edit</Button
        >
        <Button
          variant="ghost"
          size="xs"
          onclick={() => (pendingDelete = model)}>Delete</Button
        >
      {/snippet}
    </SettingsListItem>
  {/snippet}
</SettingsEntityListSection>

<ModelDefinitionDialog bind:open={dialogOpen} model={editing} {providerItems} />

<ConfirmDialog
  open={!!pendingDelete}
  title="Delete model?"
  description={pendingDelete
    ? `This removes “${pendingDelete.name}” (${pendingDelete.modelId}) from the catalog.`
    : ""}
  confirmLabel="Delete"
  destructive
  onConfirm={() => void confirmDelete()}
  onOpenChange={(open) => {
    if (!open) pendingDelete = undefined;
  }}
/>
