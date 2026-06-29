<script lang="ts">
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import KeyRound from "@lucide/svelte/icons/key-round";
  import Loader from "@lucide/svelte/icons/loader-circle";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import type { AuthProviderMetadata } from "$lib/api";
  import {
    deleteProviderCredential,
    getCredentialKey,
    setProviderApiKey,
  } from "$lib/api";
  import { Button } from "$lib/components/ui/button";
  import ConfirmDialog from "$lib/components/ui/confirm-dialog";
  import { Input } from "$lib/components/ui/input";
  import { loadAuthPanel } from "$lib/features/auth/state/auth.svelte";
  import { encryptApiKey } from "$lib/core/utils/credential-crypto";

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
      await loadAuthPanel();
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
      await loadAuthPanel();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
      removeOpen = false;
    }
  }
</script>

<section id="auth-integrations" class="settings-section" data-section="integrations">
  <header class="settings-section-header">
    <h2>Web search</h2>
  </header>

  <div class="settings-section-body">
    <form
      class="integrations-key-form"
      onsubmit={(event) => {
        event.preventDefault();
        void saveKey();
      }}
    >
      <label class="integrations-key-label" for="integrations-tavily-key">
        <span><KeyRound size={13} strokeWidth={2} /> Tavily API key</span>
        <Input
          id="integrations-tavily-key"
          type="password"
          autocomplete="off"
          placeholder={configured ? "Paste a replacement key" : "Paste your Tavily API key"}
          bind:value={apiKey}
          disabled={busy}
        />
      </label>

      <div class="integrations-actions">
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
      <p class="integrations-message" data-tone="error">
        <TriangleAlert size={14} strokeWidth={2} />
        {error}
      </p>
    {:else if message}
      <p class="integrations-message" data-tone="success">
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
  .integrations-key-form {
    display: grid;
    gap: 0.65rem;
    max-width: 34rem;
  }

  .integrations-key-label {
    display: grid;
    gap: 0.35rem;
    color: var(--muted-foreground);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .integrations-key-label > span,
  .integrations-message,
  .integrations-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .integrations-actions {
    flex-wrap: wrap;
  }

  .integrations-message {
    margin: 0;
    font-size: var(--text-xs);
    line-height: 1.4;
  }

  .integrations-message[data-tone="error"] {
    color: var(--destructive);
  }

  .integrations-message[data-tone="success"] {
    color: var(--success);
  }
</style>
