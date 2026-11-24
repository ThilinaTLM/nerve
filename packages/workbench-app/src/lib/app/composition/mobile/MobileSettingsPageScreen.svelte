<script lang="ts">
import { PageEmptyState } from "@nervekit/ui-kit/components/composites/page";
import { appearanceState } from "$lib/platform/appearance/appearance.svelte";
import { untrack } from "svelte";
import Monitor from "@lucide/svelte/icons/monitor";
import { MobileScreen } from "$lib/presentation/shell";
import { settingsPageFor } from "$lib/features/settings/registry/settings-pages";
import type { SettingsScopeTarget } from "$lib/features/settings/registry/settings-scope";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { settingsSelectors } from "$lib/features/settings";
import {
  loadSettingsPanel,
  queueSettingsSave,
  restartOwnedDaemon,
  saveApplicationConfiguration,
  setTheme,
} from "$lib/application/settings/settings-actions.svelte";
import { workspaceSelectors } from "$lib/application/workspace";
import { backFromMobileScreen } from "$lib/app/shell/mobile/mobile-shell.svelte";
import SettingsPageActions from "../settings/SettingsPageActions.svelte";
import SettingsPageContent from "../settings/SettingsPageContent.svelte";
import { createSettingsPageControllers } from "../settings/settings-page-controllers.svelte";
import { isPhoneSettingsPage } from "./mobile-settings";

/**
 * One settings page as a phone screen. The body is the desktop page component;
 * only the navigation around it (sidebar, section links) is phone-native.
 * Pages the phone does not offer (a link from elsewhere) say so instead.
 */
let {
  target,
  pageId,
  backLabel,
}: {
  target: SettingsScopeTarget;
  pageId: string;
  backLabel: string;
} = $props();

// Routes can outlive the registry (restored state); unknown pages show the default.
const page = $derived(settingsPageFor({}, pageId));
/** Open detail item of pages with a detail view; "" shows the list. */
let itemId = $state("");
let sectionId = $state<string>();
// A different page starts at its list.
$effect(() => {
  void page.id;
  untrack(() => (itemId = ""));
});
const desktopOnly = $derived(!isPhoneSettingsPage(page.id));
const status = $derived(workspaceSelectors.status);
const controllers = createSettingsPageControllers({
  target: () => target,
  project: () => undefined,
});
const saveLabel = $derived.by(() => {
  const message = settingsSelectors.settingsMessage;
  if (message) return message;
  switch (settingsSelectors.settingsSaveStatus) {
    case "saving":
      return "Saving…";
    case "dirty":
      return "Unsaved changes";
    case "saved":
      return "Saved";
    case "error":
      return "Could not save settings";
    default:
      return undefined;
  }
});

$effect(() => {
  untrack(() => {
    if (!settingsState.settingsDraft) void loadSettingsPanel();
  });
});
</script>

<MobileScreen
  title={page.label}
  subtitle={saveLabel}
  onBack={() => (itemId ? (itemId = "") : backFromMobileScreen())}
  {backLabel}
>
  {#snippet actions()}
    {#if !desktopOnly}<SettingsPageActions
        {page}
        {controllers}
        settingsDraft={settingsState.settingsDraft}
        onSettingsChange={queueSettingsSave}
      />{/if}
  {/snippet}

  <div class="grid gap-4 px-3 py-3">
    {#if desktopOnly}
      <PageEmptyState
        icon={Monitor}
        title="Available on desktop"
        description={`Open ${page.label} in Nerve on a computer to change it.`}
      />
    {:else}
      <SettingsPageContent
        {page}
        {target}
        {controllers}
        {itemId}
        {sectionId}
        onOpenItem={(id, section) => {
          itemId = id;
          sectionId = section;
        }}
        onCloseItem={() => (itemId = "")}
        {status}
        settingsDraft={settingsState.settingsDraft}
        applicationConfiguration={settingsState.applicationConfiguration}
        daemonCapability={settingsState.daemonCapability}
        daemonRestarting={settingsState.daemonRestarting}
        models={settingsState.models}
        authProviders={settingsState.authProviders}
        onSettingsChange={queueSettingsSave}
        onApplicationConfigurationChange={saveApplicationConfiguration}
        onRestartDaemon={restartOwnedDaemon}
        theme={appearanceState.theme}
        onThemeChange={setTheme}
      />
    {/if}
  </div>
</MobileScreen>
