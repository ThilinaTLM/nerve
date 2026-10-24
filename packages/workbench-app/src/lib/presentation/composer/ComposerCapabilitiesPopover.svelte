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
  PopoverSearch,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";

import {
  skillOverrideKind,
  type AvailableSkill,
} from "@nervekit/contracts/skills";
import {
  capabilityBodyHeight,
  filterCapabilityRows,
  showCapabilitySearch,
} from "./capability-list";
import {
  capabilityToolGroupsFor,
  type CapabilityToolGroup,
} from "./capability-tool-labels";
import {
  capabilitySubagentCounts,
  type CapabilitySubagentProfile,
} from "./capability-subagent-profiles";
import type { ComposerLockedFields } from "../conversations/conversation-view-contracts.js";
type Row = {
  key: string;
  label: string;
  searchText?: string;
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
      const provenance =
        Object.entries(configuration?.resolution.provenance ?? {}).find(
          ([pointer, p]) =>
            group.names.some((name) => pointer.startsWith(`/tools/${name}/`)) &&
            p.source === "requirement",
        )?.[1] ??
        configuration?.resolution.provenance[
          `/tools/${group.names[0]}/enabled`
        ];
      const lockedBy =
        provenance?.source === "requirement"
          ? (provenance.profile ?? "the active profile")
          : undefined;
      const configurable =
        !!onConfigureTool &&
        group.names.some(
          (name) => name !== "web_fetch" && name !== "subagents",
        );
      return {
        key: group.key,
        label: group.label,
        searchText: group.searchText,
        enabled: group.names.every(
          (name) =>
            name === "bash" ||
            (configuration?.resolution.settings.tools?.[name] &&
              "enabled" in configuration.resolution.settings.tools[name]! &&
              configuration.resolution.settings.tools[name]!.enabled === true),
        ),
        overridden:
          !lockedBy &&
          group.names.some(
            (name) => configuration?.overrides.tools?.[name] !== undefined,
          ),
        lockedBy,
        configure:
          configurable && !lockedBy ? () => configureTool(group) : undefined,
        toggle: (enabled) =>
          onPatch?.({
            tools: Object.fromEntries(
              group.names.map((name) => [name, { enabled }]),
            ),
          }),
        reset: () =>
          onPatch?.(
            {},
            group.names.map((name) => `/overrides/tools/${name}`),
          ),
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
  subagentProfiles ? capabilitySubagentCounts(subagentProfiles) : undefined,
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
    class="flex min-h-7 min-w-0 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent"
  >
    {#if Icon}
      <Icon
        class="size-3.5 flex-none text-muted-foreground"
        aria-hidden="true"
      />
    {/if}
    <span class="min-w-0 flex-1 truncate">
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
        label={`Reset ${row.label} to the inherited setting`}
        onclick={row.reset}
      />
    {/if}
    {#if row.configure}
      <IconAction
        icon={Settings2}
        label={`Configure ${row.label}`}
        onclick={row.configure}
      />
    {/if}
    <Switch
      checked={row.enabled}
      disabled={disabled || loading || Boolean(row.lockedBy)}
      aria-label={`Enable ${row.label} for this conversation`}
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

{#snippet subagentList()}
  {#if error}
    <p class="px-1.5 text-warning" role="alert">{error}</p>
  {:else if loading && !configuration}
    <div class="grid gap-1" aria-hidden="true">
      <Skeleton class="h-7 w-full" /><Skeleton class="h-7 w-full" />
    </div>
  {:else}
    {#if subagentControlsEnabled}
      {@render delegationRow()}
    {:else}
      <p class="px-1.5 text-muted-foreground">
        Sub-agents can't delegate. Configure profiles in the lead conversation.
      </p>
    {/if}
    {#if !subagentProfiles || subagentProfiles.length === 0}
      <p class="px-1.5 text-muted-foreground">
        No sub-agent profiles are available.
      </p>
    {:else}
      {@const delegationOff = subagentRow?.enabled === false}
      {#each subagentProfiles as profile (profile.name)}
        {@const unavailable = Boolean(profile.disabled || profile.error)}
        {@const enabledSource =
          configuration?.resolution.provenance[
            `/subagents/${escape(profile.name)}/enabled`
          ]}
        <div
          class="flex min-h-7 min-w-0 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent"
        >
          <span
            class={`min-w-0 flex-1 truncate ${unavailable || delegationOff ? "text-muted-foreground" : ""}`}
            title={profile.error ?? profile.description}
          >
            {profile.label}
          </span>
          {#if profile.error}
            <span
              class="inline-flex flex-none text-warning"
              role="img"
              aria-label={profile.error}
              title={profile.error}
            >
              <TriangleAlert class="size-3.5" aria-hidden="true" />
            </span>
          {:else if profile.disabled}
            <span class="flex-none text-xs text-muted-foreground">Off</span>
          {/if}
          {#if configuration?.overrides.subagents?.[profile.name]}
            <IconAction
              icon={RotateCcw}
              label={`Reset ${profile.label} launch choices; requirements remain effective`}
              onclick={() =>
                onPatch?.({}, [`/overrides/subagents/${escape(profile.name)}`])}
            />
          {/if}
          <IconAction
            icon={Settings2}
            label={`Configure ${profile.label}`}
            onclick={() => openSettings("sub-agents")}
          />
          <Switch
            aria-label={`Enable ${profile.label} launches`}
            checked={configuration?.resolution.settings.subagents?.[
              profile.name
            ]?.enabled ?? !profile.disabled}
            disabled={disabled ||
              loading ||
              unavailable ||
              !subagentControlsEnabled ||
              enabledSource?.source === "requirement"}
            onCheckedChange={(enabled) =>
              onPatch?.({ subagents: { [profile.name]: { enabled } } })}
          />
        </div>
      {/each}
    {/if}
  {/if}
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

    {#if showSearch}
      <PopoverSearch>
        <SearchInput
          bind:value={query}
          placeholder={tab === "skills" ? "Filter skills" : "Filter tools"}
          ariaLabel={tab === "skills" ? "Filter skills" : "Filter tools"}
        />
      </PopoverSearch>
    {/if}

    <PopoverBody
      class="gap-0"
      stableHeight={tab === "subagents" ? undefined : bodyHeight}
    >
      {#if tab === "tools"}
        {@render capabilityList(optionalToolRows, "tools")}
      {:else if tab === "skills"}
        {@render capabilityList(skillRows, "skills")}
      {:else}
        {@render subagentList()}
      {/if}
    </PopoverBody>
  </Popover>
{/each}
