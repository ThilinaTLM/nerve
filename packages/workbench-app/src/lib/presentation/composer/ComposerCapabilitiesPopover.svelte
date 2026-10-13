<script lang="ts">
import Blocks from "@lucide/svelte/icons/blocks";
import Folder from "@lucide/svelte/icons/folder";
import Globe from "@lucide/svelte/icons/globe";
import MessagesSquare from "@lucide/svelte/icons/messages-square";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import User from "@lucide/svelte/icons/user";
import Settings from "@lucide/svelte/icons/settings";
import Settings2 from "@lucide/svelte/icons/settings-2";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import Sparkles from "@lucide/svelte/icons/sparkles";
import type { Component, Snippet } from "svelte";
import {
  isConfigurableCapabilityTool,
  type CapabilityConfiguration,
  type CapabilityPatch,
  type CapabilityToolName,
} from "@nervekit/contracts/capabilities";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import Popover, {
  PopoverBody,
  PopoverHeader,
  PopoverSearch,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import type { SkillSource } from "@nervekit/contracts/skills";
import {
  capabilityOriginLabel,
  capabilityResetPatch,
  capabilityTogglePatch,
  capabilityToolState,
} from "./capability-origin";
import type { CapabilitySkillRow } from "./capability-skill-row";
import {
  capabilityBodyHeight,
  filterCapabilityRows,
  showCapabilitySearch,
  type CapabilityDecisionOrigin,
} from "./capability-list";
import {
  capabilityToolGroupsFor,
  capabilityToolGroupsForTab,
  type CapabilityToolGroup,
} from "./capability-tool-labels";
type Row = {
  key: string;
  label: string;
  searchText?: string;
  enabled: boolean;
  overridden: boolean;
  origin: CapabilityDecisionOrigin;
  detail: string;
  /** Explains why an enabled tool cannot run yet. */
  warning?: string;
  /** Opens the tool's settings, for tools with more than an on/off switch. */
  configure?: () => void;
  /** Marks the row's family when a list mixes more than one. */
  icon?: Component<{ class?: string; "aria-hidden"?: "true" }>;
  toggle: (enabled: boolean) => void;
  reset: () => void;
};

/* Skills come from source groups that Settings presents separately, so each row
 * carries its source as a leading icon. */
const skillSourceIcons: Record<SkillSource, Row["icon"]> = {
  user: User,
  project: Folder,
  nerve: Sparkles,
  agentBrowser: Globe,
};
const skillSourceItemLabels: Record<SkillSource, string> = {
  user: "Your skill",
  project: "Project skill",
  nerve: "Built-in Nerve skill",
  agentBrowser: "Agent Browser skill",
};
type Props = {
  configuration?: CapabilityConfiguration;
  skills?: CapabilitySkillRow[];
  loading?: boolean;
  error?: string;
  disabled?: boolean;
  onPatch?: (patch: CapabilityPatch) => void;
  onReset?: () => void;
  onRefresh?: () => void;
  onOpenSettings?: (page: "tools" | "skills" | "subagents") => void;
  subagentProfiles?: Snippet<[query: string]>;
  subagentControlsEnabled?: boolean;
  /** Opens the conversation-level settings dialog for one tool group. */
  onConfigureTool?: (group: CapabilityToolGroup) => void;
};
let {
  configuration,
  skills = [],
  loading = false,
  error,
  disabled = false,
  onPatch,
  onReset,
  onRefresh,
  onOpenSettings,
  onConfigureTool,
  subagentProfiles,
  subagentControlsEnabled = false,
}: Props = $props();

let open = $state(false);
let tab = $state<"tools" | "skills" | "subagents">("tools");
let query = $state("");

function handleOpenChange(next: boolean): void {
  open = disabled ? false : next;
  if (open) {
    query = "";
    onRefresh?.();
  }
}

function selectTab(next: "tools" | "skills" | "subagents"): void {
  tab = next;
  query = "";
}

/* Tool settings open in a dialog, which replaces the popover. */
function configureTool(group: CapabilityToolGroup): void {
  open = false;
  onConfigureTool?.(group);
}

$effect(() => {
  if (disabled) open = false;
});

const tools = $derived<CapabilityToolName[]>(
  configuration?.availableTools ?? [],
);

function toolEnabled(name: CapabilityToolName): boolean {
  return !configuration?.effective.disabledTools.includes(name);
}

const conversation = $derived(configuration?.conversation);
const allToolGroups = $derived(capabilityToolGroupsFor(tools));
const toolGroups = $derived(capabilityToolGroupsForTab(tools, "tools"));
const overrideCount = $derived(
  conversation
    ? allToolGroups.filter((group) =>
        group.names.some(
          (name) =>
            conversation.tools[name] !== undefined ||
            (isConfigurableCapabilityTool(name) &&
              conversation.toolSettings[name] !== undefined),
        ),
      ).length +
        Object.keys(conversation.skills.file).length +
        Object.keys(conversation.skills.nerve).length +
        Object.keys(conversation.skills.agentBrowser).length
    : 0,
);
const enabledTools = $derived(
  configuration
    ? toolGroups.filter((group) => group.names.every(toolEnabled)).length
    : 0,
);
const enabledSkills = $derived(
  configuration ? skills.filter((skill) => skill.enabled).length : 0,
);
const triggerTitle = $derived(
  loading && !configuration
    ? "Capabilities: loading"
    : error
      ? `Capabilities unavailable: ${error}`
      : `Capabilities: ${enabledTools} of ${toolGroups.length} optional tools, ${enabledSkills} of ${skills.length} skills enabled · delegation ${tools.includes("subagents") ? (toolEnabled("subagents") ? "on" : "off") : "unavailable"}${overrideCount > 0 ? " · conversation overrides" : ""}`,
);

const toolStates = $derived(
  configuration
    ? new Map(
        allToolGroups.map((group) => [
          group.key,
          capabilityToolState({
            configuration,
            level: "conversation",
            names: group.names,
          }),
        ]),
      )
    : new Map(),
);

const toolRows = $derived<Row[]>(
  allToolGroups.flatMap((group) => {
    const state = toolStates.get(group.key);
    if (!state) return [];
    const configurable =
      Boolean(onConfigureTool) &&
      (Boolean(state.profileTool && state.profileOptions.length > 0) ||
        Boolean(state.settingsTool));
    return [
      {
        key: group.key,
        label: group.label,
        searchText: group.searchText,
        enabled: state.enabled,
        overridden: state.stored,
        origin: state.stored ? "conversation" : state.inheritedFrom,
        detail: state.originLabel,
        warning: state.profileMissing
          ? "Profile not found on this machine"
          : state.needsProfile
            ? "Choose a profile"
            : undefined,
        configure: configurable ? () => configureTool(group) : undefined,
        toggle: (enabled: boolean) => {
          onPatch?.({
            tools: capabilityTogglePatch(state, group.names, enabled),
          });
          // Several profiles and none chosen: ask which one to use.
          if (
            enabled &&
            configurable &&
            (!state.profileId || state.profileMissing) &&
            state.profileOptions.length > 1 &&
            (state.profileTool === "jira" || state.profileTool === "confluence")
          )
            configureTool(group);
        },
        reset: () => onPatch?.(capabilityResetPatch(group.names)),
      } satisfies Row,
    ];
  }),
);

const skillRows = $derived<Row[]>(
  skills.map((skill) => ({
    key: skill.key,
    label: skill.name,
    enabled: skill.enabled,
    overridden: skill.overridden,
    origin: skill.overridden ? "conversation" : skill.inheritedFrom,
    icon: skillSourceIcons[skill.source],
    detail: `${skillSourceItemLabels[skill.source]} · ${capabilityOriginLabel({
      level: "conversation",
      stored: skill.overridden,
      matchesInherited: skill.matchesInherited,
      inheritedFrom: skill.inheritedFrom,
    })}`,
    toggle: (enabled: boolean) =>
      onPatch?.({ skills: { [skill.kind]: { [skill.name]: enabled } } }),
    reset: () =>
      onPatch?.({ skills: { [skill.kind]: { [skill.name]: null } } }),
  })),
);

const subagentRow = $derived(toolRows.find((row) => row.key === "subagents"));
const optionalToolRows = $derived(
  toolRows.filter((row) => row.key !== "subagents"),
);
/* Keep the original body geometry without showing another tab's search field. */
const showSearch = $derived(
  tab === "tools"
    ? showCapabilitySearch(optionalToolRows.length)
    : tab === "skills"
      ? showCapabilitySearch(skillRows.length)
      : false,
);
const bodyHeight = $derived(
  capabilityBodyHeight(optionalToolRows.length, skillRows.length),
);

function openSettings(): void {
  open = false;
  onOpenSettings?.(tab);
}
</script>

{#snippet capabilityRow(row: Row)}
  {@const Icon = row.icon}
  <div
    class="flex min-h-7 min-w-0 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent"
  >
    {#if Icon}
      <Icon
        class="size-3.5 flex-none text-muted-foreground"
        aria-hidden="true"
      />
    {/if}
    <span class="min-w-0 flex-1 truncate" title={row.detail}>
      {row.label}
    </span>
    {#if row.warning}
      <span
        class="inline-flex flex-none text-warning"
        role="img"
        aria-label={row.warning}
        title={row.warning}
      >
        <TriangleAlert class="size-3.5" aria-hidden="true" />
      </span>
    {/if}
    {#if row.origin === "conversation"}
      <span
        class="inline-flex flex-none text-primary"
        role="img"
        aria-label="Conversation override"
        title={row.detail}
      >
        <MessagesSquare class="size-3.5" aria-hidden="true" />
      </span>
    {/if}
    {#if row.overridden}
      <IconAction
        icon={RotateCcw}
        size="xs"
        label={`Reset ${row.label} to the inherited setting`}
        onclick={row.reset}
      />
    {/if}
    {#if row.configure}
      <IconAction
        icon={Settings2}
        size="xs"
        label={`Configure ${row.label}`}
        onclick={row.configure}
      />
    {/if}
    <Switch
      size="sm"
      checked={row.enabled}
      disabled={disabled || loading}
      aria-label={`Enable ${row.label} for this conversation`}
      onCheckedChange={row.toggle}
    />
  </div>
{/snippet}

{#snippet capabilityList(rows: Row[], kind: "tools" | "skills")}
  {@const visibleRows = showSearch ? filterCapabilityRows(rows, query) : rows}
  {#if error}
    <p class="px-1.5 text-warning" role="alert">{error}</p>
  {:else if loading && !configuration}
    <div class="grid gap-1" aria-hidden="true">
      <Skeleton class="h-7 w-full" /><Skeleton class="h-7 w-full" /><Skeleton
        class="h-7 w-full"
      />
    </div>
  {:else if rows.length === 0}
    <p class="px-1.5 text-muted-foreground">
      {kind === "skills"
        ? "No skills are available for this project."
        : "No optional tools are available."}
    </p>
  {:else if visibleRows.length === 0}
    <p class="px-1.5 text-muted-foreground">
      {kind === "skills" ? "No skills match." : "No tools match."}
    </p>
  {:else}
    {#each visibleRows as row (row.key)}{@render capabilityRow(row)}{/each}
  {/if}
{/snippet}

<Popover
  {open}
  onOpenChange={handleOpenChange}
  size="md"
  triggerClass="composer-tab gap-1 px-1.5 max-sm:px-1"
  ariaLabel="Capabilities"
  {triggerTitle}
  side="top"
  align="end"
>
  {#snippet trigger()}
    <span
      class={`relative inline-flex items-center gap-1 ${disabled ? "opacity-60" : ""}`}
      data-tour-id="composer-capabilities"
    >
      <Blocks size={13} strokeWidth={2.2} aria-hidden="true" />
      <span>{enabledTools}/{enabledSkills}</span>
      {#if overrideCount > 0}
        <span
          class="absolute -top-1 -right-1.5 size-1.5 rounded-full bg-primary"
        ></span>
      {/if}
    </span>
  {/snippet}

  <PopoverHeader title="Capabilities">
    {#snippet actions()}
      {#if overrideCount > 0}
        <Button
          size="icon-xs"
          variant="ghost"
          ariaLabel="Reset conversation capability overrides; profile overrides are unchanged"
          title={`Reset ${overrideCount} conversation override${overrideCount === 1 ? "" : "s"}`}
          onclick={() => onReset?.()}
        >
          <RotateCcw class="size-3.5" aria-hidden="true" />
        </Button>
      {/if}
      <Button
        size="icon-xs"
        variant="ghost"
        ariaLabel={`Open ${tab === "subagents" ? "sub-agent" : tab} settings`}
        title={`Open ${tab === "subagents" ? "sub-agent" : tab} settings`}
        onclick={openSettings}
      >
        <Settings class="size-3.5" aria-hidden="true" />
      </Button>
    {/snippet}
  </PopoverHeader>

  <PopoverSearch class={showSearch ? "grid gap-2" : undefined}>
    <ToggleGroup.Root
      type="single"
      size="xs"
      spacing={1}
      variant="chip"
      value={tab}
      class="justify-start"
      aria-label="Capability kind"
      onValueChange={(value) => {
        if (value === "tools" || value === "skills" || value === "subagents")
          selectTab(value);
      }}
    >
      <ToggleGroup.Item value="tools" class="flex-none">
        Tools
        <span data-slot="toggle-count">{enabledTools}/{toolGroups.length}</span>
      </ToggleGroup.Item>
      <ToggleGroup.Item value="skills" class="flex-none">
        Skills
        <span data-slot="toggle-count">{enabledSkills}/{skills.length}</span>
      </ToggleGroup.Item>
      <ToggleGroup.Item value="subagents" class="flex-none"
        >Sub-agents</ToggleGroup.Item
      >
    </ToggleGroup.Root>
    {#if showSearch}
      <SearchInput
        bind:value={query}
        placeholder="Filter capabilities"
        ariaLabel={tab === "subagents"
          ? "Filter sub-agent profiles"
          : tab === "skills"
            ? "Filter skills"
            : "Filter tools"}
      />
    {/if}
  </PopoverSearch>

  <PopoverBody
    class="gap-0"
    stableHeight={tab === "subagents" ? undefined : bodyHeight}
  >
    {#if tab === "tools"}
      {@render capabilityList(optionalToolRows, "tools")}
    {:else if tab === "skills"}
      {@render capabilityList(skillRows, "skills")}
    {:else}
      {#if subagentControlsEnabled}
        {#if subagentRow}
          {@render capabilityRow(subagentRow)}
          <p class="mb-3 px-1.5 text-xs text-muted-foreground">
            Delegation master switch: when off, the lead has no sub-agent tools.
            Profile switches cannot enable delegation.
          </p>
        {:else if loading && !configuration}
          <p class="px-1.5 text-xs text-muted-foreground">
            Loading delegation capability…
          </p>
        {:else}
          <p class="mb-3 px-1.5 text-xs text-warning">
            The delegation capability is unavailable in this conversation.
          </p>
        {/if}
        {#if error}<p class="px-1.5 text-xs text-warning" role="alert">
            {error}
          </p>{/if}
      {/if}
      {#if open && tab === "subagents" && subagentProfiles}{@render subagentProfiles(
          query,
        )}{:else}<p class="px-1.5 text-xs text-muted-foreground">
          Sub-agent profiles are available in saved lead conversations.
        </p>{/if}
    {/if}
  </PopoverBody>
</Popover>
