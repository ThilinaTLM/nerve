<!--
  Tools at user and project level. One row per optional tool with on/off and a
  Configure dialog; bash is always on but configurable. Project rows show a dot
  and ↺ where the project differs from the user's setting.
-->
<script lang="ts">
import Settings2 from "@lucide/svelte/icons/settings-2";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type {
  CapabilityConfiguration,
  CapabilityPatch,
} from "@nervekit/contracts/capabilities";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import type {
  AuthProviderMetadata,
  ModelInfo,
  Settings,
  StatusResponse,
} from "$lib/api";
import { openSettingsPane } from "$lib/application/settings";
import {
  SettingsChangeIndicator,
  SettingsDiffBanner,
  SettingsInlineMessage,
  SettingsRow,
  SettingsSection,
} from "$lib/presentation/settings";
import {
  authenticatedRealModelOptions,
  modelDisplayName,
  modelKey,
} from "$lib/presentation/utils/model";
import {
  ensureProfilesFor,
  leadProfileOptions,
  profileLabelFor,
} from "../../shared/profile-options.svelte";
import ProjectCapabilityTrustAction from "../capabilities/ProjectCapabilityTrustAction.svelte";
import ProjectCapabilityTrustNotice from "../capabilities/ProjectCapabilityTrustNotice.svelte";
import type { SettingsChange } from "../settings-change";
import ToolConfigDialog from "./ToolConfigDialog.svelte";
import {
  accountKind,
  applyUserToolDraft,
  projectToolChanged,
  projectToolPatch,
  projectToolPayload,
  projectToolResetPatch,
  toolRows,
  toolSummary,
  userToolPatch,
  userToolPayload,
  type AccountOption,
  type ToolId,
  type ToolPayload,
  type ToolRowDef,
} from "./tool-settings";

type Props = {
  scope: "user" | "project";
  settingsDraft: Settings;
  status?: StatusResponse;
  models?: ModelInfo[];
  authProviders?: AuthProviderMetadata[];
  onSettingsChange?: SettingsChange;
  /** Project scope: the capability layers. */
  configuration?: CapabilityConfiguration;
  projectId?: string;
  loading?: boolean;
  error?: string;
  onPatch?: (patch: CapabilityPatch) => void;
  onTrust?: (trusted: boolean) => void;
  onRetry?: () => void;
};

let {
  scope,
  settingsDraft,
  status,
  models = [],
  authProviders = [],
  onSettingsChange,
  configuration,
  projectId,
  loading = false,
  error,
  onPatch,
  onTrust,
  onRetry,
}: Props = $props();

const project = $derived(scope === "project");
const locked = $derived(
  configuration?.trust.status === "untrusted" ||
    configuration?.trust.status === "invalid",
);
const usableModels = $derived(
  authenticatedRealModelOptions(models, authProviders),
);

$effect(() => {
  ensureProfilesFor(scope, projectId);
});

function payload(id: ToolId): ToolPayload {
  return project
    ? configuration
      ? projectToolPayload(configuration.effective, id)
      : {}
    : userToolPayload(settingsDraft, id);
}
function inheritedPayload(id: ToolId): ToolPayload {
  return configuration ? projectToolPayload(configuration.inherited, id) : {};
}
function changed(id: ToolId): boolean {
  return project && !!configuration && projectToolChanged(configuration, id);
}

function accounts(id: ToolId): AccountOption[] {
  const kind = accountKind(id);
  if (!kind) return [];
  if (project) {
    const options = configuration?.toolProfileOptions;
    return (
      (id === "web_search"
        ? options?.web_search
        : id === "jira"
          ? options?.jira
          : options?.confluence) ?? []
    );
  }
  return kind === "tavily"
    ? settingsDraft.providers.tavilyProfiles
    : settingsDraft.providers.atlassianProfiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        detail: profile.siteUrl,
      }));
}
function accountName(id: ToolId, accountId: string | undefined) {
  return accounts(id).find((account) => account.id === accountId)?.name;
}
function modelLabel(selection: unknown): string | undefined {
  const value = selection as { provider: string; modelId: string } | undefined;
  if (!value) return undefined;
  const found = models.find((model) => modelKey(model) === modelKey(value));
  return found ? modelDisplayName(found) : value.modelId;
}
function summary(id: ToolId, value: ToolPayload): string {
  return toolSummary(id, value, {
    accountName: (_kind, accountId) => accountName(id, accountId),
    profileLabel: profileLabelFor,
    modelLabel,
  });
}

