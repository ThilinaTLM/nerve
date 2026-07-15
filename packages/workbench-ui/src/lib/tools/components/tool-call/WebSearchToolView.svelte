<script lang="ts">
import Sparkles from "@lucide/svelte/icons/sparkles";
import type { ToolCallDisplayRecord } from "../../views/tool-result-view";
import type { ToolView } from "../../views/tool-result-view";
import { COLLAPSED_LINES } from "../../views/tool-result-view";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "web_search" }>;
  expanded?: boolean;
};
let { toolCall, view, expanded = false }: Props = $props();

const results = $derived(
  expanded ? view.results : view.results.slice(0, COLLAPSED_LINES),
);

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
</script>

{#if view.answer}
  <div class="grid gap-1 rounded-sm border bg-sidebar px-2.5 py-2">
    <span
      class="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
    >
      <Sparkles size={12} strokeWidth={2} class="text-info" />
      Answer
    </span>
    <p
      class="m-0 text-xs leading-normal text-sidebar-foreground"
      class:line-clamp-6={!expanded}
    >
      {view.answer}
    </p>
  </div>
{/if}

{#if results.length > 0}
  <ul
    class="m-0 grid list-none gap-0 divide-y overflow-hidden rounded-sm border bg-sidebar p-0"
  >
    {#each results as result, index (result.url)}
      <li>
        <a
          class="group flex flex-col gap-0.5 px-2.5 py-1.5 text-inherit no-underline hover:bg-muted/40"
          href={result.url}
          target="_blank"
          rel="noreferrer"
          title={result.url}
        >
          <span class="flex min-w-0 items-baseline gap-2">
            <span
              class="w-4 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground/70"
              >{index + 1}</span
            >
            <span
              class="min-w-0 flex-1 truncate text-xs font-medium text-foreground group-hover:underline"
              >{result.title}</span
            >
            <span class="shrink-0 font-mono text-xs text-muted-foreground"
              >{hostname(result.url)}</span
            >
          </span>
          {#if result.content}
            <span
              class="line-clamp-2 pl-6 text-xs leading-snug text-muted-foreground"
              >{result.content}</span
            >
          {/if}
        </a>
      </li>
    {/each}
  </ul>
{:else if !view.answer && toolCall.status === "completed"}
  <p class="m-0 text-xs text-muted-foreground">No results.</p>
{/if}
