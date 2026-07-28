<script lang="ts">
import type { ToolArgumentPresentation } from "../../lifecycle/registry";
import ToolArgumentBody from "./ToolArgumentBody.svelte";

type Props = {
  toolName: string;
  presentation: ToolArgumentPresentation;
  /** False when the card's argument section already shows the body. */
  includeBody?: boolean;
};

let { toolName, presentation, includeBody = true }: Props = $props();
</script>

<div class="grid gap-2" aria-label="Approval operation summary">
  <p class="m-0 text-sm font-medium text-foreground">
    {toolName}
    {#if presentation.primaryArg}
      <span class="font-normal text-muted-foreground"
        >— {presentation.primaryArg.text}</span
      >
    {/if}
  </p>
  {#if includeBody && presentation.body.kind !== "none"}
    <ToolArgumentBody body={presentation.body} />
  {/if}
  {#if presentation.safetyNotes.length > 0}
    <ul class="m-0 grid list-disc gap-1 pl-5 text-xs text-muted-foreground">
      {#each presentation.safetyNotes as note, index (`${note}:${index}`)}
        <li>{note}</li>
      {/each}
    </ul>
  {/if}
</div>
