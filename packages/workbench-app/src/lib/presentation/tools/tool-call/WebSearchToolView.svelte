<script lang="ts">
import type { ToolCallDisplayRecord } from "../views/tool-result-view";
import type { ToolView } from "../views/tool-result-view";
import { COLLAPSED_LINES } from "../views/tool-result-view";
import ToolSections from "./ToolSections.svelte";

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

<ToolSections>
  {#if view.answer}
    <div class="px-3 py-2">
      <p
        class="m-0 text-ui whitespace-pre-line text-muted-foreground [overflow-wrap:anywhere]"
        class:line-clamp-6={!expanded}
      >
        <span class="text-foreground">Answer</span> · {view.answer}
      </p>
    </div>
  {/if}

  {#each results as result, index (index)}
    <a
      class="group grid gap-0.5 px-2.5 py-1.5 text-inherit no-underline hover:bg-hover"
      href={result.url}
      target="_blank"
      rel="noreferrer"
      title={result.url}
    >
      <span class="flex min-w-0 items-baseline gap-2 text-ui">
        <span
          class="w-4 flex-none text-right font-mono text-muted-foreground tabular-nums"
          >{index + 1}</span
        >
        <span class="min-w-0 flex-1 truncate text-foreground"
          >{result.title}</span
        >
        <span class="flex-none font-mono text-muted-foreground"
          >{hostname(result.url)}</span
        >
      </span>
      {#if result.content}
        <span class="line-clamp-2 pl-6 text-ui text-muted-foreground"
          >{result.content}</span
        >
      {/if}
    </a>
  {/each}

  {#if results.length === 0 && !view.answer && toolCall.status === "completed"}
    <p class="m-0 px-3 py-2 text-ui text-muted-foreground">No results.</p>
  {/if}
</ToolSections>
