<script lang="ts">
import type { AuthProviderMetadata, Settings, StatusResponse } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { StatusDot } from "@nervekit/ui-kit/components/ui/status-dot";
import {
  SettingsGroup,
  SettingsList,
  SettingsListItem,
} from "$lib/presentation/components/settings";
import type { SettingsChange } from "../settings-change";
import IntegrationSettingsCard from "./IntegrationSettingsCard.svelte";
import PythonRuntimeDialog from "./PythonRuntimeDialog.svelte";
import TavilyKeyDialog from "./TavilyKeyDialog.svelte";
import { integrationProviders } from "./integration-providers";

type Props = {
  settingsDraft: Settings;
  status?: StatusResponse;
  authProviders?: AuthProviderMetadata[];
  onSettingsChange?: SettingsChange;
};

const tavilyProviderId = "tavily";

let {
  settingsDraft,
  status,
  authProviders = [],
  onSettingsChange,
}: Props = $props();

let tavilyDialogOpen = $state(false);
let pythonDialogOpen = $state(false);

const python = $derived(status?.runtime.python);
const tavilyProvider = $derived(
  authProviders.find((provider) => provider.provider === tavilyProviderId),
);
const tavilyConfigured = $derived(
  Boolean(
    tavilyProvider?.configured && tavilyProvider.credentialType === "api_key",
  ),
);
const tavilyDisplayName = $derived(tavilyProvider?.displayName ?? "Tavily");
const manualPythonPath = $derived(
  settingsDraft.runtime?.pythonExecutablePath ?? "",
);
</script>

<SettingsGroup>
  <SettingsList ariaLabel="Integrations">
    <SettingsListItem
      title={tavilyDisplayName}
      description={tavilyConfigured
        ? "API key configured for web search."
        : "Add an API key to enable web search."}
    >
      {#snippet leading()}
        <StatusDot
          tone={tavilyConfigured ? "good" : "neutral"}
          label={tavilyConfigured
            ? `${tavilyDisplayName} connected`
            : `${tavilyDisplayName} not configured`}
        />
      {/snippet}
      {#snippet actions()}
        <Button
          size="xs"
          variant="outline"
          onclick={() => (tavilyDialogOpen = true)}>Configure</Button
        >
      {/snippet}
    </SettingsListItem>

    <SettingsListItem
      title="Python runtime"
      description={python?.available
        ? (python.executable ?? "Runtime available")
        : (python?.error ?? "No Python runtime was detected.")}
    >
      {#snippet leading()}
        <StatusDot
          tone={python?.available ? "good" : "warn"}
          label={python?.available
            ? "Python runtime available"
            : "Python runtime unavailable"}
        />
      {/snippet}
      {#snippet meta()}
        {#if manualPythonPath}
          <span class="truncate">Manual path</span>
        {/if}
      {/snippet}
      {#snippet actions()}
        <Button
          size="xs"
          variant="outline"
          onclick={() => (pythonDialogOpen = true)}>Configure</Button
        >
      {/snippet}
    </SettingsListItem>

    {#each integrationProviders as provider (provider.id)}
      <IntegrationSettingsCard
        {provider}
        {settingsDraft}
        {authProviders}
        {onSettingsChange}
      />
    {/each}
  </SettingsList>
</SettingsGroup>

<TavilyKeyDialog
  bind:open={tavilyDialogOpen}
  configured={tavilyConfigured}
  displayName={tavilyDisplayName}
/>

<PythonRuntimeDialog
  bind:open={pythonDialogOpen}
  {settingsDraft}
  {python}
  {onSettingsChange}
/>
