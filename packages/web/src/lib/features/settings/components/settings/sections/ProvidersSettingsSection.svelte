<script lang="ts">
  import KeyRound from "@lucide/svelte/icons/key-round";
  import Plus from "@lucide/svelte/icons/plus";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import Sparkles from "@lucide/svelte/icons/sparkles";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import type { AuthProviderMetadata } from "$lib/api";
  import { deleteProviderCredential } from "$lib/api";
  import { loadSettingsPanel } from "$lib/features/settings/state/settings-actions.svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import ConfirmDialog from "$lib/components/ui/confirm-dialog";
  import AddProviderDialog from "./AddProviderDialog.svelte";

  type Props = {
    authProviders?: AuthProviderMetadata[];
  };

  let { authProviders = [] }: Props = $props();

  let addOpen = $state(false);
  let pendingLogout = $state<AuthProviderMetadata | undefined>(undefined);

  const subscriptions = $derived(
    authProviders
      .filter(
        (provider) =>
          provider.configured && provider.credentialType === "oauth",
      )
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  );
  const apiKeys = $derived(
    authProviders
      .filter(
        (provider) =>
          provider.configured && provider.credentialType === "api_key",
      )
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  );
  const configuredCount = $derived(subscriptions.length + apiKeys.length);

  async function confirmLogout() {
    const provider = pendingLogout;
    if (!provider) return;
    try {
      await deleteProviderCredential(provider.provider);
      await loadSettingsPanel();
    } catch {
      // Errors surface through the global event refresh; keep the UI responsive.
    } finally {
      pendingLogout = undefined;
    }
  }
</script>

<section id="settings-providers" class="settings-section" data-section="providers">
  <header class="settings-section-header">
    <div class="settings-section-kicker"><ShieldCheck size={14} strokeWidth={2.1} /> Providers</div>
    <h2>Authentication</h2>
    <p>Connect model providers with a subscription login or an API key. API keys are encrypted in your browser before being sent to the orchestrator.</p>
  </header>

  <div class="settings-section-body">
    <div class="settings-row providers-summary">
      <div class="settings-copy">
        <strong>{configuredCount === 0 ? "No providers connected" : `${configuredCount} connected`}</strong>
        <span>
          {subscriptions.length} subscription{subscriptions.length === 1 ? "" : "s"} ·
          {apiKeys.length} API key{apiKeys.length === 1 ? "" : "s"}
        </span>
      </div>
      <Button size="sm" onclick={() => (addOpen = true)}>
        <Plus size={15} strokeWidth={2.2} />
        Add provider
      </Button>
    </div>

    {#if configuredCount === 0}
      <p class="settings-note">Add a provider to start authenticating models.</p>
    {:else}
      {#if subscriptions.length > 0}
        <div class="provider-group">
          <h3 class="provider-group-title"><Sparkles size={13} strokeWidth={2} /> Subscriptions</h3>
          <ul class="provider-list">
            {#each subscriptions as provider (provider.provider)}
              <li class="provider-item">
                <div class="provider-item-text">
                  <strong>{provider.displayName}</strong>
                  <span>{provider.oauthName ?? provider.provider}</span>
                  {#if provider.warning}
                    <p class="provider-warning">
                      <TriangleAlert size={13} strokeWidth={2} class="mt-0.5 flex-none" />
                      {provider.warning}
                    </p>
                  {/if}
                </div>
                <div class="provider-item-actions">
                  <Badge tone="good" size="sm">Connected</Badge>
                  <Button variant="ghost" size="sm" onclick={() => (pendingLogout = provider)}>
                    Log out
                  </Button>
                </div>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if apiKeys.length > 0}
        <div class="provider-group">
          <h3 class="provider-group-title"><KeyRound size={13} strokeWidth={2} /> API keys</h3>
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
                  <Button variant="ghost" size="sm" onclick={() => (pendingLogout = provider)}>
                    Remove
                  </Button>
                </div>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    {/if}
  </div>
</section>

<AddProviderDialog bind:open={addOpen} {authProviders} />

<ConfirmDialog
  open={!!pendingLogout}
  title={pendingLogout?.credentialType === "oauth" ? "Log out of provider?" : "Remove API key?"}
  description={pendingLogout
    ? `This removes the stored ${pendingLogout.credentialType === "oauth" ? "subscription login" : "API key"} for “${pendingLogout.displayName}” from the orchestrator.`
    : ""}
  confirmLabel={pendingLogout?.credentialType === "oauth" ? "Log out" : "Remove"}
  destructive
  onConfirm={() => void confirmLogout()}
  onOpenChange={(open) => {
    if (!open) pendingLogout = undefined;
  }}
/>

<style>
  .providers-summary {
    align-items: center;
  }

  .provider-group {
    display: grid;
    gap: 0.45rem;
  }

  .provider-group-title {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
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

  .provider-warning {
    display: flex;
    align-items: flex-start;
    gap: 0.35rem;
    margin: 0.25rem 0 0;
    color: var(--warning);
    font-size: var(--text-xs);
    line-height: 1.4;
  }

  .provider-item-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: 0.5rem;
  }
</style>
