<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import type { AuthProviderMetadata } from "$lib/api";
  import { deleteProviderCredential } from "$lib/api";
  import { Badge } from "@nervekit/workbench-ui/components/ui/badge";
  import { Button } from "@nervekit/workbench-ui/components/ui/button";
  import ConfirmDialog from "@nervekit/workbench-ui/components/ui/confirm-dialog";
  import { loadAuthPanel } from "$lib/features/auth/state/auth.svelte";
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

  async function confirmLogout() {
    const provider = pendingLogout;
    if (!provider) return;
    try {
      await deleteProviderCredential(provider.provider);
      await loadAuthPanel();
    } catch {
      // Errors surface through the global event refresh; keep the UI responsive.
    } finally {
      pendingLogout = undefined;
    }
  }
</script>

<section id="auth-subscriptions" class="settings-section" data-section="subscriptions">
  <header class="settings-section-header">
    <h2>Subscriptions</h2>
  </header>

  <div class="settings-section-body">
    <div class="settings-row providers-summary">
      <Button size="sm" onclick={() => (addOpen = true)}>
        <Plus size={15} strokeWidth={2.2} />
        Connect subscription
      </Button>
    </div>

    {#if subscriptions.length === 0}
      <p class="settings-note">Connect a subscription to authenticate models.</p>
    {:else}
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
    {/if}
  </div>
</section>

<AddProviderDialog bind:open={addOpen} {authProviders} kind="oauth" />

<ConfirmDialog
  open={!!pendingLogout}
  title="Log out of provider?"
  description={pendingLogout
    ? `This removes the stored subscription login for “${pendingLogout.displayName}” from the orchestrator.`
    : ""}
  confirmLabel="Log out"
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
