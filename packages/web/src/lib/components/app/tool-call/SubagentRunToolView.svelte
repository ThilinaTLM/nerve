<script lang="ts">
  import Markdown from "../../../Markdown.svelte";
  import type { ToolCallRecord } from "../../../api";
  import type { ToolView } from "../../../tool-views/tool-result-view";
  import Disclosure from "./Disclosure.svelte";

  type Props = { toolCall: ToolCallRecord; view: Extract<ToolView, { kind: "subagent_run" }> };
  let { toolCall, view }: Props = $props();

  const context = $derived((toolCall.args as { context?: unknown })?.context);
</script>

{#if view.childAgentId}
  <p class="meta"><span class="meta-label">child</span> {view.childAgentId}</p>
{/if}
{#if view.summary}
  <div class="summary"><Markdown text={view.summary} /></div>
{/if}
{#if view.task || typeof context === "string"}
  <Disclosure label="task">
    {#if view.task}<p class="task">{view.task}</p>{/if}
    {#if typeof context === "string" && context.length > 0}<p class="task context">{context}</p>{/if}
  </Disclosure>
{/if}

<style>
  .meta {
    margin: 0;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }

  .meta-label {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
    margin-right: 0.3rem;
  }

  .summary {
    border-left: 2px solid color-mix(in oklab, var(--border) 80%, transparent);
    padding-left: 0.7rem;
  }

  .task {
    margin: 0 0 0.3rem;
    font-size: 0.8125rem;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .task.context {
    color: var(--muted-foreground);
  }
</style>
