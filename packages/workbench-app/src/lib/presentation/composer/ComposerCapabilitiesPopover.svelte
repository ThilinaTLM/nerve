<script lang="ts">
import Blocks from "@lucide/svelte/icons/blocks";
import Folder from "@lucide/svelte/icons/folder";
import Globe from "@lucide/svelte/icons/globe";
import Lock from "@lucide/svelte/icons/lock";
import MessagesSquare from "@lucide/svelte/icons/messages-square";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import User from "@lucide/svelte/icons/user";
import Settings from "@lucide/svelte/icons/settings";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import Sparkles from "@lucide/svelte/icons/sparkles";
import type { Component } from "svelte";
import {
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
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
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
  capabilityToolSummary,
  type CapabilityToolGroup,
} from "./capability-tool-labels";
import type { ComposerLockedFields } from "../conversations/conversation-view-contracts.js";
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
  summary?: string;
  setupMissing?: boolean;
  /** Opens the tool's settings, for tools with more than an on/off switch. */
  configure?: () => void;
  /** Always on (bash): only its configuration can change. */
  alwaysOn?: boolean;
  /** Account choice for integration tools. */
  accounts?: { id: string; name: string }[];
  accountId?: string;
  setAccount?: (id: string | undefined) => void;
  /** Holds the row: the applied profile locks it. */
  lockedBy?: string;
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
  onOpenSettings?: (page: "tools" | "skills") => void;
  /** Delegation is a conversation-level switch only in leads. */
  subagentControlsEnabled?: boolean;
  lockedFields?: ComposerLockedFields;
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
  subagentControlsEnabled = false,
  lockedFields = {},
}: Props = $props();

let open = $state(false);
let tab = $state<"tools" | "skills">("tools");
let query = $state("");

function handleOpenChange(next: boolean): void {
  open = disabled ? false : next;
  if (open) {
    query = "";
    onRefresh?.();
  }
}

function selectTab(next: "tools" | "skills"): void {
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
  return (
    name === "bash" || !configuration?.effective.disabledTools.includes(name)
  );
}

