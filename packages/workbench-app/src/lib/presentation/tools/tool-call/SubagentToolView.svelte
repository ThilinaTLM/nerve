<script lang="ts">
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { getConversationUiCapabilities } from "../../context.svelte";
import { findSubagent, subagentLiveState } from "../views/subagent-live";
import type {
  ToolCallDisplayRecord,
  ToolView,
} from "../views/tool-result-view";
import ToolOutputBlock from "./ToolOutputBlock.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "subagent" }>;
  expanded?: boolean;
  onOpenFile?: (path: string, line?: number) => void;
};
let { toolCall, view, expanded = false }: Props = $props();

const subagents = getConversationUiCapabilities().subagents;
const agents = $derived(subagents?.list() ?? []);

let contextOpen = $state(false);
let openPrompts = $state<Record<string, boolean>>({});

function stateTone(state: string) {
  if (state.startsWith("running")) return "info" as const;
  if (state.startsWith("waiting")) return "warning" as const;
  if (state.startsWith("failed")) return "destructive" as const;
  return "neutral" as const;
}
</script>

{#if view.action === "prompt"}
  {#if view.assignments.length > 0}
    <ul class="m-0 grid list-none gap-1 p-0" aria-label="Assignments">
      {#each view.assignments as assignment (assignment.name)}
        {@const agent = findSubagent(agents, assignment.name)}
        {@const live = agent ? subagentLiveState(agent.status) : undefined}
        <li class="grid min-w-0 gap-1">
          <div class="flex min-w-0 items-center gap-2">
            <button
              type="button"
              class="inline-flex min-w-0 items-center gap-1 rounded-sm text-left text-sm"
              aria-expanded={openPrompts[assignment.name] ?? false}
              aria-label={`Assignment for ${assignment.name}`}
              onclick={() =>
                (openPrompts[assignment.name] = !openPrompts[assignment.name])}
            >
              <ChevronRight
                class={`size-3.5 flex-none text-muted-foreground transition-transform ${openPrompts[assignment.name] ? "rotate-90" : ""}`}
                aria-hidden="true"
              />
              <span class="truncate text-foreground">{assignment.name}</span>
            </button>
            {#if assignment.profile}
              <Badge variant="neutral">{assignment.profile}</Badge>
            {/if}
            {#if assignment.disposition}
              <span class="flex-none text-xs text-muted-foreground">
                {assignment.disposition === "created" ? "created" : "follow-up"}
              </span>
            {/if}
            <span class="min-w-0 flex-1"></span>
            {#if live}
              <Badge variant={live.tone}>{live.label}</Badge>
            {:else if assignment.queuedState}
              <Badge variant={stateTone(assignment.queuedState)}
                >{assignment.queuedState}</Badge
              >
            {/if}
            {#if agent && subagents}
              <Button
                size="xs"
                variant="outline"
                aria-label={`Open ${assignment.name}`}
                onclick={() => subagents.open(agent.id)}>Open</Button
              >
            {/if}
          </div>
          {#if openPrompts[assignment.name] && assignment.prompt}
            <ToolOutputBlock text={assignment.prompt} {expanded} />
          {/if}
        </li>
      {/each}
    </ul>
    {#if view.context}
      <div class="grid gap-1">
        <button
          type="button"
          class="inline-flex w-fit items-center gap-1 rounded-sm text-xs text-muted-foreground"
          aria-expanded={contextOpen}
          onclick={() => (contextOpen = !contextOpen)}
        >
          <ChevronRight
            class={`size-3.5 transition-transform ${contextOpen ? "rotate-90" : ""}`}
            aria-hidden="true"
          />
          Shared context
        </button>
        {#if contextOpen}
          <ToolOutputBlock text={view.context} {expanded} />
        {/if}
      </div>
    {/if}
  {/if}
{:else if view.action === "status"}
  {#if view.rows.length > 0}
    <ul class="m-0 grid list-none gap-1 p-0" aria-label="Sub-agents">
      {#each view.rows as row (row.name)}
        {@const agent = findSubagent(agents, row.name)}
        <li class="flex min-w-0 items-center gap-2 text-sm">
          <span class="truncate text-foreground">{row.name}</span>
          {#if row.profile}<Badge variant="neutral">{row.profile}</Badge>{/if}
          <Badge variant={stateTone(row.state)}>{row.state}</Badge>
          <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {[row.context ? `ctx ${row.context}` : undefined, row.activity]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {#if agent && subagents}
            <Button
              size="xs"
              variant="outline"
              aria-label={`Open ${row.name}`}
              onclick={() => subagents.open(agent.id)}>Open</Button
            >
          {/if}
        </li>
      {/each}
    </ul>
  {:else if view.header}
    <p class="m-0 truncate text-xs text-muted-foreground">{view.header}</p>
    {#if view.body}
      <ToolOutputBlock text={view.body} language="markdown" {expanded} />
    {/if}
  {:else if toolCall.status === "completed"}
    <p class="m-0 text-xs text-muted-foreground">No sub-agents yet.</p>
  {/if}
{:else if view.lines.length > 0}
  <ul class="m-0 grid list-none gap-0.5 p-0" aria-label="Stopped sub-agents">
    {#each view.lines as line (line.name)}
      <li class="flex min-w-0 items-baseline gap-2 text-sm">
        <span class="truncate text-foreground">{line.name}</span>
        <span class="text-xs text-muted-foreground">{line.outcome}</span>
      </li>
    {/each}
  </ul>
{/if}