/** Why an enabled tool can't work yet; also blocks turning it on. */
function problem(id: ToolId, value: ToolPayload): string | undefined {
  if (id === "web_search" || id === "jira" || id === "confluence") {
    if (!accountName(id, value.profileId)) return "Choose an account";
    return undefined;
  }
  if (id === "explain_image") {
    const model = (
      value.settings as { model?: { provider: string; modelId: string } }
    )?.model;
    return model &&
      usableModels.some((candidate) => modelKey(candidate) === modelKey(model))
      ? undefined
      : "Choose a vision model";
  }
  if (id === "generate_image") {
    const connected = authProviders.some(
      (provider) =>
        provider.provider === "openai-codex" &&
        provider.configured &&
        provider.credentialType === "oauth",
    );
    return connected ? undefined : "Connect an OpenAI Codex subscription";
  }
  return undefined;
}

function save(id: ToolId, next: ToolPayload): void {
  if (project) {
    onPatch?.(projectToolPatch(id, next));
    return;
  }
  applyUserToolDraft(settingsDraft, id, next);
  onSettingsChange?.(userToolPatch(settingsDraft, id, next), {
    immediate: true,
  });
}
function toggle(id: ToolId, enabled: boolean): void {
  save(id, { ...payload(id), enabled });
}
function reset(id: ToolId): void {
  onPatch?.(projectToolResetPatch(id));
}
function resetAll(): void {
  const tools = Object.fromEntries(
    Object.keys(configuration?.project.tools ?? {}).map((name) => [name, null]),
  );
  onPatch?.({ tools } as CapabilityPatch);
}

let dialogOpen = $state(false);
let dialogTool = $state<ToolRowDef>(toolRows[0]);
function configure(row: ToolRowDef): void {
  dialogTool = row;
  dialogOpen = true;
}
const dialogValue = $derived(payload(dialogTool.id));
const python = $derived(status?.runtime.python);
</script>

{#if error}
  <SettingsInlineMessage tone="destructive" text={error}>
    {#snippet actions()}
      <Button size="sm" variant="outline" onclick={() => onRetry?.()}
        >Retry</Button
      >
    {/snippet}
  </SettingsInlineMessage>
{/if}

{#if project && !configuration && loading}
  <Skeleton class="h-10 w-full" />
  <Skeleton class="h-10 w-full" />
{:else if !project || configuration}
  {#if project && configuration}
    <ProjectCapabilityTrustNotice trust={configuration.trust} {onTrust} />
    <SettingsDiffBanner
      count={Object.keys(configuration.project.tools).length}
      onResetAll={resetAll}
    />
  {/if}

  <SettingsSection
    id="tools"
    description="Read, edit, ask_user, process and todo tools are always on. Permissions govern them."
    divided
  >
    {#snippet actions()}
      {#if project && configuration}
        <ProjectCapabilityTrustAction trust={configuration.trust} {onTrust} />
      {/if}
    {/snippet}
    {#each toolRows as row (row.id)}
      {@const value = payload(row.id)}
      {@const issue =
        !row.always && value.enabled ? problem(row.id, value) : undefined}
      {@const unavailable =
        project &&
        !row.always &&
        configuration &&
        !configuration.availableTools.includes(row.id)}
      <SettingsRow label={row.label} description={summary(row.id, value)}>
        {#snippet badges()}
          {#if changed(row.id)}
            <SettingsChangeIndicator
              compact
              from={`User: ${summary(row.id, inheritedPayload(row.id))}`}
              to={`This project: ${summary(row.id, value)}`}
              onReset={() => reset(row.id)}
            />
          {/if}
        {/snippet}
        {#snippet hint()}
          {#if issue || unavailable}
            <span class="inline-flex items-center gap-1 text-warning">
              <TriangleAlert class="size-3" aria-hidden="true" />
              {issue ?? "Not set up on this machine"}
            </span>
          {/if}
        {/snippet}
        {#snippet control()}
          {#if row.configurable}
            <Button
              size="sm"
              variant="outline"
              aria-label={`Configure ${row.label}`}
              disabled={locked}
              onclick={() => configure(row)}
            >
              <Settings2 class="size-3.5" aria-hidden="true" />Configure
            </Button>
          {/if}
          {#if row.always}
            <span class="w-9" aria-hidden="true"></span>
          {:else}
            <Switch
              checked={value.enabled === true}
              disabled={locked ||
                (!value.enabled && !!problem(row.id, value)) ||
                (project && !!unavailable)}
              aria-label={`Enable ${row.label}`}
              onCheckedChange={(next) => toggle(row.id, next)}
            />
          {/if}
        {/snippet}
      </SettingsRow>
    {/each}
  </SettingsSection>

  <ToolConfigDialog
    bind:open={dialogOpen}
    name={dialogTool.id}
    value={dialogValue}
    description={project
      ? "Changes apply to this project only."
      : "Applies to every project unless it changes this."}
    models={usableModels}
    accounts={accounts(dialogTool.id)}
    noAccountLabel={project
      ? "Use the account from your settings"
      : "No account"}
    leadProfiles={leadProfileOptions()}
    resolvedPython={python?.executable}
    onManageAccounts={project
      ? undefined
      : () => void openSettingsPane("integrations")}
    onSave={(next) => save(dialogTool.id, next)}
  />
{/if}
