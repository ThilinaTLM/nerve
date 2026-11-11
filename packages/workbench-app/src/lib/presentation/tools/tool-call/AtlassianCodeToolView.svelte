<script lang="ts">
import CircleCheck from "@lucide/svelte/icons/circle-check";
import CircleX from "@lucide/svelte/icons/circle-x";
import ShieldAlert from "@lucide/svelte/icons/shield-alert";
import type { ToolCallDisplayRecord } from "../views/tool-result-view";
import type { ToolView } from "../views/tool-result-view";
import { COLLAPSED_LINES } from "../views/tool-result-view";
import { formatDuration } from "../views/tool-presentation-helpers";
import ArtifactList from "./ArtifactList.svelte";
import ToolOutputBlock from "./ToolOutputBlock.svelte";
import ToolSections from "./ToolSections.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "atlassian_code_mode" }>;
  expanded?: boolean;
  onOpenFile?: (path: string, line?: number) => void;
};
let { toolCall, view, expanded = false, onOpenFile }: Props = $props();

// The script itself is the card's persistent argument section.
const hostCalls = $derived(
  expanded ? view.hostCalls : view.hostCalls.slice(0, COLLAPSED_LINES),
);
const hiddenCalls = $derived(view.hostCalls.length - hostCalls.length);
const scriptFailed = $derived(
  view.status !== undefined && view.status !== "completed",
);
</script>

{#if view.output.length > 0 || view.hostCalls.length > 0 || view.artifacts.length > 0 || view.error || toolCall.status === "completed"}
  <ToolSections>
    {#if view.hostCalls.length > 0}
      <ul class="m-0 list-none p-0 py-1" aria-label="SDK calls">
        {#each hostCalls as call, index (index)}
          <li
            class="flex min-w-0 items-baseline gap-2 px-2.5 py-0.5 text-ui"
            title={call.error}
          >
            {#if call.outcome === "completed"}
              <CircleCheck
                class="size-3.5 flex-none translate-y-0.5 text-success"
                aria-label="Completed"
              />
            {:else if call.outcome === "denied"}
              <ShieldAlert
                class="size-3.5 flex-none translate-y-0.5 text-warning"
                aria-label="Denied"
              />
            {:else}
              <CircleX
                class="size-3.5 flex-none translate-y-0.5 text-destructive"
                aria-label="Failed"
              />
            {/if}
            <span class="flex-none font-mono text-foreground"
              >{call.method}</span
            >
            <span class="min-w-0 flex-1 truncate text-muted-foreground"
              >{call.outcome === "completed"
                ? (call.summary ?? "")
                : (call.error ?? call.summary ?? "")}</span
            >
            <span
              class="flex-none text-caption text-muted-foreground tabular-nums"
              >{formatDuration(call.durationMs)}</span
            >
          </li>
        {/each}
        {#if hiddenCalls > 0}
          <li class="px-2.5 py-0.5 text-caption text-muted-foreground">
            +{hiddenCalls} more
          </li>
        {/if}
      </ul>
    {/if}

    {#if view.output.length > 0}
      <div class="px-2.5 py-2" aria-label="Script output">
        <ToolOutputBlock
          text={view.output}
          direction="tail"
          {expanded}
          live={toolCall.status === "running"}
          terminal
        />
      </div>
    {:else if toolCall.status === "completed" && !scriptFailed}
      <div
        class="px-2.5 py-2 text-ui text-muted-foreground"
        aria-label="Script output"
      >
        No output.
      </div>
    {/if}

    {#if view.artifacts.length > 0}
      <ArtifactList artifacts={view.artifacts} {onOpenFile} />
    {/if}

    {#if scriptFailed}
      <p
        class="m-0 px-2.5 py-2 text-ui text-destructive [overflow-wrap:anywhere]"
      >
        {view.error ?? view.status?.replace("_", " ")}
      </p>
    {/if}
  </ToolSections>
{/if}
