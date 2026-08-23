<script lang="ts">
import type { AtlassianProfile } from "$lib/api";
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
import {
  atlassianCredentialId,
  createProfileId,
  normalizeAtlassianSiteUrl,
} from "./provider-profiles";

type Props = {
  open?: boolean;
  profile?: AtlassianProfile;
  configured?: boolean;
  onSave: (profile: AtlassianProfile) => void;
};
let {
  open = $bindable(false),
  profile,
  configured = false,
  onSave,
}: Props = $props();
let name = $state("");
let siteUrl = $state("");
let email = $state("");
let token = $state("");
let defaultProjectKey = $state("");
let defaultSpaceKey = $state("");
let busy = $state(false);
let error = $state<string | undefined>();
let lastOpen = false;

$effect(() => {
  if (open && !lastOpen) {
    name = profile?.name ?? "";
    siteUrl = profile?.siteUrl ?? "";
    email = profile?.email ?? "";
    token = "";
    defaultProjectKey = profile?.defaultProjectKey ?? "";
    defaultSpaceKey = profile?.defaultSpaceKey ?? "";
    error = undefined;
  }
  lastOpen = open;
});

async function save(): Promise<void> {
  const normalizedUrl = normalizeAtlassianSiteUrl(siteUrl);
  const trimmedEmail = email.trim().toLowerCase();
  const trimmedToken = token.trim();
  if (!name.trim()) error = "Enter a profile name.";
  else if (!normalizedUrl) error = "Enter a valid Atlassian site URL.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail))
    error = "Enter a valid email address.";
  else if (!configured && !trimmedToken)
    error = "Enter an Atlassian API token.";
  else error = undefined;
  if (error || !normalizedUrl) return;
  busy = true;
  try {
    const next: AtlassianProfile = {
      id: profile?.id ?? createProfileId(),
      name: name.trim(),
      siteUrl: normalizedUrl,
      email: trimmedEmail,
      defaultProjectKey: defaultProjectKey.trim() || undefined,
      defaultSpaceKey: defaultSpaceKey.trim() || undefined,
    };
    if (trimmedToken) {
      const key = await getCredentialKey();
      await setProviderApiKey(
        atlassianCredentialId(next.id),
        await encryptApiKey(trimmedToken, key),
      );
    }
    onSave(next);
    settingsState.authProviders = await getAuthProviders();
    open = false;
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Could not save profile.";
  } finally {
    busy = false;
  }
}
</script>

<SettingsFormDialog
  bind:open
  title={profile ? "Edit Atlassian profile" : "Add Atlassian profile"}
  description="Use one Atlassian connection for Jira, Confluence, or both."
  saveLabel="Save profile"
  bodyClass="sm:grid-cols-2"
  bodyTourId="setup-atlassian-profile-form"
  errorClass="sm:col-span-2"
  {busy}
  {error}
  onSave={() => void save()}
>
  <SettingsFormField
    id="atlassian-profile-name"
    label="Profile name"
    class="sm:col-span-2"
  >
    <Input
      size="xs"
      id="atlassian-profile-name"
      bind:value={name}
      placeholder="Work"
    />
  </SettingsFormField>
  <SettingsFormField
    id="atlassian-site-url"
    label="Site URL"
    class="sm:col-span-2"
  >
    <Input
      size="xs"
      id="atlassian-site-url"
      bind:value={siteUrl}
      placeholder="https://example.atlassian.net"
    />
  </SettingsFormField>
  <SettingsFormField id="atlassian-email" label="Email" class="sm:col-span-2">
    <Input
      size="xs"
      id="atlassian-email"
      type="email"
      bind:value={email}
      placeholder="name@example.com"
    />
  </SettingsFormField>
  <SettingsFormField
    id="atlassian-token"
    label="API token"
    class="sm:col-span-2"
  >
    <Input
      size="xs"
      id="atlassian-token"
      type="password"
      bind:value={token}
      placeholder={configured
        ? "Leave blank to keep current token"
        : "Paste API token"}
    />
  </SettingsFormField>
  <SettingsFormField id="atlassian-project-key" label="Default project key">
    <Input
      size="xs"
      id="atlassian-project-key"
      bind:value={defaultProjectKey}
      placeholder="PROJ"
    />
  </SettingsFormField>
  <SettingsFormField id="atlassian-space-key" label="Default space key">
    <Input
      size="xs"
      id="atlassian-space-key"
      bind:value={defaultSpaceKey}
      placeholder="DOCS"
    />
  </SettingsFormField>
</SettingsFormDialog>
