<!--
  A value setting with wide controls (selects, model picker, inputs). Without a
  project: today's row (label left, one control column). With one: the label
  and description take the full width and the controls sit below in two equal
  halves, User then the project, under the section's SplitColumns header. The ↺
  belongs to value cells only.
-->
<script lang="ts">
import Lock from "@lucide/svelte/icons/lock";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import type { Snippet } from "svelte";
import IconAction from "@nervekit/ui-kit/components/composites/icon-action";
import HoverTip from "./HoverTip.svelte";

type Reset = { label: string; onReset: () => void };

type Props = {
  label: string;
  description?: string;
  hint?: Snippet;
  user: Snippet;
  project?: Snippet;
  userReset?: Reset;
  projectReset?: Reset;
  /** The open project's name; without one the row has a single control. */
  projectName?: string;
  /** The project's settings file is not trusted: its control is locked. */
  locked?: boolean;
  /** The User layer does not exist (project-defined item); the cell stays empty. */
  userAbsent?: boolean;
  /** Muted text instead of the project control (does not apply there). */
  projectNote?: string;
};

let {
  label,
  description,
  hint,
  user,
  project,
  userReset,
  projectReset,
  projectName,
  locked = false,
  userAbsent = false,
  projectNote,
}: Props = $props();
</script>

{#snippet reset(r: Reset | undefined)}
  {#if r}<IconAction
      icon={RotateCcw}
      label={r.label}
      onclick={r.onReset}
    />{:else}<span class="w-7 flex-none"></span>{/if}
{/snippet}

{#snippet text()}
  <div class="grid min-w-0 flex-1 gap-0.5">
    <span class="text-ui">{label}</span>
    {#if description || hint}
      <span class="text-caption text-muted-foreground"
        >{description}
        {#if hint}{@render hint()}{/if}</span
      >
    {/if}
  </div>
{/snippet}

{#if !projectName}
  <div class="flex min-h-12 items-center gap-3 px-3 py-2">
    {@render text()}
    <div class="flex w-56 flex-none items-center justify-end gap-1">
      {#if userReset}<IconAction
          icon={RotateCcw}
          label={userReset.label}
          onclick={userReset.onReset}
        />{/if}
      <div class="flex min-w-0 flex-1 justify-end">{@render user()}</div>
    </div>
  </div>
{:else}
  <div class="grid gap-2 px-3 py-2.5">
    {@render text()}
    <div class="grid grid-cols-2 gap-3">
      <div class="flex min-w-0 items-center gap-1">
        {#if !userAbsent}
          <div class="flex min-w-0 flex-1">{@render user()}</div>
          {@render reset(userReset)}
        {/if}
      </div>
      <div class="flex min-w-0 items-center gap-1">
        {#if projectNote || !project}
          <span class="text-caption text-muted-foreground">{projectNote}</span>
        {:else if locked}
          <HoverTip
            delay={400}
            class="min-w-0 flex-1 items-center gap-1.5"
            tip={`Locked until you trust ${projectName}'s settings file. Uses User for now.`}
          >
            <Lock
              class="size-3.5 flex-none text-muted-foreground"
              aria-hidden="true"
            />
            <div class="flex min-w-0 flex-1">{@render project()}</div>
          </HoverTip>
          <span class="w-7 flex-none"></span>
        {:else}
          <div class="flex min-w-0 flex-1">{@render project()}</div>
          {@render reset(projectReset)}
        {/if}
      </div>
    </div>
  </div>
{/if}
