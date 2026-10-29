<script lang="ts">
import { toolSettingsMutation } from "./tool-settings-mutation";
import { clampThinkingLevelForModel } from "$lib/presentation/state/thinking-levels";
import ProjectCapabilityTrustAction from "../capabilities/ProjectCapabilityTrustAction.svelte";
import ProjectCapabilityTrustNotice from "../capabilities/ProjectCapabilityTrustNotice.svelte";
import Settings2 from "@lucide/svelte/icons/settings-2";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { leadSettingsOverridesSchema } from "@nervekit/contracts/agent-configuration";
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
import { ScopedAgentState } from "$lib/application/agent-configuration/scoped-agent-state.svelte";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import {
  SettingsChangeIndicator,
  SettingsDiffBanner,
  SettingsInlineMessage,
  SettingsRow,
  SettingsSection,
} from "$lib/presentation/settings";
import ConfigurationSource from "$lib/presentation/settings/ConfigurationSource.svelte";
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
import ToolConfigDialog from "./ToolConfigDialog.svelte";
import {
  accountKind,
  toolRows,
  toolSummary,
  type AccountOption,
  type ToolId,
  type ToolPayload,
  type ToolRowDef,
} from "./tool-settings";
let {
  scope,
  projectId,
  settingsDraft,
  status,
  models = [],
  authProviders = [],
}: {
  scope: "user" | "project";
  projectId?: string;
  settingsDraft: Settings;
  status?: StatusResponse;
  models?: ModelInfo[];
  authProviders?: AuthProviderMetadata[];
} = $props();
const project = $derived(scope === "project");
const editor = new ScopedAgentState((model, level) => {
  const known = models.find((m) => modelKey(m) === modelKey(model));
  return known ? clampThinkingLevelForModel(level, known) : level;
});
$effect(() => {
  if (!workbenchStartupState.progressiveActive || (project && !projectId))
    return;
  void models;
  void editor.load(
    project ? { scope: "project", projectId: projectId! } : { scope: "user" },
  );
  ensureProfilesFor(scope, projectId);
});
$effect(() => editor.observe());
const error = $derived(editor.error);
const loading = $derived(!editor.resolution && !error);
const locked = $derived(editor.saving || !editor.resolution);
const usableModels = $derived(
  authenticatedRealModelOptions(models, authProviders),
);
function payload(id: ToolId): ToolPayload {
  return editor.resolution?.settings.tools?.[id] ?? {};
}
function inheritedPayload(id: ToolId): ToolPayload {
  return editor.inherited?.settings.tools?.[id] ?? {};
}
function changed(id: ToolId) {
  return editor.overrides.tools?.[id] !== undefined;
}
function accounts(id: ToolId): AccountOption[] {
  const kind = accountKind(id);
  return !kind
    ? []
    : kind === "tavily"
      ? settingsDraft.providers.tavilyProfiles
      : settingsDraft.providers.atlassianProfiles.map((p) => ({
          id: p.id,
          name: p.name,
          detail: p.siteUrl,
        }));
}
function accountName(id: ToolId, accountId: string | undefined) {
  return accounts(id).find((a) => a.id === accountId)?.name;
}
function modelLabel(selection: unknown) {
  const v = selection as { provider: string; modelId: string } | undefined;
  if (!v) return undefined;
  const m = models.find((m) => modelKey(m) === modelKey(v));
  return m ? modelDisplayName(m) : v.modelId;
}
function summary(id: ToolId, value: ToolPayload) {
  return toolSummary(id, value, {
    accountName: (_kind, accountId) => accountName(id, accountId),
    profileLabel: profileLabelFor,
    modelLabel,
  });
}
function problem(id: ToolId, value: ToolPayload): string | undefined {
  if (accountKind(id) && !accountName(id, value.profileId))
    return "Choose an account";
  return undefined;
}
function save(id: ToolId, next: ToolPayload) {
  try {
    const mutation = toolSettingsMutation(id, next, editor.overrides);
    void editor.save(mutation.changes, mutation.resets);
  } catch {
    editor.error = "Invalid tool settings. Review the fields and try again.";
  }
}
function toggle(id: ToolId, enabled: boolean) {
  void editor.save(
    leadSettingsOverridesSchema.parse({ tools: { [id]: { enabled } } }),
  );
}
function reset(id: ToolId) {
  void editor.save({}, [`/overrides/tools/${id}`]);
}
function resetAll() {
  void editor.save({}, ["/overrides/tools"]);
}
function onRetry() {
  return editor.reload();
}
let dialogOpen = $state(false);
let dialogTool = $state<ToolRowDef>(toolRows[0]);
function configure(row: ToolRowDef) {
  dialogTool = row;
  dialogOpen = true;
}
const dialogValue = $derived(payload(dialogTool.id));
const python = $derived(status?.runtime.python);
</script>

{#if scope === "project"}<ProjectCapabilityTrustNotice
    document={editor.document}
    scope={editor.scope}
    onReload={onRetry}
  />{/if}
{#if error}
  <SettingsInlineMessage tone="destructive" text={error}>
    {#snippet actions()}<Button size="sm" variant="outline" onclick={onRetry}
        >Reload</Button
      >{/snippet}
  </SettingsInlineMessage>
{/if}
{#if loading}<Skeleton class="h-10 w-full" />
{:else if editor.resolution}
  <SettingsDiffBanner
    count={Object.keys(editor.overrides.tools ?? {}).length}
    onResetAll={resetAll}
  />
  <SettingsSection
    id="tools"
    description="Read, edit, ask_user, process and todo tools are always on. Permissions govern them."
    divided
  >
    {#snippet actions()}{#if project}<ProjectCapabilityTrustAction
          document={editor.document}
          scope={editor.scope}
          onReload={onRetry}
        />{/if}{/snippet}
    {#each toolRows as row (row.id)}
      {@const value = payload(row.id)}
      {@const issue =
        !row.always && value.enabled ? problem(row.id, value) : undefined}
      {@const unavailable = false}
      <SettingsRow label={row.label} description={summary(row.id, value)}>
        {#snippet badges()}
          <ConfigurationSource
            provenance={editor.resolution?.provenance[
              `/tools/${row.id}/enabled`
            ] ??
              editor.resolution?.provenance[`/tools/${row.id}/settings`] ??
              Object.entries(editor.resolution?.provenance ?? {}).find(
                ([pointer]) => pointer.startsWith(`/tools/${row.id}/settings/`),
              )?.[1]}
          />
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
