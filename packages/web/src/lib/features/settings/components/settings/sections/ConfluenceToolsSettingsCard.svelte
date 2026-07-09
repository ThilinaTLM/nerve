<script lang="ts">
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import KeyRound from "@lucide/svelte/icons/key-round";
  import Loader from "@lucide/svelte/icons/loader-circle";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import Wrench from "@lucide/svelte/icons/wrench";
  import type { AuthProviderMetadata, Settings, UpdateSettingsRequest } from "$lib/api";
  import {
    deleteProviderCredential,
    getAuthProviders,
    getCredentialKey,
    setProviderApiKey,
  } from "$lib/api";
  import { Button } from "@nervekit/shared-ui/components/ui/button";
  import ConfirmDialog from "@nervekit/shared-ui/components/ui/confirm-dialog";
  import * as Dialog from "@nervekit/shared-ui/components/ui/dialog";
  import { Input } from "@nervekit/shared-ui/components/ui/input";
  import { Switch as ToggleSwitch } from "@nervekit/shared-ui/components/ui/switch";
  import { encryptApiKey } from "$lib/core/utils/credential-crypto";
  import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
  import { SettingsSectionCard } from "@nervekit/shared-ui/components/settings";

  type SettingsChange = (
    patch: UpdateSettingsRequest,
    options?: { immediate?: boolean; debounceMs?: number },
  ) => void;
  type ToolSummary = { name: string; description: string };

  type Props = {
    settingsDraft: Settings;
    authProviders?: AuthProviderMetadata[];
    onSettingsChange?: SettingsChange;
  };

  const confluenceProviderId = "confluence";
  const confluenceTools: ToolSummary[] = [
    { name: "confluence_search_spaces", description: "List or resolve visible Confluence spaces." },
    { name: "confluence_search_pages", description: "Find pages with filters, CQL, or text search." },
    { name: "confluence_get_page", description: "Fetch a page with storage body, metadata, children, and attachments." },
    { name: "confluence_download_pages", description: "Download pages into editable JSONL and storage XML artifacts." },
    { name: "confluence_create_page", description: "Create pages from storage XML, body files, or page rows." },
    { name: "confluence_update_page", description: "Update pages with version-conflict protection." },
    { name: "confluence_publish_pages", description: "Publish edited JSONL page rows." },
    { name: "confluence_upload_attachment", description: "Upload or update media and file attachments." },
  ];

  let { settingsDraft, authProviders = [], onSettingsChange }: Props = $props();

  let dialogOpen = $state(false);
  let removeTokenOpen = $state(false);
  let busy = $state(false);
  let error = $state<string | undefined>(undefined);
  let message = $state<string | undefined>(undefined);
  let siteUrlDraft = $state("");
  let emailDraft = $state("");
  let tokenDraft = $state("");
  let spaceKeyDraft = $state("");

  const confluenceSettings = $derived(settingsDraft.tools?.confluence ?? { enabled: false });
  const confluenceProvider = $derived(
    authProviders.find((provider) => provider.provider === confluenceProviderId),
  );
  const tokenConfigured = $derived(
    confluenceProvider?.configured && confluenceProvider.credentialType === "api_key",
  );
  const hasRequiredConfig = $derived(
    Boolean(confluenceSettings.siteUrl && confluenceSettings.email && tokenConfigured),
  );

  function ensureTools() {
    settingsDraft.tools ??= {
      disabled: [],
      jira: { enabled: false },
      confluence: { enabled: false },
    };
  }

  function openDialog() {
    siteUrlDraft = confluenceSettings.siteUrl ?? "";
    emailDraft = confluenceSettings.email ?? "";
    spaceKeyDraft = confluenceSettings.defaultSpaceKey ?? "";
    tokenDraft = "";
    error = undefined;
    message = undefined;
    dialogOpen = true;
  }

  function normalizeSiteUrl(value: string): string | undefined {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    return withScheme.replace(/\/+$/, "").replace(/\/wiki$/i, "");
  }

  async function refreshAuthProviders() {
    settingsState.authProviders = await getAuthProviders();
  }

  function saveConfluenceEnabled(enabled: boolean) {
    if (enabled && !hasRequiredConfig) return;
    ensureTools();
    settingsDraft.tools.confluence = { ...confluenceSettings, enabled };
    onSettingsChange?.({ tools: { confluence: { enabled } } }, { immediate: true });
  }

  async function saveConfig() {
    const siteUrl = normalizeSiteUrl(siteUrlDraft);
    const email = emailDraft.trim() || undefined;
    const defaultSpaceKey = spaceKeyDraft.trim() || undefined;
    const token = tokenDraft.trim();
    busy = true;
    error = undefined;
    message = undefined;
    try {
      if (token) {
        const credentialKey = await getCredentialKey();
        const envelope = await encryptApiKey(token, credentialKey);
        await setProviderApiKey(confluenceProviderId, envelope);
        tokenDraft = "";
      }
      ensureTools();
      settingsDraft.tools.confluence = {
        ...confluenceSettings,
        siteUrl,
        email,
        defaultSpaceKey,
      };
      onSettingsChange?.(
        {
          tools: {
            confluence: {
              siteUrl: siteUrl ?? null,
              email: email ?? null,
              defaultSpaceKey: defaultSpaceKey ?? null,
            },
          },
        },
        { immediate: true },
      );
      message = "Confluence configuration saved.";
      await refreshAuthProviders();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function removeToken() {
    busy = true;
    error = undefined;
    message = undefined;
    try {
      await deleteProviderCredential(confluenceProviderId);
      tokenDraft = "";
      ensureTools();
      settingsDraft.tools.confluence = { ...confluenceSettings, enabled: false };
      onSettingsChange?.({ tools: { confluence: { enabled: false } } }, { immediate: true });
      message = "Confluence API token removed. Confluence tools are disabled.";
      await refreshAuthProviders();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
      removeTokenOpen = false;
    }
  }
</script>

{#snippet confluenceSwitch()}
  <ToggleSwitch
    checked={confluenceSettings.enabled}
    disabled={!hasRequiredConfig}
    aria-label="Enable Confluence tools"
    onCheckedChange={(checked) => saveConfluenceEnabled(checked)}
  />
{/snippet}

<SettingsSectionCard
  section="tools-confluence"
  title="Confluence"
  description="Disabled-by-default Confluence Cloud tools for page discovery, storage-XML edit loops, publishing, and attachments."
>
  {#snippet actions()}{@render confluenceSwitch()}{/snippet}

  <ul class="settings-tool-list" aria-label="Confluence tools">
    {#each confluenceTools as tool}
      <li class="settings-tool-item">
        <Wrench size={13} strokeWidth={2} aria-hidden="true" />
        <span><code>{tool.name}</code>{tool.description}</span>
      </li>
    {/each}
  </ul>

  <div class="settings-credential-summary">
    <div class="settings-copy">
      <strong>Connection</strong>
      <span>
        {#if confluenceSettings.siteUrl && confluenceSettings.email}
          {confluenceSettings.siteUrl} · {confluenceSettings.email}{confluenceSettings.defaultSpaceKey ? ` · ${confluenceSettings.defaultSpaceKey}` : ""}
        {:else}
          Site URL and Atlassian account email are required.
        {/if}
      </span>
    </div>
    <Button size="sm" variant="outline" onclick={openDialog}>Configure</Button>
  </div>

  <div class="settings-credential-summary">
    <div class="settings-copy">
      <strong>API token</strong>
      <span>{tokenConfigured ? "•••••••• configured" : "Required before Confluence tools can be enabled."}</span>
    </div>
    {#if tokenConfigured}
      <Button size="sm" variant="outline" onclick={() => (removeTokenOpen = true)}>Remove token</Button>
    {:else}
      <Button size="sm" variant="outline" onclick={openDialog}>Add token</Button>
    {/if}
  </div>

  {#if !hasRequiredConfig}
    <p class="settings-inline-message" data-tone="warning">
      <TriangleAlert size={14} strokeWidth={2} />
      Configure site URL, email, and API token before enabling Confluence tools.
    </p>
  {/if}
  {#if error}
    <p class="settings-inline-message" data-tone="error">
      <TriangleAlert size={14} strokeWidth={2} />
      {error}
    </p>
  {:else if message}
    <p class="settings-inline-message" data-tone="success">
      <CircleCheck size={14} strokeWidth={2} />
      {message}
    </p>
  {/if}
</SettingsSectionCard>

<Dialog.Root bind:open={dialogOpen}>
  <Dialog.Content class="settings-runtime-dialog">
    <Dialog.Header>
      <Dialog.Title>Configure Confluence</Dialog.Title>
      <Dialog.Description>
        Store Confluence Cloud connection details. The API token is encrypted before it is sent to the daemon.
      </Dialog.Description>
    </Dialog.Header>

    <form
      class="settings-dialog-body"
      onsubmit={(event) => {
        event.preventDefault();
        void saveConfig();
      }}
    >
      <label class="settings-key-label" for="tools-confluence-site-url">
        <span>Confluence site URL</span>
        <Input id="tools-confluence-site-url" bind:value={siteUrlDraft} placeholder="https://example.atlassian.net" disabled={busy} />
      </label>
      <label class="settings-key-label" for="tools-confluence-email">
        <span>Atlassian account email</span>
        <Input id="tools-confluence-email" type="email" bind:value={emailDraft} placeholder="name@example.com" disabled={busy} />
      </label>
      <label class="settings-key-label" for="tools-confluence-token">
        <span><KeyRound size={13} strokeWidth={2} /> Confluence API token</span>
        <Input
          id="tools-confluence-token"
          type="password"
          autocomplete="off"
          bind:value={tokenDraft}
          placeholder={tokenConfigured ? "Paste a replacement token" : "Paste your Confluence API token"}
          disabled={busy}
        />
      </label>
      <label class="settings-key-label" for="tools-confluence-space-key">
        <span>Default space key</span>
        <Input id="tools-confluence-space-key" bind:value={spaceKeyDraft} placeholder="Optional, e.g. DEV" disabled={busy} />
      </label>

      {#if tokenConfigured}
        <p class="settings-dialog-note">Current token: <code>•••••••• configured</code></p>
      {/if}

      {#if error}
        <p class="settings-inline-message" data-tone="error">
          <TriangleAlert size={14} strokeWidth={2} />
          {error}
        </p>
      {:else if message}
        <p class="settings-inline-message" data-tone="success">
          <CircleCheck size={14} strokeWidth={2} />
          {message}
        </p>
      {/if}

      <Dialog.Footer>
        <Button type="button" variant="ghost" onclick={() => (dialogOpen = false)}>Close</Button>
        {#if tokenConfigured}
          <Button type="button" variant="outline" disabled={busy} onclick={() => (removeTokenOpen = true)}>Remove token</Button>
        {/if}
        <Button type="submit" disabled={busy}>
          {#if busy}
            <Loader size={14} strokeWidth={2} class="animate-spin" />
          {/if}
          Save
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<ConfirmDialog
  open={removeTokenOpen}
  title="Remove Confluence API token?"
  description="This removes the stored Confluence API token and disables the Confluence tools module."
  confirmLabel="Remove"
  destructive
  onConfirm={() => void removeToken()}
  onOpenChange={(open) => {
    removeTokenOpen = open;
  }}
/>
