<!--
  A value setting with wide controls (selects, model picker, inputs). Without a
  project column: today's row (label left, one control column). With one: the
  label and description take the full width and the controls sit below in two
  equal halves, User then the project, under the section's `splitLabels`
  (`SplitColumns`). Each half is [control][↺ slot], so the halves are equal and
  the ↺ sits inside its own half. The ↺ belongs to value cells only. While the
  project column is hidden, `overriddenIn` puts a small marker after the title.
  An untrusted project file needs nothing here: the caller disables the project
  control and shows User's value, and the column label carries the one lock.
-->
<script lang="ts">
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import type { Snippet } from "svelte";
import IconAction from "@nervekit/ui-kit/components/composites/icon-action";
import ProjectOverrideMark from "./ProjectOverrideMark.svelte";

type Reset = { label: string; onReset: () => void };

type Props = {
  label: string;
  description?: string;
  hint?: Snippet;
  user: Snippet;
  project?: Snippet;
  userReset?: Reset;
  projectReset?: Reset;
  /** The open project's name while its column is shown; without it the row has a single control. */
  projectName?: string;
  /** The project overrides this row while its column is hidden: this is its name. */
  overriddenIn?: string;
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
  overriddenIn,
  userAbsent = false,
  projectNote,
}: Props = $props();
</script>

{#snippet reset(r: Reset | undefined)}
  <span class="flex w-7 flex-none items-center justify-center">
    {#if r}<IconAction
        icon={RotateCcw}
        label={r.label}
        onclick={r.onReset}
      />{/if}
  </span>
{/snippet}

{#snippet text()}
  <div class="grid min-w-0 flex-1 gap-0.5">
    <span class="flex min-w-0 items-center gap-1.5 text-ui">
      {label}
      {#if overriddenIn && !projectName}
        <ProjectOverrideMark projectName={overriddenIn} />
      {/if}
    </span>
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
        {:else}
          <div class="flex min-w-0 flex-1"></div>
        {/if}
        {@render reset(userAbsent ? undefined : userReset)}
      </div>
      <div class="flex min-w-0 items-center gap-1">
        {#if projectNote || !project}
          <span class="min-w-0 flex-1 text-caption text-muted-foreground"
            >{projectNote}</span
          >
          {@render reset(undefined)}
        {:else}
          <div class="flex min-w-0 flex-1">{@render project()}</div>
          {@render reset(projectReset)}
        {/if}
      </div>
    </div>
  </div>
{/if}
