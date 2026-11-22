<!--
  Quiet column labels of a layered table: "User" then the project, plain muted
  text (no icon, border, background or header row), each centered in the same
  fixed cell as the controls below it. They sit on the line directly above the
  card: an OriginGroup's caption line, a section's description or heading line,
  or a short line of their own (`SettingsSection` `layerLabels`). Hover explains
  the layer. While the project's settings file is untrusted the project label
  carries ONE lock, which stands for the whole column. Project-only lists show
  no labels (their caption names the project); a project-defined block hides
  the User label but keeps its width.
-->
<script lang="ts">
import Lock from "@lucide/svelte/icons/lock";
import HoverTip from "./HoverTip.svelte";
import LayerCells from "./LayerCells.svelte";
import {
  lockedColumnTip,
  projectColumnTip,
  USER_COLUMN_TIP,
} from "./settings-origin";

type Props = {
  /** The open project's name; the labels exist only with a project. */
  projectName: string;
  /** Reserve the row chevron's width so labels sit over the controls. */
  chevron?: boolean;
  /** Project-defined items: the User column is empty, so its label is too. */
  projectOnly?: boolean;
  /** The project's settings file is not trusted: its column is disabled. */
  locked?: boolean;
};

let {
  projectName,
  chevron = false,
  projectOnly = false,
  locked = false,
}: Props = $props();
</script>

{#snippet user()}
  {#if !projectOnly}
    <HoverTip tip={USER_COLUMN_TIP} class="max-w-full truncate">User</HoverTip>
  {/if}
{/snippet}
{#snippet project()}
  <HoverTip
    tip={locked ? lockedColumnTip(projectName) : projectColumnTip(projectName)}
    class="max-w-full"
  >
    <span class="flex items-center gap-1 truncate"
      >{#if locked}<Lock
          class="size-3 flex-none"
          aria-hidden="true"
        />{/if}<span class="truncate">Project</span></span
    >
  </HoverTip>
{/snippet}

<div class="flex flex-none items-center text-caption text-muted-foreground">
  <LayerCells {projectName} {user} {project} />
  {#if chevron}<span class="ml-2 w-4 flex-none"></span>{/if}
</div>
