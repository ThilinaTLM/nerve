<script lang="ts">
// Sub-agent tool results: prompt, status and stop all render the same entity
// rows, one hairline-divided sheet section per sub-agent. Structured result
// details drive the rows; older transcripts fall back to the parsed text.
import CardSheet from "../../cards/CardSheet.svelte";
import { inCardSheet } from "../../cards/sheet-context";
import { parseStatusListing } from "../views/subagent-result-parser";
import type {
  ToolCallDisplayRecord,
  ToolView,
} from "../views/tool-result-view";
import EntityList from "./EntityList.svelte";
import {
  promptEntities,
  statusEntities,
  stopEntities,
  subagentDetails,
} from "./subagent-entities";
import ToolOutputBlock from "./ToolOutputBlock.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "subagent" }>;
  expanded?: boolean;
  onOpenFile?: (path: string, line?: number) => void;
};
let { toolCall, view, expanded = false }: Props = $props();

const inSheet = inCardSheet();
const details = $derived(subagentDetails(toolCall));

const items = $derived(
  view.action === "prompt"
    ? promptEntities(view, details)
    : view.action === "status"
      ? statusEntities(view, details)
      : stopEntities(view, details),
);
const context = $derived(
  view.action === "prompt" && view.context
    ? { label: "Shared context", text: view.context }
    : undefined,
);
const textOnly = $derived(
  view.action === "status" &&
    items.length === 0 &&
    Boolean(view.header) &&
    (!view.name || parseStatusListing(view.header).length === 0),
);
// Prompt and stop rows are the card's persistent argument body (enriched
// with this result by ToolArgumentBody), so inside the card they are not
// rendered a second time; standalone views render them here.
const ownedByArgument = $derived(inSheet && view.action !== "status");
const hasContent = $derived(
  !ownedByArgument &&
    (items.length > 0 ||
      textOnly ||
      (view.action === "status" && toolCall.status === "completed")),
);
</script>

{#snippet sections()}
  {#if textOnly && view.action === "status"}
    <p class="m-0 px-3 py-2 text-ui wrap-anywhere text-muted-foreground">
      {view.header}
    </p>
    {#if view.body}
      <div class="px-2.5 py-2">
        <ToolOutputBlock text={view.body} language="markdown" {expanded} />
      </div>
    {/if}
  {:else if items.length > 0}
    <EntityList {items} {context} {expanded} />
  {:else}
    <p class="m-0 px-3 py-2 text-ui text-muted-foreground">
      No sub-agents yet.
    </p>
  {/if}
{/snippet}

{#if hasContent}
  {#if inSheet}
    {@render sections()}
  {:else}
    <CardSheet>{@render sections()}</CardSheet>
  {/if}
{/if}
