<script lang="ts">
import type { TavilyProfile } from "$lib/api";
import {
  getAuthProviders,
  getCredentialKey,
  setProviderApiKey,
} from "$lib/api";
import { encryptApiKey } from "$lib/platform/crypto/credential-crypto";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import SettingsFormDialog from "../../shared/settings-form-dialog.svelte";
import SettingsFormField from "../../shared/settings-form-field.svelte";
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

<SettingsFormDialog
  bind:open
  title={profile ? "Edit Tavily profile" : "Add Tavily profile"}
  description="Store a named API key for web search."
  saveLabel="Save profile"
  saveTourId="setup-tavily-save"
  {busy}
  {error}
  onSave={() => void save()}
>
  <SettingsFormField id="tavily-profile-name" label="Profile name">
    <Input
      size="xs"
      id="tavily-profile-name"
      bind:value={name}
      placeholder="Work"
    />
  </SettingsFormField>
  <SettingsFormField id="tavily-profile-key" label="API key">
    <Input
      size="xs"
      id="tavily-profile-key"
      type="password"
      bind:value={apiKey}
      placeholder={configured ? "Leave blank to keep current key" : "tvly-…"}
      data-tour-id="setup-tavily-api-key"
    />
  </SettingsFormField>
</SettingsFormDialog>
