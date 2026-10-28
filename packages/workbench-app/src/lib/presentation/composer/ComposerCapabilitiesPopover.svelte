<script lang="ts">
import Wrench from "@lucide/svelte/icons/wrench";
import BookOpen from "@lucide/svelte/icons/book-open";
import Users from "@lucide/svelte/icons/users";
import Folder from "@lucide/svelte/icons/folder";
import Globe from "@lucide/svelte/icons/globe";
import Lock from "@lucide/svelte/icons/lock";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import User from "@lucide/svelte/icons/user";
import Settings from "@lucide/svelte/icons/settings";
import Settings2 from "@lucide/svelte/icons/settings-2";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import Sparkles from "@lucide/svelte/icons/sparkles";
import type { Component } from "svelte";
import type { CapabilityToolName } from "@nervekit/contracts/capabilities";
import type { LeadSettingsOverrides } from "@nervekit/contracts/agent-configuration";
import type { AgentEditorView } from "./agent-editor-view";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import Popover, {
  PopoverBody,
  PopoverHeader,
  PopoverCommandList,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";

import {
  skillOverrideKind,
  type AvailableSkill,
} from "@nervekit/contracts/skills";
import {
  capabilityToolGroupsFor,
  type CapabilityToolGroup,
} from "./capability-tool-labels";
import {
  capabilitySubagentCounts,
  capabilitySubagentEnabled,
  type CapabilitySubagentProfile,
} from "./capability-subagent-profiles";
import type { ComposerLockedFields } from "../conversations/conversation-view-contracts.js";
import {
  capabilityToolLocks,
  editableToolOverrideResets,
} from "./capability-tool-locks";
type Row = {
  key: string;
  label: string;
  group: string;
  keywords?: string[];
  detail?: string;
  unavailable?: boolean;
  muted?: boolean;
  switchLabel?: string;
  resetLabel?: string;
  enabled: boolean;
  overridden: boolean;
  warning?: string;
  configure?: () => void;
  lockedBy?: string;
  icon?: Component<{ class?: string; "aria-hidden"?: "true" }>;
  toggle: (enabled: boolean) => void;
  reset: () => void;
};
const skillSourceIcons = {
  user: User,
  project: Folder,
  nerve: Sparkles,
  agentBrowser: Globe,
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
}: {
  configuration?: AgentEditorView;
  skills?: AvailableSkill[];
  loading?: boolean;
  error?: string;
  disabled?: boolean;
  onPatch?: (changes: LeadSettingsOverrides, resets?: string[]) => void;
  onReset?: () => void;
  onRefresh?: () => void;
  onOpenSettings?: (page: "tools" | "skills" | "sub-agents") => void;
  onConfigureTool?: (group: CapabilityToolGroup) => void;
  subagentProfiles?: CapabilitySubagentProfile[];
  subagentControlsEnabled?: boolean;
  lockedFields?: ComposerLockedFields;
} = $props();
let open = $state(false);
let tab = $state<"tools" | "skills" | "subagents">("tools");
let query = $state("");
const escape = (v: string) => v.replaceAll("~", "~0").replaceAll("/", "~1");
function handleOpenChange(next: boolean) {
  open = disabled ? false : next;
  if (open) {
    query = "";
    onRefresh?.();
  }
}
function configureTool(group: CapabilityToolGroup) {
  open = false;
  onConfigureTool?.(group);
}
$effect(() => {
  if (disabled) open = false;
});
const allToolGroups = $derived(
  capabilityToolGroupsFor(
    Object.keys(
      configuration?.resolution.settings.tools ?? {},
    ) as CapabilityToolName[],
  ),
);
const overrideCounts = $derived({
  tools: Object.keys(configuration?.overrides.tools ?? {}).filter(
    (name) => name !== "subagents",
  ).length,
  skills: Object.values(configuration?.overrides.skills ?? {}).reduce(
    (n, group) => n + Object.keys(group).length,
    0,
  ),
  subagents:
    Object.keys(configuration?.overrides.subagents ?? {}).length +
    Number(configuration?.overrides.tools?.subagents !== undefined),
});
const overrideCount = $derived(
  overrideCounts.tools + overrideCounts.skills + overrideCounts.subagents,
);
const toolRows = $derived<Row[]>(
  allToolGroups
    .filter((g) => g.key !== "bash")
    .map((group) => {
      const locks = capabilityToolLocks(
        group.names,
        configuration?.resolution.provenance,
      );
      const lockedBy = locks.enabledBy;
      const resets = editableToolOverrideResets(
        group.names,
        configuration?.overrides,
        configuration?.resolution.provenance,
      );
      const configurable =
        !!onConfigureTool &&
        group.names.some(
          (name) => name !== "web_fetch" && name !== "subagents",
        );
      return {
        key: group.key,
        label: group.label,
        group: "Built-in",
        keywords: group.searchText ? [group.searchText] : undefined,
        enabled: group.names.every(
          (name) =>
            name === "bash" ||
            (configuration?.resolution.settings.tools?.[name] &&
              "enabled" in configuration.resolution.settings.tools[name]! &&
              configuration.resolution.settings.tools[name]!.enabled === true),
        ),
        overridden: resets.length > 0,
        lockedBy,
        configure: configurable ? () => configureTool(group) : undefined,
        toggle: (enabled) =>
          onPatch?.({
            tools: Object.fromEntries(
              group.names.map((name) => [name, { enabled }]),
            ),
          }),
        reset: () => onPatch?.({}, resets),
      };
    }),
);
const optionalToolRows = $derived(
  toolRows.filter((r) => r.key !== "subagents"),
);
const enabledTools = $derived(optionalToolRows.filter((r) => r.enabled).length);
const toolGroups = $derived(optionalToolRows);
const subagentRow = $derived(toolRows.find((r) => r.key === "subagents"));
const subagentCounts = $derived(
  subagentProfiles
    ? capabilitySubagentCounts(
        subagentProfiles,
        configuration?.resolution.settings.subagents,
      )
    : undefined,
);
const skillRows = $derived<Row[]>(
  skills.map((skill) => {
    const kind = skillOverrideKind(skill.source);
    const pointer = `/skills/${kind}/${escape(skill.name)}`;
    const provenance =
      configuration?.resolution.provenance[pointer] ??
      configuration?.resolution.provenance[`/skills/defaults/${kind}`];
    return {
      key: `${kind}:${skill.name}`,
      label: skill.name,
      group: {
        user: "User",
        project: "Project",
        nerve: "Nerve",
        agentBrowser: "Agent Browser",
      }[skill.source],
      keywords: [skill.source],
      enabled:
        configuration?.resolution.settings.skills?.[kind]?.[skill.name] ??
        configuration?.resolution.settings.skills?.defaults?.[kind] ??
        false,
      overridden:
        configuration?.overrides.skills?.[kind]?.[skill.name] !== undefined &&
        provenance?.source !== "requirement",
      icon: skillSourceIcons[skill.source],
      lockedBy:
        provenance?.source === "requirement" ? provenance.profile : undefined,
      toggle: (enabled) =>
        onPatch?.({ skills: { [kind]: { [skill.name]: enabled } } }),
      reset: () => onPatch?.({}, [`/overrides${pointer}`]),
    };
  }),
);
const enabledSkills = $derived(skillRows.filter((r) => r.enabled).length);
const sections = $derived([
  {
    kind: "tools" as const,
    title: "Tools",
    icon: Wrench,
    count: `${enabledTools}/${toolGroups.length}`,
  },
  {
    kind: "skills" as const,
    title: "Skills",
    icon: BookOpen,
    count: `${enabledSkills}/${skills.length}`,
  },
  {
    kind: "subagents" as const,
    title: "Sub-agents",
    icon: Users,
    count: subagentCounts
      ? `${subagentCounts.available}/${subagentCounts.total}`
      : undefined,
  },
]);
const subagentRows = $derived<Row[]>(
  (subagentProfiles ?? []).map((profile) => {
    const source =
      configuration?.resolution.provenance[
        `/subagents/${escape(profile.name)}/enabled`
      ];
    return {
      key: profile.name,
      label: profile.label,
      group: "Sub-agents",
      detail: profile.description,
      keywords: profile.description ? [profile.description] : undefined,
      enabled: capabilitySubagentEnabled(
        profile,
        configuration?.resolution.settings.subagents,
      ),
      overridden: Boolean(configuration?.overrides.subagents?.[profile.name]),
      warning: profile.error,
      unavailable: Boolean(profile.error) || !subagentControlsEnabled,
      muted: Boolean(profile.error) || subagentRow?.enabled === false,
      lockedBy: source?.source === "requirement" ? source.profile : undefined,
      switchLabel: `Enable ${profile.label} launches`,
      resetLabel: `Reset ${profile.label} launch choices; requirements remain effective`,
      configure: () => openSettings("sub-agents"),
      toggle: (enabled) =>
        onPatch?.({ subagents: { [profile.name]: { enabled } } }),
      reset: () =>
        onPatch?.({}, [`/overrides/subagents/${escape(profile.name)}`]),
    };
  }),
);
const rows = $derived(
  tab === "tools"
    ? optionalToolRows
    : tab === "skills"
      ? skillRows
      : subagentRows,
);
function rowDisabled(row: Row) {
  return (
    disabled || loading || Boolean(row.lockedBy) || Boolean(row.unavailable)
  );
}
function toggleRow(row: Row) {
  if (!rowDisabled(row)) row.toggle(!row.enabled);
}
function openSettings(
  page: "tools" | "skills" | "sub-agents" = tab === "subagents"
    ? "sub-agents"
    : tab,
) {
  open = false;
  onOpenSettings?.(page);
}
</script>

{#snippet capabilityRow(row: Row)}
  {@const Icon = row.icon}
  <div
    class="flex min-h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent"
  >
    {#if Icon}
      <Icon
        class="size-3.5 flex-none text-muted-foreground"
        aria-hidden="true"
      />
    {/if}
    <span
      class={`min-w-0 flex-1 truncate ${row.muted ? "text-muted-foreground" : ""}`}
      title={row.warning ?? row.detail}
    >
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
    {#if row.lockedBy}
      <span
        class="inline-flex flex-none text-muted-foreground"
        role="img"
        aria-label={`${row.label} locked by ${row.lockedBy}`}
        title={`Locked by ${row.lockedBy}`}
      >
        <Lock class="size-3.5" aria-hidden="true" />
      </span>
    {/if}
    {#if row.overridden}
      <IconAction
        icon={RotateCcw}
        label={row.resetLabel ?? `Reset ${row.label} to the inherited setting`}
        disabled={disabled || loading}
        onclick={(event) => {
          event.stopPropagation();
          row.reset();
        }}
      />
    {/if}
    {#if row.configure}
      <IconAction
        icon={Settings2}
        label={`Configure ${row.label}`}
        onclick={(event) => {
          event.stopPropagation();
          row.configure?.();
        }}
      />
    {/if}
    <Switch
      checked={row.enabled}
      disabled={rowDisabled(row)}
      busy={loading}
      aria-label={row.switchLabel ??
        `Enable ${row.label} for this conversation`}
      onclick={(event) => event.stopPropagation()}
      onCheckedChange={row.toggle}
    />
  </div>
{/snippet}

{#snippet delegationRow()}
  {#if subagentRow}
    {@render capabilityRow({ ...subagentRow, label: "Delegation" })}
  {:else}
    <p class="px-1.5 text-warning">Delegation is unavailable here.</p>
  {/if}
{/snippet}

{#each sections as section (section.kind)}
  <Popover
    open={open && tab === section.kind}
    onOpenChange={(next) => {
      if (next) {
        tab = section.kind;
        handleOpenChange(true);
      } else if (tab === section.kind) {
        handleOpenChange(false);
      }
    }}
    size="md"
    triggerClass="composer-tab w-control p-0"
    ariaLabel={section.title}
    triggerTitle={error
      ? `${section.title} unavailable: ${error}`
      : `${section.title}${section.count ? ` (${section.count})` : ""}`}
    side="top"
    align="start"
  >
    {#snippet trigger()}
      <span
        class={`relative inline-flex items-center ${disabled ? "opacity-60" : ""}`}
        data-tour-id={`composer-${section.kind}`}
      >
        <section.icon aria-hidden="true" />
        {#if overrideCounts[section.kind] > 0}
          <span
            class="absolute -top-1 -right-1.5 size-1.5 rounded-full bg-primary"
          ></span>
        {/if}
      </span>
    {/snippet}

    <PopoverHeader title={section.title}>
      {#snippet actions()}
        {#if overrideCount > 0}
          <Button
            size="icon-sm"
            variant="ghost"
            ariaLabel="Reset all conversation capability overrides"
            title={`Reset all ${overrideCount} conversation capability override${overrideCount === 1 ? "" : "s"}`}
            disabled={disabled || loading}
            onclick={() => onReset?.()}
          >
            <RotateCcw class="size-3.5" aria-hidden="true" />
          </Button>
        {/if}
        <Button
          size="icon-sm"
          variant="ghost"
          ariaLabel={`Open ${tab === "subagents" ? "sub-agent" : tab} settings`}
          title={`Open ${tab === "subagents" ? "sub-agent" : tab} settings`}
          onclick={() => openSettings()}
        >
          <Settings class="size-3.5" aria-hidden="true" />
        </Button>
      {/snippet}
    </PopoverHeader>

    {#if error}
      <PopoverBody
        ><p class="px-1.5 text-warning" role="alert">{error}</p></PopoverBody
      >
    {:else if loading && !configuration}
      <PopoverBody
        ><div class="grid gap-1" aria-hidden="true">
          <Skeleton class="h-7 w-full" /><Skeleton class="h-7 w-full" />
        </div></PopoverBody
      >
    {:else}
      {#if tab === "subagents"}
        <PopoverBody>
          {#if subagentControlsEnabled}
            {@render delegationRow()}
          {:else}
            <p class="px-1.5 text-muted-foreground">
              Sub-agents can't delegate. Configure profiles in the lead
              conversation.
            </p>
          {/if}
        </PopoverBody>
      {/if}
      <PopoverCommandList
        rowMode="container"
        items={rows}
        bind:query
        ariaLabel={section.title}
        placeholder={`Search ${section.title.toLowerCase()}`}
        isSelected={(row) => row.enabled}
        isDisabled={rowDisabled}
        onChoose={toggleRow}
        empty={rows.length === 0
          ? tab === "tools"
            ? "No optional tools are available."
            : tab === "skills"
              ? "No skills are available for this project."
              : "No sub-agent profiles are available."
          : `No ${section.title.toLowerCase()} match.`}
      >
        {#snippet row(item)}
          {@render capabilityRow(item)}
        {/snippet}
      </PopoverCommandList>
    {/if}
  </Popover>
{/each}
