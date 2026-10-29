<script lang="ts">
import ProviderIcon from "$lib/presentation/model-picker/ProviderIcon.svelte";
import { subscriptionAccountLabel } from "./subscription-label";
import LogOut from "@lucide/svelte/icons/log-out";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import type { AuthProviderMetadata } from "$lib/api";
import { deleteProviderCredential } from "$lib/api";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { SettingsListItem } from "$lib/presentation/settings";
import { loadSettingsPanel } from "$lib/application/settings/settings-actions.svelte";
import {
  SettingsSection,
  SettingsList,
  SettingsEmptyState,
} from "$lib/presentation/settings";
import AddProviderDialog from "./AddProviderDialog.svelte";

type Props = {
  authProviders?: AuthProviderMetadata[];
};

let { authProviders = [] }: Props = $props();

let pendingLogout = $state<AuthProviderMetadata | undefined>(undefined);

const subscriptions = $derived(
  authProviders
    .filter(
      (provider) => provider.configured && provider.credentialType === "oauth",
    )
    .sort((a, b) => a.displayName.localeCompare(b.displayName)),
);

async function confirmLogout(): Promise<void> {
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

<SettingsSection id="subscriptions" title="Subscriptions">
  {#snippet actions()}
    <AddProviderDialog
      {authProviders}
      kind="oauth"
      triggerLabel="Connect subscription"
      triggerTourId="setup-auth-connect-subscription"
    />
  {/snippet}
  {#if subscriptions.length === 0}
    <SettingsEmptyState
      variant="card"
      title="No subscriptions connected"
      description="Connect a subscription to authenticate models."
    />
  {:else}
    <SettingsList ariaLabel="Connected subscriptions">
      {#each subscriptions as provider (provider.provider)}
        <SettingsListItem
          title={provider.displayName}
          tourId={provider.provider === "openai-codex"
            ? "setup-auth-openai-codex-connected"
            : undefined}
        >
          {#snippet leading()}
            <ProviderIcon
              provider={provider.provider}
              class="size-4 shrink-0"
            />
          {/snippet}
          {#snippet detail()}
            {@const account = subscriptionAccountLabel(
              provider.displayName,
              provider.oauthName,
            )}
            {#if account}
              <span class="truncate">{account}</span>
            {/if}
          {/snippet}
          {#snippet status()}
            {#if provider.warning}
              <Tooltip.Provider delayDuration={200}>
                <Tooltip.Root>
                  <Tooltip.Trigger
                    aria-label={`${provider.displayName} warning: ${provider.warning}`}
                    class="inline-flex cursor-help rounded-sm text-warning focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    <TriangleAlert class="size-3.5" aria-hidden="true" />
                  </Tooltip.Trigger>
                  <Tooltip.Content class="max-w-xs"
                    >{provider.warning}</Tooltip.Content
                  >
                </Tooltip.Root>
              </Tooltip.Provider>
            {/if}
          {/snippet}
          {#snippet actions()}
            <IconAction
              icon={LogOut}
              label="Log out"
              onclick={() => (pendingLogout = provider)}
            />
          {/snippet}
        </SettingsListItem>
      {/each}
    </SettingsList>
  {/if}
</SettingsSection>

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
