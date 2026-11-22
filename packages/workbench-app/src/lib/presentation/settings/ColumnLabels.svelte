<!--
  The header row of a layered table: "User" then the project, each centered in
  the same fixed cell as the controls below it. Render it through
  `SettingsList`'s `columns` so it is the first row of the same card. Hover
  explains the layer. Without a project there is one column; project-only
  lists hide the User label but keep its width.
-->
<script lang="ts">
import HoverTip from "./HoverTip.svelte";
import LayerCells from "./LayerCells.svelte";
import { projectColumnTip, USER_COLUMN_TIP } from "./settings-origin";

type Props = {
  /** The open project's name; without one only User exists. */
  projectName?: string;
  /** Reserve the row chevron's width so labels sit over the controls. */
  chevron?: boolean;
  /** Project-defined items: the User column is empty, so its label is too. */
  projectOnly?: boolean;
};

let { projectName, chevron = false, projectOnly = false }: Props = $props();
</script>

{#snippet user()}
  {#if !projectOnly}
    <HoverTip tip={USER_COLUMN_TIP} class="max-w-full truncate">User</HoverTip>
  {/if}
{/snippet}
{#snippet project()}
  {#if projectName}
    <HoverTip tip={projectColumnTip(projectName)} class="max-w-full truncate"
      >{projectName}</HoverTip
    >
  {/if}
{/snippet}

<div class="flex flex-none items-center text-caption text-muted-foreground">
  <LayerCells {projectName} {user} {project} />
  {#if chevron}<span class="ml-2 w-4 flex-none"></span>{/if}
</div>
