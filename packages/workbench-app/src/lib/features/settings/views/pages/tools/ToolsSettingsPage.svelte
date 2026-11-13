<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { toolSettingsMutation } from "./tool-settings-mutation";
import { clampThinkingLevelForModel } from "$lib/presentation/state/thinking-levels";
import ProjectCapabilityTrustAction from "../capabilities/ProjectCapabilityTrustAction.svelte";
import ProjectCapabilityTrustNotice from "../capabilities/ProjectCapabilityTrustNotice.svelte";
import Bot from "@lucide/svelte/icons/bot";
import Eye from "@lucide/svelte/icons/eye";
import FileText from "@lucide/svelte/icons/file-text";
import Globe from "@lucide/svelte/icons/globe";
import Image from "@lucide/svelte/icons/image";
import ListChecks from "@lucide/svelte/icons/list-checks";
import Network from "@lucide/svelte/icons/network";
import ScrollText from "@lucide/svelte/icons/scroll-text";
import Search from "@lucide/svelte/icons/search";
import SquareKanban from "@lucide/svelte/icons/square-kanban";
import SquareTerminal from "@lucide/svelte/icons/square-terminal";
import Wrench from "@lucide/svelte/icons/wrench";
import Code from "@lucide/svelte/icons/code";
import { leadSettingsOverridesSchema } from "@nervekit/contracts/agent-configuration";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
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
  SettingsItem,
  SettingsList,
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
import ToolConfigDialog from "./ToolConfigDialog.svelte";
import {
  accountKind,
  accountOptions,
  integrationsMissingAccount,
  toolRows,
  toolSettingsSummary,
  toolSummary,
  type AccountKind,
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
const accounts = $derived(accountOptions(settingsDraft.providers));
function hasAccount(kind: AccountKind, accountId: string | undefined) {
  return accounts[kind].some((a) => a.id === accountId);
}
function accountName(id: ToolId, accountId: string | undefined) {
  const kind = accountKind(id);
  return kind
    ? accounts[kind].find((a) => a.id === accountId)?.name
    : undefined;
}
function modelLabel(selection: unknown) {
  const v = selection as { provider: string; modelId: string } | undefined;
  if (!v) return undefined;
  const m = models.find((m) => modelKey(m) === modelKey(v));
  return m ? modelDisplayName(m) : v.modelId;
}
const displayContext = $derived({
  accountName: (kind: AccountKind, accountId: string | undefined) =>
    accounts[kind].find((a) => a.id === accountId)?.name,
  profileLabel: profileLabelFor,
  modelLabel,
});
/** On/off plus settings: what the change indicator compares. */
function summary(id: ToolId, value: ToolPayload) {
  return toolSummary(id, value, displayContext);
}
/** The row's status line: settings only, or what the tool does. */
function rowSummary(row: ToolRowDef, value: ToolPayload) {
  return toolSettingsSummary(row.id, value, displayContext) ?? row.description;
}
function problem(id: ToolId, value: ToolPayload): string | undefined {
  if (accountKind(id) && !accountName(id, value.profileId))
    return "Choose an account";
  // The tool works without integrations; only enabled ones lacking an account are flagged.
  if (id === "quick_script" && value.enabled) {
    const missing = integrationsMissingAccount(value, hasAccount);
    if (missing.length) return `Choose an account for ${missing.join(", ")}`;
  }
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
function onRetry() {
  return editor.reload();
}
let dialogOpen = $state(false);
let dialogTool = $state<ToolRowDef>(toolRows[0]);
const toolIcons: Partial<Record<ToolId, typeof Wrench>> = {
  bash: SquareTerminal,
  python_exec: Code,
  web_search: Search,
  web_fetch: Globe,
  explain_image: Eye,
  generate_image: Image,
  kroki_export: Network,
  jira: SquareKanban,
  confluence: FileText,
  quick_script: ScrollText,
  plan_present: ListChecks,
  subagents: Bot,
};
function configure(row: ToolRowDef) {
  if (locked) return;
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
  <Callout layout="block" tone="destructive" text={error}>
    {#snippet actions()}<Button size="sm" variant="outline" onclick={onRetry}
        >Reload</Button
      >{/snippet}
  </Callout>
{/if}
{#if loading}<Skeleton class="h-10 w-full" />
{:else if editor.resolution}
  <SettingsSection
    id="tools"
    description="Read, edit, ask_user, process and todo tools are always on. Permissions govern them."
  >
    {#snippet actions()}{#if project}<ProjectCapabilityTrustAction
          document={editor.document}
          scope={editor.scope}
          onReload={onRetry}
        />{/if}{/snippet}
    <SettingsList>
      {#each toolRows as row (row.id)}
        {@const value = payload(row.id)}
        {@const issue =
          !row.always && value.enabled ? problem(row.id, value) : undefined}
        <SettingsItem
          title={row.label}
          icon={toolIcons[row.id] ?? Wrench}
          summary={rowSummary(row, value)}
          problem={issue}
          problemAction={issue && row.configurable
            ? {
                label: accountKind(row.id) ? "Choose account" : "Configure",
                onclick: () => configure(row),
              }
            : undefined}
          always={row.always}
          checked={row.always ? undefined : value.enabled === true}
          disabled={locked || (!value.enabled && !!problem(row.id, value))}
          onCheckedChange={(next) => toggle(row.id, next)}
          onOpen={row.configurable ? () => configure(row) : undefined}
          openLabel={`Configure ${row.label}`}
        >
          {#snippet meta()}
            {#if changed(row.id)}
              <SettingsChangeIndicator
                compact
                {scope}
                from={summary(row.id, inheritedPayload(row.id))}
                to={summary(row.id, value)}
                onReset={() => reset(row.id)}
              />
            {/if}
          {/snippet}
        </SettingsItem>
      {/each}
    </SettingsList>
  </SettingsSection>

  <ToolConfigDialog
    bind:open={dialogOpen}
    name={dialogTool.id}
    value={dialogValue}
    description={project
      ? "Changes apply to this project only."
      : "Applies to every project unless it changes this."}
    models={usableModels}
    {accounts}
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
