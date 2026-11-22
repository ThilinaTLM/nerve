<!--
  One origin group: caption (origin icon, name, count) on the left with a hover
  tooltip saying where the group comes from; the layer column labels on the
  right, aligned with every row's LayerSwitches. Order groups Project, User,
  other sources, Built-in. An empty group is hidden unless `emptyText` is given
  (the user can add to it).
-->
<script lang="ts">
import Blocks from "@lucide/svelte/icons/blocks";
import BriefcaseBusiness from "@lucide/svelte/icons/briefcase-business";
import UserIcon from "@lucide/svelte/icons/circle-user";
import Globe from "@lucide/svelte/icons/globe";
import Package from "@lucide/svelte/icons/package";
import type { Snippet } from "svelte";
import { GroupLabel } from "@nervekit/ui-kit/components/composites/group-label";
import ColumnLabels from "./ColumnLabels.svelte";
import HoverTip from "./HoverTip.svelte";
import { originLabel, originTip, type SettingsOrigin } from "./settings-origin";
import SettingsEmptyState from "./SettingsEmptyState.svelte";
import SettingsList from "./SettingsList.svelte";

type Props = {
  origin: SettingsOrigin;
  count?: number;
  /** The open project's name; without one there is no project column. */
  projectName?: string;
  /** Show the column labels (lists with LayerSwitches). */
  layers?: boolean;
  /** Overrides the origin's tooltip copy. */
  note?: string;
  /** Rows end with a chevron slot (lists); cards do not. */
  chevron?: boolean;
  /** Wrap children in a SettingsList; off for card stacks. */
  list?: boolean;
  /** Shown instead of the rows while the group is empty, with its add action. */
  emptyText?: string;
  emptyDescription?: string;
  emptyAction?: Snippet;
  actions?: Snippet;
  children: Snippet;
};

let {
  origin,
  count,
  projectName,
  layers = true,
  note,
  chevron = true,
  list = true,
  emptyText,
  emptyDescription,
  emptyAction,
  actions,
  children,
}: Props = $props();

const label = $derived(originLabel(origin, projectName));
const tip = $derived(note ?? originTip(origin, projectName));
const icon = $derived(
  origin.kind === "project"
    ? BriefcaseBusiness
    : origin.kind === "user"
      ? UserIcon
      : origin.kind === "builtin"
        ? Package
        : origin.kind === "agent-browser"
          ? Globe
          : Blocks,
);
</script>

{#if count !== 0 || emptyText}
  <section class="grid gap-1.5">
    <div class="flex min-h-6 items-end gap-2 pr-3 pl-1">
      <div class="flex min-w-0 flex-1 items-center">
        <HoverTip {tip}><GroupLabel {label} {count} {icon} /></HoverTip>
      </div>
      {#if actions}{@render actions()}{/if}
      {#if layers && count !== 0}
        <ColumnLabels
          {chevron}
          {projectName}
          projectOnly={origin.kind === "project"}
        />
      {/if}
    </div>
    {#if count === 0 && emptyText}
      <SettingsEmptyState
        variant="card"
        title={emptyText}
        description={emptyDescription}
        actions={emptyAction}
      />
    {:else if list}
      <SettingsList ariaLabel={label}>
        {@render children()}
      </SettingsList>
    {:else}
      <div class="grid gap-3">{@render children()}</div>
    {/if}
  </section>
{/if}
