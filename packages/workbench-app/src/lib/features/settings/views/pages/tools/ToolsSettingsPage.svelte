<script lang="ts">
import { accountsState } from "$lib/application/extensions/accounts-state.svelte";
import { visibleAccounts } from "../accounts/accounts-view";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { toolSettingsMutation } from "./tool-settings-mutation";
import { clampThinkingLevelForModel } from "$lib/presentation/state/thinking-levels";
import ProjectCapabilityTrustNotice from "../capabilities/ProjectCapabilityTrustNotice.svelte";
import ArrowUpRight from "@lucide/svelte/icons/arrow-up-right";
import Blocks from "@lucide/svelte/icons/blocks";
import Bot from "@lucide/svelte/icons/bot";
import Globe from "@lucide/svelte/icons/globe";
import ListChecks from "@lucide/svelte/icons/list-checks";
import SquareTerminal from "@lucide/svelte/icons/square-terminal";
import Wrench from "@lucide/svelte/icons/wrench";
import Code from "@lucide/svelte/icons/code";
import Zap from "@lucide/svelte/icons/zap";
import { leadSettingsOverridesSchema } from "@nervekit/contracts/agent-configuration";
import IconAction from "@nervekit/ui-kit/components/composites/icon-action";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import type { ModelSelection, ThinkingLevel } from "@nervekit/contracts/models";
import { listTools, type ModelInfo, type StatusResponse } from "$lib/api";
import { capabilityToggleToolNameSchema } from "@nervekit/contracts/capabilities";
import type { ExtensionIcon } from "@nervekit/contracts/extensions";
import type { ToolDescriptor } from "@nervekit/contracts/tools";
import {
  extensionToolsOf,
  setExtensionTools,
} from "$lib/presentation/tools/lifecycle/extension-tools";
import ExtensionMark from "../extensions/ExtensionMark.svelte";
import { ScopedAgentState } from "$lib/application/agent-configuration/scoped-agent-state.svelte";
import { ScopedExtensionsState } from "$lib/application/extensions/scoped-extensions-state.svelte";
import {
  openProjectSettingsPane,
  openSettingsPane,
} from "$lib/application/settings";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import {
  LayerSwitches,
  OriginGroup,
  ProjectOverrideMark,
  SETTINGS_SEARCH_MIN,
  SettingsItem,
  type SettingsLayer,
} from "$lib/presentation/settings";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import { projectColumns } from "../../../state/project-columns.svelte";
import { modelKey } from "$lib/presentation/utils/model";
import {
  ensureProfilesFor,
  leadProfileOptions,
  profileLabelFor,
} from "../../shared/profile-options.svelte";
import { applyLayerChange } from "../../shared/layer-change";
import ToolConfigDialog from "./ToolConfigDialog.svelte";
import {
  extensionToolState,
  toolExtensionState,
  toolSettingsLink,
} from "./tool-extension-links";
import {
  accountOptions,
  toolRows,
  toolSettingsSummary,
  type ToolId,
  type ToolPayload,
  type ToolRowDef,
} from "./tool-settings";
let {
  projectId,
  projectName,
  status,
  models = [],
  onReviewTrust,
}: {
  /** The open project; without one the page has a single (User) column. */
  projectId?: string;
  projectName?: string;
  status?: StatusResponse;
  models?: ModelInfo[];
  /** Opens the project's Trust page. */
  onReviewTrust?: () => void;
} = $props();
const layered = $derived(!!projectId && !!projectName);
/** The project's column is shown next to User (header switch); otherwise the page is User-only. */
const columns = $derived(layered && projectColumns.tools);
const clamp = (model: ModelSelection, level: ThinkingLevel) => {
  const known = models.find((m) => modelKey(m) === modelKey(model));
  return known ? clampThinkingLevelForModel(level, known) : level;
};
const userEditor = new ScopedAgentState(clamp);
const projectEditor = new ScopedAgentState(clamp);
$effect(() => {
  if (!workbenchStartupState.progressiveActive) return;
  void models;
  void userEditor.load({ scope: "user" });
  ensureProfilesFor(projectId ? "project" : "user", projectId);
});
$effect(() => {
  if (!workbenchStartupState.progressiveActive || !projectId) return;
  void models;
  void projectEditor.load({ scope: "project", projectId });
});
$effect(() => userEditor.observe());
$effect(() => projectEditor.observe());
// The direct tools of enabled extensions, grouped under their extension below the core tools.
let toolDescriptors = $state<ToolDescriptor[]>([]);
$effect(() => {
  if (!workbenchStartupState.progressiveActive) return;
  void listTools()
    .then((tools) => {
      toolDescriptors = tools;
      setExtensionTools(extensionToolsOf(tools));
    })
    .catch(() => undefined);
});
// Web fetch and Quick script rows, and the extension groups, reflect the extensions they depend on.
const extensions = new ScopedExtensionsState();
$effect(() => {
  if (!workbenchStartupState.progressiveActive) return;
  void extensions.load(
    projectId ? { scope: "project", projectId } : { scope: "user" },
  );
});
$effect(() => extensions.observe());
const accounts = $derived(
  accountOptions(
    visibleAccounts(accountsState.accounts, projectId),
    accountsState.kinds,
  ),
);
function extensionState(id: ToolId) {
  return toolExtensionState(
    id,
    extensions.view?.extensions,
    accounts,
    accountsState.kinds,
  );
}
type ExtensionToolGroup = {
  extensionId: string;
  name: string;
  /** Absent when no loaded extension owns the tools. */
  icon?: ExtensionIcon;
  tools: ToolDescriptor[];
};
const extensionGroups = $derived.by(() => {
  const groups: ExtensionToolGroup[] = [];
  for (const tool of toolDescriptors) {
    if (!tool.extension) continue;
    const owner = extensions.view?.extensions.find(
      (extension) => extension.metadata.id === tool.extension,
    );
    // A disabled extension contributes no tools; it is turned on in Extensions.
    if (!owner?.enabled.value) continue;
    let group = groups.find((entry) => entry.extensionId === tool.extension);
    if (!group) {
      group = {
        extensionId: tool.extension,
        name: owner?.metadata.name ?? tool.extension,
        icon: owner?.metadata.icon,
        tools: [],
      };
      groups.push(group);
    }
    group.tools.push(tool);
  }
  return groups;
});
const total = $derived(
  toolRows.length +
    extensionGroups.reduce((sum, group) => sum + group.tools.length, 0),
);
let query = $state("");
const needle = $derived(
  total >= SETTINGS_SEARCH_MIN ? query.trim().toLowerCase() : "",
);
const matches = (text: string) =>
  !needle || text.toLowerCase().includes(needle);
