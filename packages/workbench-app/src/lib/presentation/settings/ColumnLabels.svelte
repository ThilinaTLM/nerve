<!--
  The layer column labels, "User" then the project, over a list's switch slots
  (or, `wide`, over value cells). Hover explains the layer. Without a project
  there is one column; project-only lists hide the User label but keep its width.
-->
<script lang="ts">
import HoverTip from "./HoverTip.svelte";
import { projectColumnTip, USER_COLUMN_TIP } from "./settings-origin";

type Props = {
  /** The open project's name; without one only User exists. */
  projectName?: string;
  /** Value cells instead of switch slots. */
  wide?: boolean;
  /** Reserve the row chevron's width so labels sit over the controls. */
  chevron?: boolean;
  /** Project-defined items: the User column is empty, so its label is too. */
  projectOnly?: boolean;
};

let {
  projectName,
  wide = false,
  chevron = false,
  projectOnly = false,
}: Props = $props();

const columns = $derived([
  { id: "user", label: "User", tip: USER_COLUMN_TIP, hidden: projectOnly },
  ...(projectName
    ? [
        {
          id: "project",
          label: projectName,
          tip: projectColumnTip(projectName),
          hidden: false,
        },
      ]
    : []),
]);
</script>

<div
  class={[
    "flex flex-none items-center text-caption text-muted-foreground",
    wide && "gap-3",
  ]}
>
  {#each columns as column (column.id)}
    <span class={["flex justify-end", wide ? "w-52" : "w-20"]}>
      {#if !column.hidden}
        <HoverTip
          tip={column.tip}
          class={wide
            ? "max-w-52 justify-center truncate whitespace-nowrap"
            : "w-9 justify-center overflow-visible whitespace-nowrap"}
          >{column.label}</HoverTip
        >
      {/if}
    </span>
  {/each}
  {#if chevron}<span class="ml-2 w-4"></span>{/if}
</div>
