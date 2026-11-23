<script lang="ts">
import { untrack } from "svelte";
import Compass from "@lucide/svelte/icons/compass";
import LogOut from "@lucide/svelte/icons/log-out";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import { toast } from "svelte-sonner";
import {
  MobileListRow,
  MobileScreen,
  MobileSection,
} from "$lib/presentation/shell";
import {
  settingsNavFor,
  settingsPageFor,
} from "$lib/features/settings/registry/settings-pages";
import ThemePreviewPicker from "$lib/features/settings/views/pages/workbench/ThemePreviewPicker.svelte";
import { accessGate, signOutThisDevice } from "$lib/features/access";
import {
  loadSettingsPanel,
  setTheme,
} from "$lib/application/settings/settings-actions.svelte";
import { workspaceSelectors } from "$lib/application/workspace";
import { appearanceState } from "$lib/platform/appearance/appearance.svelte";
import type { ColorTheme } from "$lib/api";
import { discoverTitlebarBadge, openDiscoverPane } from "$lib/app/discover";
import { openMobileCenter } from "$lib/app/shell/mobile/mobile-route-activation.svelte";
import {
  backFromMobileScreen,
  pushMobileScreen,
} from "$lib/app/shell/mobile/mobile-shell.svelte";
import { phoneSettingsItems } from "./mobile-settings";

/**
 * Phone settings: this device, the few pages that matter away from a desk
 * (devices, notifications), and the theme. Configuration stays on desktop.
 */
const discoverBadge = $derived(discoverTitlebarBadge());
const status = $derived(workspaceSelectors.status);
const items = phoneSettingsItems(settingsNavFor({}));
const device = $derived(
  accessGate.session?.principal === "device"
    ? accessGate.session.device
    : undefined,
);
let confirmSignOut = $state(false);

$effect(() => {
  untrack(() => void loadSettingsPanel());
});

async function signOut(): Promise<void> {
  try {
    await signOutThisDevice();
  } catch {
    toast.error("Could not sign out", {
      description: "Check the connection and try again.",
    });
  }
}
</script>

{#snippet discoverDot()}
  <span class="size-2 rounded-full bg-info" aria-label="New"></span>
{/snippet}

<MobileScreen
  title="Settings"
  subtitle={status?.version ? `Nerve v${status.version}` : undefined}
  onBack={backFromMobileScreen}
  backLabel="Back"
>
  {#if device}
    <MobileSection title="This device">
      <MobileListRow
        title="Sign out"
        detail={device.name}
        icon={LogOut}
        chevron={false}
        onclick={() => (confirmSignOut = true)}
      />
    </MobileSection>
  {/if}

  <MobileSection>
    {#each items as item (item.id)}
      <MobileListRow
        title={item.label}
        detail={settingsPageFor({}, item.id).description}
        icon={item.icon}
        onclick={() =>
          pushMobileScreen({ kind: "settings-page", pageId: item.id })}
      />
    {/each}
  </MobileSection>

  <MobileSection title="Appearance">
    <div class="p-3">
      <ThemePreviewPicker
        value={appearanceState.theme}
        onValueChange={(value) => setTheme(value as ColorTheme)}
      />
    </div>
  </MobileSection>

  <MobileSection>
    <MobileListRow
      title="Discover"
      detail="Release notes, tips and setup"
      icon={Compass}
      count={discoverBadge.kind === "count" ? discoverBadge.value : undefined}
      trailing={discoverBadge.kind === "dot" ? discoverDot : undefined}
      onclick={() => void openMobileCenter("discover", openDiscoverPane)}
    />
  </MobileSection>

  <p class="px-4 pb-4 pt-1 text-caption text-muted-foreground">
    Providers, agents, tools and project settings are available in Nerve on a
    computer.
  </p>
</MobileScreen>

<ConfirmDialog
  open={confirmSignOut}
  destructive
  title="Sign out of Nerve?"
  description="This phone is removed from your devices. Pair it again to use Nerve here."
  confirmLabel="Sign out"
  onConfirm={() => {
    confirmSignOut = false;
    void signOut();
  }}
  onOpenChange={(open) => (confirmSignOut = open)}
/>
