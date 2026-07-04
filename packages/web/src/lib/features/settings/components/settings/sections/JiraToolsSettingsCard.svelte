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
  import { Button } from "@nervekit/ui/components/ui/button";
  import ConfirmDialog from "@nervekit/ui/components/ui/confirm-dialog";
  import * as Dialog from "@nervekit/ui/components/ui/dialog";
  import { Input } from "@nervekit/ui/components/ui/input";
  import { Switch as ToggleSwitch } from "@nervekit/ui/components/ui/switch";
  import { encryptApiKey } from "$lib/core/utils/credential-crypto";
  import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
  import SettingsSectionCard from "../SettingsSectionCard.svelte";

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

  const jiraProviderId = "jira";
  const jiraTools: ToolSummary[] = [
    { name: "jira_search_users", description: "Find users and accountIds for assignments." },
    { name: "jira_search_issues", description: "Search issues with JQL and saved raw JSON." },
    { name: "jira_get_issue", description: "Fetch issues with comments, transitions, worklogs, changelog, links, and metadata." },
    { name: "jira_get_project", description: "Fetch project, issue type, create-field, priority, resolution, and field metadata." },
    { name: "jira_create_issue", description: "Create tasks, stories, bugs, epics, or subtasks." },
    { name: "jira_update_issue", description: "Update common issue fields and raw Jira fields." },
    { name: "jira_add_comment", description: "Add comments from plain text or ADF." },
    { name: "jira_transition_issue", description: "Discover or execute workflow transitions." },
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
  let projectKeyDraft = $state("");

  const jiraSettings = $derived(settingsDraft.tools?.jira ?? { enabled: false });
  const jiraProvider = $derived(
    authProviders.find((provider) => provider.provider === jiraProviderId),
  );
  const tokenConfigured = $derived(
    jiraProvider?.configured && jiraProvider.credentialType === "api_key",
  );
  const hasRequiredConfig = $derived(
    Boolean(jiraSettings.siteUrl && jiraSettings.email && tokenConfigured),
  );

  function openDialog() {
    siteUrlDraft = jiraSettings.siteUrl ?? "";
    emailDraft = jiraSettings.email ?? "";
    projectKeyDraft = jiraSettings.defaultProjectKey ?? "";
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
    return withScheme.replace(/\/+$/, "");
  }

  async function refreshAuthProviders() {
    settingsState.authProviders = await getAuthProviders();
  }

  function saveJiraEnabled(enabled: boolean) {
    if (enabled && !hasRequiredConfig) return;
    settingsDraft.tools ??= {
      disabled: [],
      jira: { enabled: false },
      confluence: { enabled: false },
    };
    settingsDraft.tools.jira = { ...jiraSettings, enabled };
    onSettingsChange?.({ tools: { jira: { enabled } } }, { immediate: true });
  }

  async function saveConfig() {
    const siteUrl = normalizeSiteUrl(siteUrlDraft);
    const email = emailDraft.trim() || undefined;
    const defaultProjectKey = projectKeyDraft.trim() || undefined;
    const token = tokenDraft.trim();
    busy = true;
    error = undefined;
    message = undefined;
    try {
      if (token) {
        const credentialKey = await getCredentialKey();
        const envelope = await encryptApiKey(token, credentialKey);
        await setProviderApiKey(jiraProviderId, envelope);
        tokenDraft = "";
      }
      settingsDraft.tools ??= {
        disabled: [],
        jira: { enabled: false },
        confluence: { enabled: false },
      };
      settingsDraft.tools.jira = {
        ...jiraSettings,
        siteUrl,
        email,
        defaultProjectKey,
      };
      onSettingsChange?.(
        {
          tools: {
            jira: {
              siteUrl: siteUrl ?? null,
              email: email ?? null,
              defaultProjectKey: defaultProjectKey ?? null,
            },
          },
        },
        { immediate: true },
      );
      message = "Jira configuration saved.";
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
      await deleteProviderCredential(jiraProviderId);
      tokenDraft = "";
      settingsDraft.tools ??= {
        disabled: [],
        jira: { enabled: false },
        confluence: { enabled: false },
      };
      settingsDraft.tools.jira = { ...jiraSettings, enabled: false };
      onSettingsChange?.({ tools: { jira: { enabled: false } } }, { immediate: true });
      message = "Jira API token removed. Jira tools are disabled.";
      await refreshAuthProviders();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
      removeTokenOpen = false;
    }
  }
</script>

{#snippet jiraSwitch()}
  <ToggleSwitch
    checked={jiraSettings.enabled}
    disabled={!hasRequiredConfig}
    aria-label="Enable Jira tools"
    onCheckedChange={(checked) => saveJiraEnabled(checked)}
  />
{/snippet}

<SettingsSectionCard
  section="tools-jira"
  title="Jira"
  description="Disabled-by-default Jira Cloud tools for ticket search, creation, updates, comments, and workflow transitions."
>
  {#snippet actions()}{@render jiraSwitch()}{/snippet}

  <ul class="settings-tool-list" aria-label="Jira tools">
    {#each jiraTools as tool}
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
        {#if jiraSettings.siteUrl && jiraSettings.email}
          {jiraSettings.siteUrl} · {jiraSettings.email}{jiraSettings.defaultProjectKey ? ` · ${jiraSettings.defaultProjectKey}` : ""}
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
      <span>{tokenConfigured ? "•••••••• configured" : "Required before Jira tools can be enabled."}</span>
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
      Configure site URL, email, and API token before enabling Jira tools.
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
      <Dialog.Title>Configure Jira</Dialog.Title>
      <Dialog.Description>
        Store Jira Cloud connection details. The API token is encrypted before it is sent to the daemon.
      </Dialog.Description>
    </Dialog.Header>

    <form
      class="settings-dialog-body"
      onsubmit={(event) => {
        event.preventDefault();
        void saveConfig();
      }}
    >
      <label class="settings-key-label" for="tools-jira-site-url">
        <span>Jira site URL</span>
        <Input id="tools-jira-site-url" bind:value={siteUrlDraft} placeholder="https://example.atlassian.net" disabled={busy} />
      </label>
      <label class="settings-key-label" for="tools-jira-email">
        <span>Atlassian account email</span>
        <Input id="tools-jira-email" type="email" bind:value={emailDraft} placeholder="name@example.com" disabled={busy} />
      </label>
      <label class="settings-key-label" for="tools-jira-token">
        <span><KeyRound size={13} strokeWidth={2} /> Jira API token</span>
        <Input
          id="tools-jira-token"
          type="password"
          autocomplete="off"
          bind:value={tokenDraft}
          placeholder={tokenConfigured ? "Paste a replacement token" : "Paste your Jira API token"}
          disabled={busy}
        />
      </label>
      <label class="settings-key-label" for="tools-jira-project-key">
        <span>Default project key</span>
        <Input id="tools-jira-project-key" bind:value={projectKeyDraft} placeholder="Optional, e.g. PROJ" disabled={busy} />
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
  title="Remove Jira API token?"
  description="This removes the stored Jira API token and disables the Jira tools module."
  confirmLabel="Remove"
  destructive
  onConfirm={() => void removeToken()}
  onOpenChange={(open) => {
    removeTokenOpen = open;
  }}
/>
