<script lang="ts">
import type { AtlassianProfile } from "$lib/api";
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

<Dialog
  bind:open
  size="sm"
  title={profile ? "Edit Atlassian profile" : "Add Atlassian profile"}
  description="Use one Atlassian connection for Jira, Confluence, or both."
>
  <div class="grid gap-3 sm:grid-cols-2">
    <div class="grid gap-1.5 sm:col-span-2">
      <Label for="atlassian-profile-name">Profile name</Label><Input
        id="atlassian-profile-name"
        bind:value={name}
        placeholder="Work"
      />
    </div>
    <div class="grid gap-1.5 sm:col-span-2">
      <Label for="atlassian-site-url">Site URL</Label><Input
        id="atlassian-site-url"
        bind:value={siteUrl}
        placeholder="https://example.atlassian.net"
      />
    </div>
    <div class="grid gap-1.5 sm:col-span-2">
      <Label for="atlassian-email">Email</Label><Input
        id="atlassian-email"
        type="email"
        bind:value={email}
        placeholder="name@example.com"
      />
    </div>
    <div class="grid gap-1.5 sm:col-span-2">
      <Label for="atlassian-token">API token</Label><Input
        id="atlassian-token"
        type="password"
        bind:value={token}
        placeholder={configured
          ? "Leave blank to keep current token"
          : "Paste API token"}
      />
    </div>
    <div class="grid gap-1.5">
      <Label for="atlassian-project-key">Default project key</Label><Input
        id="atlassian-project-key"
        bind:value={defaultProjectKey}
        placeholder="PROJ"
      />
    </div>
    <div class="grid gap-1.5">
      <Label for="atlassian-space-key">Default space key</Label><Input
        id="atlassian-space-key"
        bind:value={defaultSpaceKey}
        placeholder="DOCS"
      />
    </div>
    {#if error}<p class="text-xs text-destructive sm:col-span-2">
        {error}
      </p>{/if}
  </div>
  {#snippet footer()}
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      onclick={() => (open = false)}>Cancel</Button
    >
    <Button size="sm" disabled={busy} onclick={() => void save()}
      >{#if busy}<Spinner class="size-3.5" />{/if}Save profile</Button
    >
  {/snippet}
</Dialog>
