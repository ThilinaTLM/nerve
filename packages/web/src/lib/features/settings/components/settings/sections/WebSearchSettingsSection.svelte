<script lang="ts">
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import KeyRound from "@lucide/svelte/icons/key-round";
  import Loader from "@lucide/svelte/icons/loader-circle";
  import Search from "@lucide/svelte/icons/search";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import type { AuthProviderMetadata } from "$lib/api";
  import {
    deleteProviderCredential,
    getCredentialKey,
    setProviderApiKey,
  } from "$lib/api";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import ConfirmDialog from "$lib/components/ui/confirm-dialog";
  import { Input } from "$lib/components/ui/input";
  import { loadSettingsPanel } from "$lib/stores/settings.svelte";
  import { encryptApiKey } from "$lib/utils/credential-crypto";

  type Props = {
    authProviders?: AuthProviderMetadata[];
  };

  const providerId = "tavily";

  let { authProviders = [] }: Props = $props();

  let apiKey = $state("");
  let busy = $state(false);
  let error = $state<string | undefined>(undefined);
  let message = $state<string | undefined>(undefined);
  let removeOpen = $state(false);

  const tavilyProvider = $derived(
    authProviders.find((provider) => provider.provider === providerId),
  );
  const configured = $derived(
    tavilyProvider?.configured && tavilyProvider.credentialType === "api_key",
  );
  const displayName = $derived(tavilyProvider?.displayName ?? "Tavily");

  async function saveKey() {
    const trimmed = apiKey.trim();
    if (!trimmed) return;
    busy = true;
    error = undefined;
    message = undefined;
    try {
      const credentialKey = await getCredentialKey();
      const envelope = await encryptApiKey(trimmed, credentialKey);
      await setProviderApiKey(providerId, envelope);
      apiKey = "";
      message = `${displayName} API key saved.`;
      await loadSettingsPanel();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function removeKey() {
    busy = true;
    error = undefined;
    message = undefined;
    try {
      await deleteProviderCredential(providerId);
      apiKey = "";
      message = `${displayName} API key removed.`;
      await loadSettingsPanel();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
      removeOpen = false;
    }
  }
</script>

<section id="settings-web-search" class="settings-section" data-section="web-search">
  <header class="settings-section-header">
    <div class="settings-section-kicker"><Search size={14} strokeWidth={2.1} /> Web Search</div>
    <h2>Web search</h2>
    <p>Configure the Tavily API key used by the web_search tool. The key is encrypted in your browser before it is stored by the orchestrator.</p>
  </header>

  <div class="settings-section-body">
    <div class="settings-row web-search-summary">
      <div class="settings-copy">
        <strong>{configured ? `${displayName} key configured` : "Web search is not configured"}</strong>
        <span>
          {configured
            ? "Agents can search current external information with Tavily."
            : "Add a Tavily key to enable the web_search tool."}
        </span>
      </div>
      <Badge tone={configured ? "good" : "neutral"} size="sm">
        {configured ? "Configured" : "Missing key"}
      </Badge>
    </div>

    <form
      class="web-search-key-form"
      onsubmit={(event) => {
        event.preventDefault();
        void saveKey();
      }}
    >
      <label class="web-search-key-label" for="web-search-api-key">
        <span><KeyRound size={13} strokeWidth={2} /> Tavily API key</span>
        <Input
          id="web-search-api-key"
          type="password"
          autocomplete="off"
          placeholder={configured ? "Paste a replacement key" : "Paste your Tavily API key"}
          bind:value={apiKey}
          disabled={busy}
        />
      </label>

      <div class="web-search-actions">
        <Button type="submit" size="sm" disabled={busy || apiKey.trim().length === 0}>
          {#if busy}
            <Loader size={14} strokeWidth={2} class="animate-spin" />
          {/if}
          {configured ? "Replace key" : "Save key"}
        </Button>
        {#if configured}
          <Button type="button" variant="ghost" size="sm" disabled={busy} onclick={() => (removeOpen = true)}>
            Remove
          </Button>
        {/if}
      </div>
    </form>

    {#if error}
      <p class="web-search-message" data-tone="error">
        <TriangleAlert size={14} strokeWidth={2} />
        {error}
      </p>
    {:else if message}
      <p class="web-search-message" data-tone="success">
        <CircleCheck size={14} strokeWidth={2} />
        {message}
      </p>
    {/if}
  </div>
</section>

<ConfirmDialog
  open={removeOpen}
  title="Remove Tavily API key?"
  description="This disables the web_search tool until another Tavily key is configured."
  confirmLabel="Remove"
  destructive
  onConfirm={() => void removeKey()}
  onOpenChange={(open) => {
    removeOpen = open;
  }}
/>

<style>
  .web-search-summary {
    align-items: center;
  }

  .web-search-key-form {
    display: grid;
    gap: 0.65rem;
    max-width: 34rem;
  }

  .web-search-key-label {
    display: grid;
    gap: 0.35rem;
    color: var(--muted-foreground);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .web-search-key-label > span,
  .web-search-message,
  .web-search-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .web-search-actions {
    flex-wrap: wrap;
  }

  .web-search-message {
    margin: 0;
    font-size: var(--text-xs);
    line-height: 1.4;
  }

  .web-search-message[data-tone="error"] {
    color: var(--destructive);
  }

  .web-search-message[data-tone="success"] {
    color: var(--success);
  }

</style>
