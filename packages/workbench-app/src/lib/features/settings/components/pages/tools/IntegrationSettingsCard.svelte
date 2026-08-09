<script lang="ts">
import type { AuthProviderMetadata, Settings } from "$lib/api";
import {
  deleteProviderCredential,
  getAuthProviders,
  getCredentialKey,
  setProviderApiKey,
} from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import { encryptApiKey } from "$lib/core/utils/credential-crypto";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import {
  SettingsInlineMessage,
  SettingsListItem,
} from "$lib/presentation/components/settings";
import { StatusDot } from "@nervekit/ui-kit/components/ui/status-dot";
import type { SettingsChange } from "../settings-change";
import {
  canEnableIntegration,
  integrationConfigurationStatus,
  integrationFieldErrors,
  type IntegrationDraft,
  type IntegrationFieldKey,
  type IntegrationProviderDef,
} from "./integration-providers";
import { ensureToolsDraft } from "./tools-draft";

type Props = {
  provider: IntegrationProviderDef;
  settingsDraft: Settings;
  authProviders?: AuthProviderMetadata[];
  onSettingsChange?: SettingsChange;
};

let {
  provider,
  settingsDraft,
  authProviders = [],
  onSettingsChange,
}: Props = $props();

let dialogOpen = $state(false);
let removeTokenOpen = $state(false);
let busy = $state(false);
let error = $state<string | undefined>(undefined);
let message = $state<string | undefined>(undefined);
let draft = $state<IntegrationDraft>({
  siteUrl: "",
  email: "",
  token: "",
  extra: "",
});

const integrationSettings = $derived(
  settingsDraft.tools?.[provider.settingsKey] ?? { enabled: false },
);
const authProvider = $derived(
  authProviders.find((entry) => entry.provider === provider.providerId),
);
const tokenConfigured = $derived(
  Boolean(
    authProvider?.configured && authProvider.credentialType === "api_key",
  ),
);
const status = $derived(
  integrationConfigurationStatus({
    siteUrl: integrationSettings.siteUrl,
    email: integrationSettings.email,
    tokenConfigured,
  }),
);
const canEnable = $derived(
  canEnableIntegration({
    siteUrl: integrationSettings.siteUrl,
    email: integrationSettings.email,
    tokenConfigured,
  }),
);
const fieldErrors = $derived(
  integrationFieldErrors(provider, draft, { tokenConfigured }),
);
const extraValue = $derived(
  (integrationSettings as Record<string, unknown>)[
    provider.extraSettingsKey
  ] as string | undefined,
);
const connectionSummary = $derived.by(() => {
  if (!integrationSettings.siteUrl && !integrationSettings.email) {
    return "Not configured";
  }
  const parts = [integrationSettings.siteUrl, integrationSettings.email].filter(
    (value): value is string => Boolean(value),
  );
  if (extraValue) parts.push(extraValue);
  return parts.join(" · ");
});

function openDialog(): void {
  draft = {
    siteUrl: integrationSettings.siteUrl ?? "",
    email: integrationSettings.email ?? "",
    token: "",
    extra: extraValue ?? "",
  };
  error = undefined;
  message = undefined;
  dialogOpen = true;
}

async function refreshAuthProviders(): Promise<void> {
  settingsState.authProviders = await getAuthProviders();
}

function saveEnabled(enabled: boolean): void {
  if (enabled && !canEnable) return;
  const tools = ensureToolsDraft(settingsDraft);
  tools[provider.settingsKey] = { ...integrationSettings, enabled };
  onSettingsChange?.(
    { tools: { [provider.settingsKey]: { enabled } } },
    { immediate: true },
  );
}

async function saveConfig(): Promise<void> {
  const siteUrl = provider.normalizeSiteUrl(draft.siteUrl);
  const email = draft.email.trim() || undefined;
  const extra = draft.extra.trim() || undefined;
  const token = draft.token.trim();
  busy = true;
  error = undefined;
  message = undefined;
  try {
    if (token) {
      const credentialKey = await getCredentialKey();
      const envelope = await encryptApiKey(token, credentialKey);
      await setProviderApiKey(provider.providerId, envelope);
      draft = { ...draft, token: "" };
    }
    const tools = ensureToolsDraft(settingsDraft);
    tools[provider.settingsKey] = {
      ...integrationSettings,
      siteUrl,
      email,
      [provider.extraSettingsKey]: extra,
    };
    onSettingsChange?.(
      {
        tools: {
          [provider.settingsKey]: {
            siteUrl: siteUrl ?? null,
            email: email ?? null,
            [provider.extraSettingsKey]: extra ?? null,
          },
        },
      },
      { immediate: true },
    );
    message = `${provider.label} configuration saved.`;
    await refreshAuthProviders();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    busy = false;
  }
}

