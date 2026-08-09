<script lang="ts">
import KeyRound from "@lucide/svelte/icons/key-round";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import {
  deleteProviderCredential,
  getAuthProviders,
  getCredentialKey,
  setProviderApiKey,
} from "$lib/api";
import { encryptApiKey } from "$lib/core/utils/credential-crypto";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { SettingsInlineMessage } from "$lib/presentation/components/settings";

type Props = {
  open?: boolean;
  configured: boolean;
  displayName: string;
  providerId?: string;
};

let {
  open = $bindable(false),
  configured,
  displayName,
  providerId = "tavily",
}: Props = $props();

let apiKey = $state("");
let busy = $state(false);
let error = $state<string | undefined>(undefined);
let message = $state<string | undefined>(undefined);
let removeOpen = $state(false);
let lastOpen = false;

$effect(() => {
  if (open && !lastOpen) {
    apiKey = "";
    error = undefined;
    message = undefined;
  }
  lastOpen = open;
});

async function refreshAuthProviders(): Promise<void> {
  settingsState.authProviders = await getAuthProviders();
}

async function saveKey(): Promise<void> {
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
    await refreshAuthProviders();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    busy = false;
  }
}

async function removeKey(): Promise<void> {
  busy = true;
  error = undefined;
  message = undefined;
  try {
    await deleteProviderCredential(providerId);
    apiKey = "";
    message = `${displayName} API key removed.`;
    await refreshAuthProviders();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    busy = false;
    removeOpen = false;
  }
}
</script>

<Dialog
  bind:open
  size="sm"
  title={`Configure ${displayName} API key`}
  description="Store an API key for the web_search tool. The key is encrypted before it is sent to the daemon."
>
  <form
    class="grid gap-3"
    onsubmit={(event) => {
      event.preventDefault();
      void saveKey();
    }}
  >
    <div class="grid gap-1.5">
      <Label
        for="tools-tavily-key"
        class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
      >
        <KeyRound class="size-3.5" aria-hidden="true" />
        {displayName} API key
      </Label>
      <Input
        id="tools-tavily-key"
        data-tour-id="setup-tavily-api-key"
        type="password"
        autocomplete="off"
        placeholder={configured
          ? "Paste a replacement key"
          : `Paste your ${displayName} API key`}
        bind:value={apiKey}
        disabled={busy}
      />
    </div>

    {#if configured}
      <p class="text-xs text-muted-foreground">
        Current key: <span class="font-mono">•••••••• configured</span>
      </p>
    {/if}

    {#if error}
      <SettingsInlineMessage tone="error" text={error} />
    {:else if message}
      <SettingsInlineMessage tone="success" text={message} />
    {/if}
  </form>

  {#snippet footer()}
    <Button
      size="sm"
      type="button"
      variant="ghost"
      onclick={() => (open = false)}>Close</Button
    >
    {#if configured}
      <Button
        size="sm"
        type="button"
        variant="outline"
        disabled={busy}
        onclick={() => (removeOpen = true)}>Remove key</Button
      >
    {/if}
    <Button
      size="sm"
      data-tour-id="setup-tavily-save"
      disabled={busy || apiKey.trim().length === 0}
      onclick={() => void saveKey()}
    >
      {#if busy}
        <Spinner class="size-3.5" />
      {/if}
      {configured ? "Replace key" : "Save key"}
    </Button>
  {/snippet}
</Dialog>

<ConfirmDialog
  open={removeOpen}
  title={`Remove ${displayName} API key?`}
  description="This disables web search until another key is configured. The Web access module setting is not changed."
  confirmLabel="Remove"
  destructive
  onConfirm={() => void removeKey()}
  onOpenChange={(next) => {
    removeOpen = next;
  }}
/>
