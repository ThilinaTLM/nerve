<script lang="ts">
import Boxes from "@lucide/svelte/icons/boxes";
import Brain from "@lucide/svelte/icons/brain";
import Plug from "@lucide/svelte/icons/plug";
import {
  SettingsShell,
  type SettingsPageDef,
} from "$lib/presentation/components/settings";
import { authState } from "$lib/features/auth/state/auth-state.svelte";
import { loadAuthPanel } from "$lib/features/auth/state/auth.svelte";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import ApiKeysSection from "./ApiKeysSection.svelte";
import CustomProvidersSection from "./CustomProvidersSection.svelte";
import ModelsSection from "./ModelsSection.svelte";
import SubscriptionsSection from "./SubscriptionsSection.svelte";

const authPages: SettingsPageDef[] = [
  {
    id: "connections",
    label: "Connections",
    icon: Plug,
    sections: [
      { id: "subscriptions", label: "Subscriptions" },
      { id: "api-keys", label: "API keys" },
    ],
  },
  {
    id: "custom-providers",
    label: "Custom providers",
    icon: Boxes,
    description:
      "Connect local or self-hosted endpoints that expose an OpenAI- or Anthropic-compatible API.",
    sections: [{ id: "custom-providers", label: "Custom providers" }],
  },
  {
    id: "custom-models",
    label: "Custom models",
    icon: Brain,
    description: "Expose additional models in the composer picker.",
    sections: [{ id: "custom-models", label: "Custom models" }],
  },
];

const authProviders = $derived(settingsState.authProviders);
const models = $derived(settingsState.models);

if (!authState.catalogLoaded) void loadAuthPanel();
</script>

<SettingsShell
  pages={authPages}
  title="Authentication"
  ariaLabel="Authentication pages"
  bind:activePageId={authState.activePageId}
  bind:activeSectionId={authState.activeSectionId}
>
  {#snippet children(page)}
    {#if page.id === "connections"}
      <SubscriptionsSection {authProviders} />
      <ApiKeysSection {authProviders} />
    {:else if page.id === "custom-providers"}
      <CustomProvidersSection {authProviders} />
    {:else if page.id === "custom-models"}
      <ModelsSection {models} {authProviders} />
    {/if}
  {/snippet}
</SettingsShell>