async function removeToken(): Promise<void> {
  busy = true;
  error = undefined;
  message = undefined;
  try {
    await deleteProviderCredential(provider.providerId);
    const tools = ensureToolsDraft(settingsDraft);
    tools[provider.settingsKey] = {
      ...integrationSettings,
      enabled: false,
    };
    onSettingsChange?.(
      { tools: { [provider.settingsKey]: { enabled: false } } },
      { immediate: true },
    );
    draft = { ...draft, token: "" };
    message = `${provider.label} API token removed. ${provider.label} tools are disabled.`;
    await refreshAuthProviders();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    busy = false;
    removeTokenOpen = false;
  }
}

function fieldValue(key: IntegrationFieldKey): string {
  return draft[key];
}

function setFieldValue(key: IntegrationFieldKey, value: string): void {
  draft = { ...draft, [key]: value };
}
</script>

<SettingsListItem
  title={provider.label}
  description={status === "connected"
    ? connectionSummary
    : `${provider.description}`}
>
  {#snippet leading()}
    <StatusDot
      tone={status === "connected"
        ? "good"
        : status === "incomplete"
          ? "warn"
          : "neutral"}
      label={status === "connected"
        ? `${provider.label} connected`
        : status === "incomplete"
          ? `${provider.label} incomplete`
          : `${provider.label} not configured`}
    />
  {/snippet}
  {#snippet actions()}
    <Switch
      size="settings"
      checked={integrationSettings.enabled}
      disabled={!canEnable}
      aria-label={`Enable ${provider.label} tools`}
      onCheckedChange={saveEnabled}
    />
    <Button size="xs" variant="outline" onclick={openDialog}>Configure</Button>
  {/snippet}
</SettingsListItem>

<Dialog
  bind:open={dialogOpen}
  title={`Configure ${provider.label}`}
  description={provider.docsHint}
  size="sm"
>
  <form
    class="grid gap-3"
    onsubmit={(event) => {
      event.preventDefault();
      void saveConfig();
    }}
  >
    {#each provider.fields as field (field.key)}
      <div class="grid gap-1.5">
        <Label
          for={`tools-${provider.id}-${field.key}`}
          class="text-xs font-medium text-muted-foreground">{field.label}</Label
        >
        <Input
          id={`tools-${provider.id}-${field.key}`}
          type={field.type}
          autocomplete={field.secret ? "off" : undefined}
          placeholder={field.secret && tokenConfigured
            ? "Paste a replacement token"
            : field.placeholder}
          value={fieldValue(field.key)}
          disabled={busy}
          oninput={(event) =>
            setFieldValue(
              field.key,
              (event.currentTarget as HTMLInputElement).value,
            )}
        />
        {#if fieldErrors[field.key]}
          <p class="text-xs text-destructive">{fieldErrors[field.key]}</p>
        {/if}
      </div>
    {/each}

    {#if tokenConfigured}
      <p class="text-xs text-muted-foreground">
        Current token: <span class="font-mono">•••••••• configured</span>
      </p>
    {/if}

    {#if error}
      <SettingsInlineMessage tone="error" text={error} />
    {:else if message}
      <SettingsInlineMessage tone="success" text={message} />
    {/if}

    {#if !canEnable}
      <SettingsInlineMessage
        tone="warning"
        text={`Configure site URL, email, and API token before enabling ${provider.label} tools.`}
      />
    {/if}
  </form>

  {#snippet footer()}
    <Button
      size="sm"
      type="button"
      variant="ghost"
      onclick={() => (dialogOpen = false)}>Close</Button
    >
    {#if tokenConfigured}
      <Button
        size="sm"
        type="button"
        variant="outline"
        disabled={busy}
        onclick={() => (removeTokenOpen = true)}>Remove token</Button
      >
    {/if}
    <Button size="sm" disabled={busy} onclick={() => void saveConfig()}>
      {#if busy}
        <Spinner class="size-3.5" />
      {/if}
      Save
    </Button>
  {/snippet}
</Dialog>

<ConfirmDialog
  open={removeTokenOpen}
  title={`Remove ${provider.label} API token?`}
  description={`This removes the stored ${provider.label} API token and disables the ${provider.label} tools module.`}
  confirmLabel="Remove"
  destructive
  onConfirm={() => void removeToken()}
  onOpenChange={(next) => {
    removeTokenOpen = next;
  }}
/>