const conversation = $derived(configuration?.conversation);
const allToolGroups = $derived(capabilityToolGroupsFor(tools));
const toolGroups = $derived(
  allToolGroups.filter(
    (group) =>
      group.key !== "bash" &&
      (subagentControlsEnabled || !group.names.includes("subagents")),
  ),
);
const overrideCount = $derived(
  conversation
    ? allToolGroups.filter((group) =>
        group.names.some((name) => conversation.tools[name] !== undefined),
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

const lockedToolNames = $derived(new Set(lockedFields.tools ?? []));

const toolRows = $derived<Row[]>(
  allToolGroups
    .filter(
      (group) => subagentControlsEnabled || !group.names.includes("subagents"),
    )
    .flatMap((group) => {
      const state = toolStates.get(group.key);
      if (!state) return [];
      const lockedBy = group.names.some((name) => lockedToolNames.has(name))
        ? (lockedFields.by ?? "the applied profile")
        : undefined;
      const alwaysOn = group.names.includes("bash");
      const configurable =
        Boolean(onConfigureTool) &&
        (alwaysOn ||
          Boolean(state.settingsTool) ||
          Boolean(state.profileTool)) &&
        !lockedBy;
      const accounts: { id: string; name: string }[] = state.profileTool
        ? state.profileOptions
        : [];
      return [
        {
          key: group.key,
          label: group.label,
          searchText: group.searchText,
          enabled: state.enabled,
          overridden: state.stored && !lockedBy,
          origin: state.stored ? "conversation" : state.inheritedFrom,
          detail: lockedBy ? `Locked by ${lockedBy}` : state.originLabel,
          summary: state.profileTool
            ? (accounts.find((account) => account.id === state.profileId)
                ?.name ?? "No account selected")
            : configuration
              ? capabilityToolSummary(configuration.effective, group.names[0]!)
              : undefined,
          setupMissing: Boolean(state.profileTool && accounts.length === 0),
          lockedBy,
          alwaysOn,
          warning:
            state.profileTool && accounts.length === 0
              ? "No accounts. Configure to set up in Integrations."
              : state.profileMissing
                ? "Account not found on this machine"
                : state.needsProfile || (state.profileTool && !state.profileId)
                  ? "Choose an account"
                  : undefined,
          configure: configurable ? () => configureTool(group) : undefined,
          accounts: accounts.length > 0 ? accounts : undefined,
          accountId: state.profileId,
          setAccount: (id) =>
            onPatch?.({
              tools: Object.fromEntries(
                group.names
                  .filter((name) => name === state.profileTool)
                  .map((name) => [name, { profileId: id ?? null }]),
              ),
            }),
          toggle: (enabled: boolean) =>
            onPatch?.({
              tools: capabilityTogglePatch(state, group.names, enabled),
            }),
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
    overridden: skill.overridden && !lockedFields.skills,
    origin: skill.overridden ? "conversation" : skill.inheritedFrom,
    icon: skillSourceIcons[skill.source],
    detail: `${skillSourceItemLabels[skill.source]} · ${capabilityOriginLabel({
      level: "conversation",
      stored: skill.overridden,
      matchesInherited: skill.matchesInherited,
      inheritedFrom: skill.inheritedFrom,
    })}`,
    lockedBy: lockedFields.skills
      ? (lockedFields.by ?? "the applied profile")
      : undefined,
    toggle: (enabled: boolean) =>
      onPatch?.({ skills: { [skill.kind]: { [skill.name]: enabled } } }),
    reset: () =>
      onPatch?.({ skills: { [skill.kind]: { [skill.name]: null } } }),
  })),
);

/* Keep the original body geometry without showing another tab's search field. */
const showSearch = $derived(
  tab === "tools"
    ? showCapabilitySearch(toolRows.length)
    : showCapabilitySearch(skillRows.length),
);
const bodyHeight = $derived(
  capabilityBodyHeight(toolRows.length, skillRows.length),
);

function openSettings(): void {
  open = false;
  onOpenSettings?.(tab);
}
</script>

{#snippet capabilityRow(row: Row)}
  {@const Icon = row.icon}
  <div class="grid min-w-0 gap-1 rounded-md px-1.5 py-1 hover:bg-accent">
    <div class="flex min-h-7 min-w-0 items-center gap-2">
      {#if Icon}
        <Icon
          class="size-3.5 flex-none text-muted-foreground"
          aria-hidden="true"
        />
      {/if}
      <div class="min-w-0 flex-1" title={row.detail}>
        <p class="truncate" title={row.label}>{row.label}</p>
        {#if row.summary || row.lockedBy || row.warning}
          <p
            class="truncate text-xs text-muted-foreground"
            title={row.warning ?? row.summary}
          >
            {row.lockedBy
              ? `Locked by ${row.lockedBy}`
              : (row.warning ??
                `${row.enabled ? "On" : "Off"} · ${row.summary}`)}
          </p>
        {/if}
      </div>
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
      {#if row.lockedBy}
        <span
          class="inline-flex flex-none items-center gap-1 text-muted-foreground"
          role="img"
          aria-label={`${row.label} locked by ${row.lockedBy}`}
          title={`Locked by ${row.lockedBy}`}
        >
          <Lock class="size-3.5" aria-hidden="true" />
        </span>
      {:else if row.origin === "conversation"}
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
          label={`Reset ${row.label} to the inherited setting`}
          onclick={row.reset}
        />
      {/if}
      <Switch
        checked={row.enabled}
        disabled={disabled || loading || row.alwaysOn || Boolean(row.lockedBy)}
        aria-label={`Enable ${row.label} for this conversation`}
        onCheckedChange={row.toggle}
      />
      {#if row.configure}
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || loading}
          aria-label={`Configure ${row.label}`}
          onclick={row.configure}
          >{row.setupMissing ? "Set up" : "Configure"}</Button
        >
      {/if}
    </div>
    {#if row.accounts && row.setAccount}
      <div class="flex min-w-0 items-center justify-between gap-2">
        <span class="text-xs text-muted-foreground">Account</span>
        <SelectField
          items={row.accounts.map((account) => ({
            value: account.id,
            label: account.name,
          }))}
          value={row.accountId ?? ""}
          placeholder="Choose account"
          ariaLabel={`${row.label} account`}
          class="min-w-0 flex-1"
          disabled={disabled || loading || Boolean(row.lockedBy)}
          onValueChange={(value) => row.setAccount?.(value || undefined)}
        />
      </div>
    {/if}
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
  triggerClass="composer-tab w-control p-0"
  ariaLabel="Tools and skills"
  {triggerTitle}
  side="top"
  align="start"
>
  {#snippet trigger()}
    <span
      class={`relative inline-flex items-center ${disabled ? "opacity-60" : ""}`}
      data-tour-id="composer-capabilities"
    >
      <Blocks aria-hidden="true" />
      {#if overrideCount > 0}
        <span
          class="absolute -top-1 -right-1.5 size-1.5 rounded-full bg-primary"
        ></span>
      {/if}
    </span>
  {/snippet}

  <PopoverHeader title="Tools and skills">
    {#snippet actions()}
      {#if overrideCount > 0}
        <Button
          size="icon-sm"
          variant="ghost"
          ariaLabel="Reset conversation capability overrides"
          title={`Reset ${overrideCount} conversation override${overrideCount === 1 ? "" : "s"}`}
          onclick={() => onReset?.()}
        >
          <RotateCcw class="size-3.5" aria-hidden="true" />
        </Button>
      {/if}
      <Button
        size="icon-sm"
        variant="ghost"
        ariaLabel={`Open ${tab} settings`}
        title={`Open ${tab} settings`}
        onclick={openSettings}
      >
        <Settings class="size-3.5" aria-hidden="true" />
      </Button>
    {/snippet}
  </PopoverHeader>

  <PopoverSearch class={showSearch ? "grid gap-2" : undefined}>
    <ToggleGroup.Root
      type="single"
      size="sm"
      spacing={1}
      variant="chip"
      value={tab}
      class="justify-start"
      aria-label="Capability kind"
      onValueChange={(value) => {
        if (value === "tools" || value === "skills") selectTab(value);
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
    </ToggleGroup.Root>
    {#if showSearch}
      <SearchInput
        bind:value={query}
        placeholder="Filter capabilities"
        ariaLabel={tab === "skills" ? "Filter skills" : "Filter tools"}
      />
    {/if}
  </PopoverSearch>

  <PopoverBody class="gap-0" stableHeight={bodyHeight}>
    {#if tab === "tools"}
      {@render capabilityList(toolRows, "tools")}
    {:else}
      {@render capabilityList(skillRows, "skills")}
    {/if}
  </PopoverBody>
</Popover>
