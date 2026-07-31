<script lang="ts">
import Pencil from "@lucide/svelte/icons/pencil";
import Plus from "@lucide/svelte/icons/plus";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type {
  AuthProviderMetadata,
  ModelDefinition,
  ModelInfo,
} from "$lib/api";
import { deleteModelDefinition } from "$lib/api";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import {
  SettingsEmptyState,
  SettingsGroup,
  SettingsList,
  SettingsListItem,
  SettingsToolbar,
} from "$lib/presentation/components/settings";
import { authState } from "$lib/features/auth/state/auth-state.svelte";
import { refreshProviderCatalog } from "$lib/features/auth/state/auth.svelte";
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
  new Set(authState.customProviders.map((custom) => custom.id)),
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
  ...authState.customProviders
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
  [...authState.modelDefinitions].sort(
    (a, b) =>
      a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name),
  ),
);

function providerLabel(id: string): string {
  return (
    authState.customProviders.find((custom) => custom.id === id)?.displayName ??
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

<SettingsToolbar>
  {#snippet end()}
    <Button size="sm" onclick={openAdd} disabled={providerItems.length === 0}>
      <Plus class="size-3.5" aria-hidden="true" />
      Add model
    </Button>
  {/snippet}
</SettingsToolbar>

<SettingsGroup>
  {#if definitions.length === 0}
    <SettingsEmptyState
      title="No custom models"
      description={providerItems.length === 0
        ? "Authenticate a provider before adding custom models."
        : "Add a model to expose it in the composer picker."}
    >
      {#snippet actions()}
        <Button
          size="sm"
          onclick={openAdd}
          disabled={providerItems.length === 0}>Add model</Button
        >
      {/snippet}
    </SettingsEmptyState>
  {:else}
    <SettingsList ariaLabel="Custom models">
      {#each definitions as model (`${model.provider}:${model.modelId}`)}
        <SettingsListItem title={model.name}>
          {#snippet badges()}
            {#if isUnavailable(model)}
              <Badge tone="warn" size="xs">Unavailable</Badge>
            {/if}
            {#if model.reasoning}
              <Badge tone="accent" size="xs">Reasoning</Badge>
            {/if}
          {/snippet}
          {#snippet meta()}
            <span class="truncate">
              {providerLabel(model.provider)} ·
              <span class="font-mono">{model.modelId}</span>
            </span>
          {/snippet}
          {#snippet actions()}
            <Button
              variant="ghost"
              size="icon-sm"
              ariaLabel="Edit model"
              onclick={() => openEdit(model)}
            >
              <Pencil class="size-3.5" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              ariaLabel="Delete model"
              onclick={() => (pendingDelete = model)}
            >
              <Trash2 class="size-3.5" aria-hidden="true" />
            </Button>
          {/snippet}
        </SettingsListItem>
      {/each}
    </SettingsList>
  {/if}
</SettingsGroup>

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
