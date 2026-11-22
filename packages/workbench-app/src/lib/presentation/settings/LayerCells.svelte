<!--
  The layer columns of a table row: [User] [project], each a fixed equal-width
  cell with its content centered. Column labels (ColumnLabels), switches
  (LayerSwitches), radios and the "Enabled" rows of detail pages all render
  through it, so a label and its control always line up. Without a project
  there is only the User cell.
-->
<script lang="ts">
import type { Snippet } from "svelte";

type Props = {
  /** The open project's name; without one there is only the User cell. */
  projectName?: string;
  user?: Snippet;
  project?: Snippet;
};

let { projectName, user, project }: Props = $props();

// One width for every layered table on a page (`w-24`).
const CELL = "relative flex h-full w-24 flex-none items-center justify-center";
</script>

<div class="flex flex-none items-center">
  <div class={CELL}>
    {#if user}{@render user()}{/if}
  </div>
  {#if projectName}
    <div class={CELL}>
      {#if project}{@render project()}{/if}
    </div>
  {/if}
</div>
