<script lang="ts">
import CardSheet from "../../cards/CardSheet.svelte";
import { inCardSheet } from "../../cards/sheet-context";
import type {
  ToolCallDisplayRecord,
  ToolView,
} from "../views/tool-result-view";
import TodoChecklist from "./TodoChecklist.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "todos" }>;
};
let { toolCall, view }: Props = $props();

// Inside the card the checklist rows are sheet sections; standalone (details
// dialog) they get their own sheet.
const inSheet = inCardSheet();
// todos_set's checklist is the card's persistent argument body (enriched with
// this result by ToolArgumentBody), so inside the card it is not rendered again.
const ownedByArgument = $derived(inSheet && toolCall.toolName === "todos_set");
</script>

{#snippet checklist()}
  {#if view.items.length > 0}
    <TodoChecklist items={view.items} />
  {:else if toolCall.status === "completed"}
    <TodoChecklist items={[]} emptyLabel="No todos." />
  {/if}
{/snippet}

{#if ownedByArgument}
  <!-- Rendered by the persistent argument body. -->
{:else if inSheet}
  {@render checklist()}
{:else if view.items.length > 0 || toolCall.status === "completed"}
  <CardSheet>{@render checklist()}</CardSheet>
{/if}