const shownRows = $derived(
  toolRows.filter((row) => matches(`${row.label} ${row.description}`)),
);
const shownGroups = $derived(
  extensionGroups
    .map((group) => ({
      ...group,
      tools: group.tools.filter((tool) =>
        matches(`${toolLabel(tool.name)} ${tool.description}`),
      ),
    }))
    .filter((group) => group.tools.length > 0),
);
const shownTotal = $derived(
  shownRows.length +
    shownGroups.reduce((sum, group) => sum + group.tools.length, 0),
);
/** An extension tool's row label: its name as words (`web_search` → Web search). */
function toolLabel(name: string): string {
  const words = name.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
/** The per-profile switch of an extension tool, when it has one (it is a capability toggle). */
function toolSwitch(name: string): ToolId | undefined {
  return capabilityToggleToolNameSchema.safeParse(name).success
    ? (name as ToolId)
    : undefined;
}
function openExtension(item?: string, section?: string) {
  const options = {
    ...(item ? { item } : {}),
    ...(section ? { section } : {}),
  };
  if (projectId) void openProjectSettingsPane(projectId, "extensions", options);
  else void openSettingsPane("extensions", options);
}
const error = $derived(
  userEditor.error ?? (layered ? projectEditor.error : undefined),
);
const ready = $derived(
  !!userEditor.resolution && (!layered || !!projectEditor.resolution),
);
const loading = $derived(!ready && !error);
/** The project's settings file is not trusted: its column is locked. */
const locked = $derived(
  layered &&
    projectEditor.document?.status === "available" &&
    projectEditor.document.trusted === false,
);

const editors = { user: userEditor, project: projectEditor } as const;
function payload(layer: SettingsLayer, id: ToolId): ToolPayload {
  return editors[layer].resolution?.settings.tools?.[id] ?? {};
}
const displayContext = $derived({ profileLabel: profileLabelFor });
/** The row's status line: settings only, or what the tool does. */
function rowSummary(row: ToolRowDef) {
  return (
    toolSettingsSummary(
      row.id,
      payload(columns && !locked ? "project" : "user", row.id),
      displayContext,
    ) ?? row.description
  );
}
const enabledOf = (
  tools: Record<string, unknown> | undefined,
  id: ToolId,
): boolean | undefined => (tools?.[id] as ToolPayload | undefined)?.enabled;
/** The switch state of a tool at both layers, with the stored choices. */
function layersOf(id: ToolId) {
  const user = payload("user", id).enabled === true;
  const storedProject = layered
    ? enabledOf(projectEditor.overrides.tools, id)
    : undefined;
  return {
    user,
    project:
      layered && !locked ? payload("project", id).enabled === true : user,
    projectSet: storedProject !== undefined && !locked,
    value: {
      builtinDefault:
        enabledOf(userEditor.inherited?.settings.tools, id) === true,
      user: enabledOf(userEditor.overrides.tools, id),
      project: storedProject,
    },
  };
}
async function writeEnabled(
  layer: SettingsLayer,
  id: ToolId,
  choice: boolean | undefined,
) {
  if (choice === undefined)
    await editors[layer].save({}, [`/overrides/tools/${id}/enabled`]);
  else
    await editors[layer].save(
      leadSettingsOverridesSchema.parse({
        tools: { [id]: { enabled: choice } },
      }),
    );
}
function toggle(id: ToolId, layer: SettingsLayer, next: boolean) {
  void applyLayerChange({
    value: layersOf(id).value,
    layer,
    next,
    writeUser: (choice) => writeEnabled("user", id, choice),
    writeProject: (choice) => writeEnabled("project", id, choice),
  });
}
function onRetry() {
  return Promise.all([
    userEditor.reload(),
    layered ? projectEditor.reload() : undefined,
  ]);
}

const toolIcons: Partial<Record<ToolId, typeof Wrench>> = {
  bash: SquareTerminal,
  python_exec: Code,
  web_fetch: Globe,
  quick_script: Zap,
  plan_present: ListChecks,
  subagents: Bot,
};

// Configure edits one layer's settings; with a project open the dialog asks which.
let dialogOpen = $state(false);
let dialogTool = $state<ToolRowDef>(toolRows[0]);
let dialogLayer = $state<SettingsLayer>("user");
function configure(row: ToolRowDef) {
  if (userEditor.saving || !userEditor.resolution) return;
  dialogTool = row;
  dialogLayer = "user";
  dialogOpen = true;
}
const dialogValue = $derived(payload(dialogLayer, dialogTool.id));
function save(next: ToolPayload) {
  const editor = editors[dialogLayer];
  try {
    const mutation = toolSettingsMutation(
      dialogTool.id,
      next,
      editor.overrides,
    );
    void editor.save(mutation.changes, mutation.resets);
  } catch {
    editor.error = "Invalid tool settings. Review the fields and try again.";
  }
}
const python = $derived(status?.runtime.python);
</script>

{#if layered}<ProjectCapabilityTrustNotice
    document={projectEditor.document}
    scope={projectEditor.scope}
    onReload={() => projectEditor.reload()}
    {projectName}
    onReview={onReviewTrust}
  />{/if}
{#if error}
  <Callout layout="block" tone="destructive" text={error}>
    {#snippet actions()}<Button size="sm" variant="outline" onclick={onRetry}
        >Reload</Button
      >{/snippet}
  </Callout>
{/if}

{#snippet overrideMark(id: ToolId)}
  {#if layered && !columns && projectName && enabledOf(projectEditor.overrides.tools, id) !== undefined}
    <ProjectOverrideMark {projectName} />
  {/if}
{/snippet}

{#snippet switches(id: ToolId, name: string, pending: boolean)}
  {@const l = layersOf(id)}
  <LayerSwitches
    {name}
    user={l.user}
    project={l.project}
    projectSet={l.projectSet}
    projectName={columns ? projectName : undefined}
    {pending}
    {locked}
    onChange={(layer, next) => toggle(id, layer, next)}
  />
{/snippet}

{#if loading}<Skeleton class="h-10 w-full" />
{:else if ready}
  {#if total >= SETTINGS_SEARCH_MIN}
    <SearchInput
      bind:value={query}
      placeholder="Search tools"
      ariaLabel="Search tools"
      class="max-w-xs"
    >
      {#snippet trailing()}
        {#if needle}<span class="flex-none text-ui text-muted-foreground"
            >{shownTotal} of {total}</span
          >{/if}
      {/snippet}
    </SearchInput>
  {/if}

  <OriginGroup
    origin={{ kind: "builtin" }}
    count={shownRows.length}
    projectName={columns ? projectName : undefined}
    {locked}
    note="Read, edit, ask_user and process tools are always on. Permissions govern them."
  >
    {#each shownRows as row (row.id)}
      {@const fromExtension = extensionState(row.id)}
      {@const link = toolSettingsLink(row.id)}
      <SettingsItem
        title={row.label}
        icon={toolIcons[row.id] ?? Wrench}
        summary={fromExtension?.summary ?? rowSummary(row)}
        problem={fromExtension?.problem}
        problemAction={fromExtension?.fix
          ? {
              label: fromExtension.fix.label,
              onclick: () =>
                openExtension(
                  fromExtension.fix?.extensionId,
                  fromExtension.fix?.section,
                ),
            }
          : undefined}
        onOpen={row.configurable
          ? () => configure(row)
          : link?.item
            ? () => openExtension(link.item)
            : undefined}
        openLabel={row.configurable
          ? `Configure ${row.label}`
          : `Open ${row.label} extension settings`}
      >
        {#snippet badges()}{#if !row.always}{@render overrideMark(
              row.id,
            )}{/if}{/snippet}
        {#snippet meta()}
          {#if row.always}
            <span
              class={[
                columns ? "w-48" : "w-24",
                "text-center text-caption text-muted-foreground",
              ]}>Always on</span
            >
          {:else}
            {@render switches(
              row.id,
              row.label,
              fromExtension?.disabled === true,
            )}
          {/if}
        {/snippet}
      </SettingsItem>
    {/each}
  </OriginGroup>

  {#each shownGroups as group (group.extensionId)}
    <OriginGroup
      origin={{ kind: "extension", name: group.name }}
      count={group.tools.length}
      projectName={columns ? projectName : undefined}
      {locked}
      note={`Tools from the ${group.name} extension.`}
    >
      {#snippet actions()}
        <IconAction
          icon={ArrowUpRight}
          label={`Open ${group.name} extension settings`}
          onclick={() => openExtension(group.extensionId)}
        />
      {/snippet}
      {#each group.tools as tool (tool.name)}
        {@const switchId = toolSwitch(tool.name)}
        {@const fromExtension = extensionToolState(
          tool.name,
          group.extensionId,
          extensions.view?.extensions,
          accounts,
          accountsState.kinds,
        )}
        {#snippet mark()}
          {#if group.icon}<ExtensionMark icon={group.icon} />{/if}
        {/snippet}
        <SettingsItem
          title={toolLabel(tool.name)}
          icon={group.icon ? undefined : Blocks}
          leading={group.icon ? mark : undefined}
          summary={fromExtension?.summary ?? tool.description}
          problem={fromExtension?.problem}
          problemAction={fromExtension?.fix
            ? {
                label: fromExtension.fix.label,
                onclick: () =>
                  openExtension(
                    fromExtension.fix?.extensionId,
                    fromExtension.fix?.section,
                  ),
              }
            : undefined}
          onOpen={() => openExtension(group.extensionId)}
          openLabel={`Open ${group.name} extension settings`}
        >
          {#snippet badges()}{#if switchId}{@render overrideMark(
                switchId,
              )}{/if}{/snippet}
          {#snippet meta()}
            {#if switchId}
              {@render switches(
                switchId,
                toolLabel(tool.name),
                fromExtension?.disabled === true,
              )}
            {:else}
              <span
                class={[
                  columns ? "w-48" : "w-24",
                  "text-center text-caption text-muted-foreground",
                ]}>Always on</span
              >
            {/if}
          {/snippet}
        </SettingsItem>
      {/each}
    </OriginGroup>
  {/each}

  <ToolConfigDialog
    bind:open={dialogOpen}
    source={dialogLayer}
    name={dialogTool.id}
    value={dialogValue}
    description={layered
      ? undefined
      : "Applies to every project unless it changes this."}
    leadProfiles={leadProfileOptions()}
    resolvedPython={python?.executable}
    onSave={save}
  >
    {#snippet header()}
      {#if layered}
        <div class="flex items-center gap-2 text-ui text-muted-foreground">
          Applies to
          <ToggleGroup.Root
            type="single"
            size="sm"
            value={dialogLayer}
            onValueChange={(next) => {
              if (next === "user" || next === "project") dialogLayer = next;
            }}
          >
            <ToggleGroup.Item value="user">User</ToggleGroup.Item>
            <ToggleGroup.Item value="project" disabled={locked}
              >{projectName}</ToggleGroup.Item
            >
          </ToggleGroup.Root>
        </div>
      {/if}
    {/snippet}
  </ToolConfigDialog>
{/if}
