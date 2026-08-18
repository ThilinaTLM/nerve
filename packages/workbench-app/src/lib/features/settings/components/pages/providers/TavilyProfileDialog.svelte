<script lang="ts">
import type { TavilyProfile } from "$lib/api";
import {
  getAuthProviders,
  getCredentialKey,
  setProviderApiKey,
} from "$lib/api";
import { encryptApiKey } from "$lib/core/utils/credential-crypto";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { createProfileId, tavilyCredentialId } from "./provider-profiles";

type Props = {
  open?: boolean;
  profile?: TavilyProfile;
  configured?: boolean;
  onSave: (profile: TavilyProfile) => void;
};

let {
  open = $bindable(false),
  profile,
  configured = false,
  onSave,
}: Props = $props();
let name = $state("");
let apiKey = $state("");
let busy = $state(false);
let error = $state<string | undefined>();
let lastOpen = false;

$effect(() => {
  if (open && !lastOpen) {
    name = profile?.name ?? "";
    apiKey = "";
    error = undefined;
  }
  lastOpen = open;
});

async function save(): Promise<void> {
  const trimmedName = name.trim();
  const trimmedKey = apiKey.trim();
  if (!trimmedName) {
    error = "Enter a profile name.";
    return;
  }
  if (!configured && !trimmedKey) {
    error = "Enter a Tavily API key.";
    return;
  }
  busy = true;
  error = undefined;
  try {
    const next = { id: profile?.id ?? createProfileId(), name: trimmedName };
    if (trimmedKey) {
      const key = await getCredentialKey();
      await setProviderApiKey(
        tavilyCredentialId(next.id),
        await encryptApiKey(trimmedKey, key),
      );
    }
    onSave(next);
    settingsState.authProviders = await getAuthProviders();
    open = false;
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Could not save profile.";
    settingsState.settingsSaveStatus = "error";
  } finally {
    busy = false;
  }
}
</script>

<Dialog
  bind:open
  size="sm"
  title={profile ? "Edit Tavily profile" : "Add Tavily profile"}
  description="Store a named API key for web search."
>
  <div class="grid gap-3">
    <div class="grid gap-1.5">
      <Label for="tavily-profile-name">Profile name</Label>
      <Input id="tavily-profile-name" bind:value={name} placeholder="Work" />
    </div>
    <div class="grid gap-1.5">
      <Label for="tavily-profile-key">API key</Label>
      <Input
        id="tavily-profile-key"
        type="password"
        bind:value={apiKey}
        placeholder={configured ? "Leave blank to keep current key" : "tvly-…"}
        data-tour-id="setup-tavily-api-key"
      />
    </div>
    {#if error}<p class="text-xs text-destructive">{error}</p>{/if}
  </div>
  {#snippet footer()}
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      onclick={() => (open = false)}>Cancel</Button
    >
    <Button
      size="sm"
      disabled={busy}
      data-tour-id="setup-tavily-save"
      onclick={() => void save()}
    >
      {#if busy}<Spinner class="size-3.5" />{/if}
      Save profile
    </Button>
  {/snippet}
</Dialog>
