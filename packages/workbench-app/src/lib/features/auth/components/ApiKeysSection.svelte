<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import type { AuthProviderMetadata } from "$lib/api";
  import { deleteProviderCredential } from "$lib/api";
  import { Badge } from "@nervekit/workbench-ui/components/ui/badge";
  import { Button } from "@nervekit/workbench-ui/components/ui/button";
  import ConfirmDialog from "@nervekit/workbench-ui/components/ui/confirm-dialog";
  import { authState } from "$lib/features/auth/state/auth-state.svelte";
  import { loadAuthPanel } from "$lib/features/auth/state/auth.svelte";
  import AddProviderDialog from "./AddProviderDialog.svelte";

  type Props = {
    authProviders?: AuthProviderMetadata[];
  };

  let { authProviders = [] }: Props = $props();

  let addOpen = $state(false);
  let pendingRemove = $state<AuthProviderMetadata | undefined>(undefined);

  // Custom providers manage their own key in the Custom providers section.
  const customIds = $derived(
    new Set(authState.customProviders.map((provider) => provider.id)),
  );
  const reserved = $derived(new Set(["tavily", "jira", ...customIds]));

  const apiKeys = $derived(
    authProviders
      .filter(
        (provider) =>
          provider.configured &&
          provider.credentialType === "api_key" &&
          !reserved.has(provider.provider),
      )
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  );
  const excludeProviders = $derived([...reserved]);

  async function confirmRemove() {
    const provider = pendingRemove;
    if (!provider) return;
    try {
      await deleteProviderCredential(provider.provider);
      await loadAuthPanel();
    } catch {
      // Errors surface through the global event refresh.
    } finally {
      pendingRemove = undefined;
    }
  }
</script>

<section id="auth-api-keys" class="settings-section" data-section="api-keys">
  <header class="settings-section-header">
    <h2>API keys</h2>
  </header>

  <div class="settings-section-body">
    <div class="settings-row providers-summary">
      <Button size="sm" onclick={() => (addOpen = true)}>
        <Plus size={15} strokeWidth={2.2} />
        Add API key
      </Button>
    </div>

    {#if apiKeys.length === 0}
      <p class="settings-note">Add a provider API key to authenticate models.</p>
    {:else}
      <ul class="provider-list">
        {#each apiKeys as provider (provider.provider)}
          <li class="provider-item">
            <div class="provider-item-text">
              <strong>{provider.displayName}</strong>
              {#if provider.envVar}
                <span>{provider.envVar}</span>
              {/if}
            </div>
            <div class="provider-item-actions">
              <Badge tone="good" size="sm">Configured</Badge>
              <Button variant="ghost" size="sm" onclick={() => (pendingRemove = provider)}>
                Remove
              </Button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

<AddProviderDialog
  bind:open={addOpen}
  {authProviders}
  kind="api_key"
  {excludeProviders}
/>

<ConfirmDialog
  open={!!pendingRemove}
  title="Remove API key?"
  description={pendingRemove
    ? `This removes the stored API key for “${pendingRemove.displayName}” from the orchestrator.`
    : ""}
  confirmLabel="Remove"
  destructive
  onConfirm={() => void confirmRemove()}
  onOpenChange={(open) => {
    if (!open) pendingRemove = undefined;
  }}
/>

<style>
  .providers-summary {
    align-items: center;
  }

  .provider-list {
    display: grid;
    gap: 0.4rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .provider-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    border: 1px solid color-mix(in oklab, var(--border) 50%, transparent);
    border-radius: var(--radius-sm);
    background: transparent;
    padding: 0.6rem 0.75rem;
  }

  .provider-item-text {
    display: grid;
    min-width: 0;
    gap: 0.12rem;
  }

  .provider-item-text strong {
    color: var(--foreground);
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .provider-item-text > span {
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .provider-item-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: 0.5rem;
  }
</style>
