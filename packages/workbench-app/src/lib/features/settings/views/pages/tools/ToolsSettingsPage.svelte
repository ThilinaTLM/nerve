<script lang="ts">
import { accountsState } from "$lib/application/extensions/accounts-state.svelte";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { toolSettingsMutation } from "./tool-settings-mutation";
import { clampThinkingLevelForModel } from "$lib/presentation/state/thinking-levels";
import ProjectCapabilityTrustAction from "../capabilities/ProjectCapabilityTrustAction.svelte";
import ProjectCapabilityTrustNotice from "../capabilities/ProjectCapabilityTrustNotice.svelte";
import Blocks from "@lucide/svelte/icons/blocks";
import Bot from "@lucide/svelte/icons/bot";
import Globe from "@lucide/svelte/icons/globe";
import ListChecks from "@lucide/svelte/icons/list-checks";
import SquareTerminal from "@lucide/svelte/icons/square-terminal";
import Wrench from "@lucide/svelte/icons/wrench";
import Code from "@lucide/svelte/icons/code";
import Zap from "@lucide/svelte/icons/zap";
import { leadSettingsOverridesSchema } from "@nervekit/contracts/agent-configuration";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { listTools, type ModelInfo, type StatusResponse } from "$lib/api";
import { capabilityToggleToolNameSchema } from "@nervekit/contracts/capabilities";
import type { ExtensionIcon } from "@nervekit/contracts/extensions";
import type { ToolDescriptor } from "@nervekit/contracts/tools";
import {
  extensionToolsOf,
  setExtensionTools,
} from "$lib/presentation/tools/lifecycle/extension-tools";
import ExtensionMark from "../extensions/ExtensionMark.svelte";
import { entryWithEnabled } from "../extensions/extensions-view";
import { ScopedAgentState } from "$lib/application/agent-configuration/scoped-agent-state.svelte";
import { ScopedExtensionsState } from "$lib/application/extensions/scoped-extensions-state.svelte";
import {
  openProjectSettingsPane,
  openSettingsPane,
} from "$lib/application/settings";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import {
  SettingsChangeIndicator,
  SettingsItem,
  SettingsList,
  SettingsSection,
} from "$lib/presentation/settings";
import { modelKey } from "$lib/presentation/utils/model";
import {
  ensureProfilesFor,
  leadProfileOptions,
  profileLabelFor,
} from "../../shared/profile-options.svelte";
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
  toolSummary,
  type ToolId,
  type ToolPayload,
  type ToolRowDef,
} from "./tool-settings";
let {
  scope,
  projectId,
  status,
  models = [],
}: {
  scope: "user" | "project";
  projectId?: string;
  status?: StatusResponse;
  models?: ModelInfo[];
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
// The direct tools extensions contribute, grouped under their extension below the core tools.
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
  if (!workbenchStartupState.progressiveActive || (project && !projectId))
    return;
  void extensions.load(
    project ? { scope: "project", projectId: projectId! } : { scope: "user" },
  );
});
$effect(() => extensions.observe());
const accounts = $derived(
  accountOptions(accountsState.accounts, accountsState.kinds),
);
function extensionState(id: ToolId) {
  return toolExtensionState(id, extensions.view?.extensions, accounts);
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
    let group = groups.find((entry) => entry.extensionId === tool.extension);
    if (!group) {
      const owner = extensions.view?.extensions.find(
        (extension) => extension.metadata.id === tool.extension,
      );
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
const error = $derived(editor.error);
const loading = $derived(!editor.resolution && !error);
const locked = $derived(editor.saving || !editor.resolution);
function payload(id: ToolId): ToolPayload {
  return editor.resolution?.settings.tools?.[id] ?? {};
}
function inheritedPayload(id: ToolId): ToolPayload {
  return editor.inherited?.settings.tools?.[id] ?? {};
}
function changed(id: ToolId) {
  return editor.overrides.tools?.[id] !== undefined;
}
const displayContext = $derived({ profileLabel: profileLabelFor });
/** On/off plus settings: what the change indicator compares. */
function summary(id: ToolId, value: ToolPayload) {
  return toolSummary(id, value, displayContext);
}
/** The row's status line: settings only, or what the tool does. */
function rowSummary(row: ToolRowDef, value: ToolPayload) {
  return toolSettingsSummary(row.id, value, displayContext) ?? row.description;
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
  web_fetch: Globe,
  quick_script: Zap,
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
        {@const fromExtension = extensionState(row.id)}
        {@const link = toolSettingsLink(row.id)}
        <SettingsItem
          title={row.label}
          icon={toolIcons[row.id] ?? Wrench}
          summary={fromExtension?.summary ?? rowSummary(row, value)}
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
          always={row.always}
          checked={row.always ? undefined : value.enabled === true}
          disabled={locked || fromExtension?.disabled === true}
          onCheckedChange={(next) => toggle(row.id, next)}
          onOpen={row.configurable
            ? () => configure(row)
            : link?.item
              ? () => openExtension(link.item)
              : undefined}
          openLabel={row.configurable
            ? `Configure ${row.label}`
            : `Open ${row.label} extension settings`}
        >
          {#snippet meta()}
            {#if changed(row.id)}
              <SettingsChangeIndicator
                {scope}
                from={summary(row.id, inheritedPayload(row.id))}
                onReset={() => reset(row.id)}
              />
            {/if}
          {/snippet}
        </SettingsItem>
      {/each}
    </SettingsList>
  </SettingsSection>

  {#each extensionGroups as group (group.extensionId)}
    <SettingsSection
      title={group.name}
      description={`Tools from the ${group.name} extension.`}
    >
      <SettingsList ariaLabel={`${group.name} tools`}>
        {#each group.tools as tool (tool.name)}
          {@const switchId = toolSwitch(tool.name)}
          {@const owner = extensions.view?.extensions.find(
            (extension) => extension.metadata.id === group.extensionId,
          )}
          {@const fromExtension = extensionToolState(
            tool.name,
            group.extensionId,
            extensions.view?.extensions,
            accounts,
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
            checked={switchId
              ? payload(switchId).enabled === true
              : owner?.enabled.value === true}
            switchLabel={switchId
              ? undefined
              : `Enable the ${group.name} extension`}
            disabled={switchId
              ? locked || fromExtension?.disabled === true
              : !owner || owner.readOnly || extensions.saving}
            lockedBy={!switchId && owner?.enabled.source.locked
              ? (owner.enabled.source.profile ?? "profile")
              : undefined}
            onCheckedChange={(next) => {
              // A tool without its own switch follows its extension's switch.
              if (switchId) toggle(switchId, next);
              else if (owner)
                void extensions.save(
                  owner.metadata.id,
                  entryWithEnabled(owner, next),
                );
            }}
            onOpen={() => openExtension(group.extensionId)}
            openLabel={`Open ${group.name} extension settings`}
          >
            {#snippet meta()}
              {#if switchId && changed(switchId)}
                <SettingsChangeIndicator
                  {scope}
                  from={summary(switchId, inheritedPayload(switchId))}
                  onReset={() => reset(switchId)}
                />
              {/if}
            {/snippet}
          </SettingsItem>
        {/each}
      </SettingsList>
    </SettingsSection>
  {/each}

  <ToolConfigDialog
    bind:open={dialogOpen}
    name={dialogTool.id}
    value={dialogValue}
    description={project
      ? "Changes apply to this project only."
      : "Applies to every project unless it changes this."}
    leadProfiles={leadProfileOptions()}
    resolvedPython={python?.executable}
    onSave={(next) => save(dialogTool.id, next)}
  />
{/if}
