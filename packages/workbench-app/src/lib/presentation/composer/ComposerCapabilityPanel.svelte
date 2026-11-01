<script lang="ts">
import { onMount } from "svelte";
import Lock from "@lucide/svelte/icons/lock";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import Settings from "@lucide/svelte/icons/settings";
import Settings2 from "@lucide/svelte/icons/settings-2";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import {
  PopoverBody,
  PopoverHeader,
  PopoverCommandList,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import type {
  CapabilityKind,
  CapabilityRow,
  ComposerCapabilities,
} from "./composer-capabilities.svelte.js";

/** One capability list (tools, skills or sub-agents), shared by the toolbar
 * capability popovers and the compact conversation-settings panel. Refreshes
 * the capabilities each time it opens. */
let {
  capabilities,
  kind,
  onBack,
}: {
  capabilities: ComposerCapabilities;
  kind: CapabilityKind;
  onBack?: () => void;
} = $props();

let query = $state("");
const inputs = $derived(capabilities.props);
const disabled = $derived(inputs.disabled ?? false);
const loading = $derived(inputs.loading ?? false);
const section = $derived(
  capabilities.sections.find((candidate) => candidate.kind === kind)!,
);
const rows = $derived(capabilities.rows(kind));

onMount(() => capabilities.props.onRefresh?.());
</script>

{#snippet capabilityRow(row: CapabilityRow)}
  {@const Icon = row.icon}
  <div
    class="flex min-h-control min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-0.5 hover:bg-hover"
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
      disabled={capabilities.rowDisabled(row)}
      busy={loading}
      aria-label={row.switchLabel ??
        `Enable ${row.label} for this conversation`}
      onclick={(event) => event.stopPropagation()}
      onCheckedChange={row.toggle}
    />
  </div>
{/snippet}

<PopoverHeader title={section.title} {onBack}>
  {#snippet actions()}
    {#if capabilities.overrideCount > 0}
      <Button
        size="icon-sm"
        variant="ghost"
        ariaLabel="Reset all conversation capability overrides"
        title={`Reset all ${capabilities.overrideCount} conversation capability override${capabilities.overrideCount === 1 ? "" : "s"}`}
        disabled={disabled || loading}
        onclick={() => inputs.onReset?.()}
      >
        <RotateCcw class="size-3.5" aria-hidden="true" />
      </Button>
    {/if}
    <Button
      size="icon-sm"
      variant="ghost"
      ariaLabel={`Open ${kind === "subagents" ? "sub-agent" : kind} settings`}
      title={`Open ${kind === "subagents" ? "sub-agent" : kind} settings`}
      onclick={() => capabilities.openSettings(kind)}
    >
      <Settings class="size-3.5" aria-hidden="true" />
    </Button>
  {/snippet}
</PopoverHeader>

{#if inputs.error}
  <PopoverBody
    ><p class="px-1.5 text-warning" role="alert">{inputs.error}</p></PopoverBody
  >
{:else if loading && !inputs.configuration}
  <PopoverBody
    ><div class="grid gap-1" aria-hidden="true">
      <Skeleton class="h-7 w-full" /><Skeleton class="h-7 w-full" />
    </div></PopoverBody
  >
{:else}
  {#if kind === "subagents"}
    <PopoverBody>
      {#if inputs.subagentControlsEnabled}
        {#if capabilities.delegationRow}
          {@render capabilityRow({
            ...capabilities.delegationRow,
            label: "Delegation",
          })}
        {:else}
          <p class="px-1.5 text-warning">Delegation is unavailable here.</p>
        {/if}
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
    isDisabled={(row) => capabilities.rowDisabled(row)}
    onChoose={(row) => capabilities.toggleRow(row)}
    empty={rows.length === 0
      ? kind === "tools"
        ? "No optional tools are available."
        : kind === "skills"
          ? "No skills are available for this project."
          : "No sub-agent profiles are available."
      : `No ${section.title.toLowerCase()} match.`}
  >
    {#snippet row(item)}
      {@render capabilityRow(item)}
    {/snippet}
  </PopoverCommandList>
{/if}
