<script lang="ts">
import ListEnd from "@lucide/svelte/icons/list-end";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { StatusDot } from "@nervekit/ui-kit/components/composites/status-dot";
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

function stateTone(state: string) {
  if (state.startsWith("running")) return "info" as const;
  if (state.startsWith("waiting")) return "warning" as const;
  if (state.startsWith("failed")) return "destructive" as const;
  return "neutral" as const;
}
</script>

{#if view.action === "prompt"}
  {#if view.assignments.length > 0}
    <div class="@container overflow-hidden rounded-sm border bg-well">
      {#if view.context}
        <div class="border-b px-3 py-2">
          <p
            class={`m-0 text-xs text-muted-foreground whitespace-pre-line wrap-anywhere ${expanded ? "" : "line-clamp-2"}`}
          >
            <span class="font-medium text-foreground">Shared context</span>
            · {view.context}
          </p>
        </div>
      {/if}
      <ul class="m-0 grid list-none divide-y p-0" aria-label="Assignments">
        {#each view.assignments as assignment (assignment.name)}
          {@const agent = findSubagent(agents, assignment.name)}
          {@const live = agent ? subagentLiveState(agent.status) : undefined}
          {@const state =
            live ??
            (assignment.queuedState
              ? {
                  label: assignment.queuedState,
                  tone: stateTone(assignment.queuedState),
                }
              : undefined)}
          <li
            class="grid min-w-0 grid-cols-1 gap-2 px-3 py-2 @sm:grid-cols-[minmax(0,1fr)_auto] @sm:items-center @sm:gap-4"
          >
            <div class="min-w-0">
              <Tooltip.Provider delayDuration={200}>
                <div
                  class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
                >
                  <span
                    class="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-foreground"
                  >
                    {#if state}
                      <Tooltip.Root>
                        <Tooltip.Trigger
                          aria-label={`${assignment.name}: ${state.label}`}
                          class="inline-flex flex-none cursor-help items-center rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          <StatusDot tone={state.tone} size="xs" />
                        </Tooltip.Trigger>
                        <Tooltip.Content>{state.label}</Tooltip.Content>
                      </Tooltip.Root>
                    {/if}
                    <span class="wrap-anywhere">{assignment.name}</span>
                  </span>
                  {#if assignment.profile}
                    <span class="text-xs text-muted-foreground wrap-anywhere">
                      {assignment.profile}
                    </span>
                  {/if}
                  {#if assignment.disposition === "follow_up"}
                    <Tooltip.Root>
                      <Tooltip.Trigger
                        aria-label="Follow-up to existing subagent"
                        class="inline-flex flex-none cursor-help items-center rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <ListEnd class="size-3.5" aria-hidden="true" />
                      </Tooltip.Trigger>
                      <Tooltip.Content
                        >Follow-up to existing subagent</Tooltip.Content
                      >
                    </Tooltip.Root>
                  {/if}
                </div>
              </Tooltip.Provider>
              {#if assignment.prompt}
                <p
                  class={`m-0 mt-0.5 text-xs text-muted-foreground whitespace-pre-line wrap-anywhere ${expanded ? "" : "line-clamp-2"}`}
                >
                  {assignment.prompt}
                </p>
              {/if}
            </div>
            {#if agent && subagents}
              <div class="flex justify-end">
                <Button
                  size="xs"
                  variant="outline"
                  aria-label={`Open ${assignment.name}`}
                  onclick={() => subagents.open(agent.id)}>Open</Button
                >
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
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
