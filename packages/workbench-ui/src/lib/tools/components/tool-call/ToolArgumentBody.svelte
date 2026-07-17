<script lang="ts">
import type { ToolArgumentBody as ArgumentBody } from "../../lifecycle/registry";
import AtlassianDraftBody from "./AtlassianDraftBody.svelte";
import ResultCodeBlock from "./ResultCodeBlock.svelte";
import TodoChecklist from "./TodoChecklist.svelte";

type Props = {
  body: ArgumentBody;
  fixedRows?: number;
  highlight?: boolean;
  /** True while draft arguments are still streaming (skeleton placeholders). */
  streaming?: boolean;
};

let {
  body,
  fixedRows = 10,
  highlight = true,
  streaming = false,
}: Props = $props();
</script>

{#if body.kind === "code"}
  <div class="grid gap-1.5">
    {#if body.label}
      <p class="m-0 text-xs font-medium text-muted-foreground">{body.label}</p>
    {/if}
    <ResultCodeBlock
      code={body.text}
      language={body.language === "text" ? undefined : body.language}
      trim={false}
      highlight={highlight && body.language !== "text"}
      wrap
      overflow="hidden"
      tail={body.tail}
      {fixedRows}
    />
  </div>
{:else if body.kind === "diff"}
  <div class="grid gap-1.5">
    {#if body.label}
      <p class="m-0 text-xs font-medium text-muted-foreground">{body.label}</p>
    {/if}
    <ResultCodeBlock
      code={body.text}
      language="diff"
      trim={false}
      highlight={false}
      wrap
      overflow="hidden"
      tail={body.tail}
      {fixedRows}
    />
  </div>
{:else if body.kind === "key-values"}
  <dl
    class="m-0 grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]"
  >
    {#each body.items as item, index (`${item.label}:${index}`)}
      <dt class="text-muted-foreground">{item.label}</dt>
      <dd
        class="m-0 min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]"
        class:font-mono={item.mono}
        class:text-warning={item.tone === "warning"}
        class:text-destructive={item.tone === "error"}
        class:text-success={item.tone === "success"}
        class:text-info={item.tone === "info"}
      >
        {item.value}
      </dd>
    {/each}
  </dl>
{:else if body.kind === "checklist"}
  <TodoChecklist
    items={body.items.map((item) => ({ todo: item.text, done: item.done }))}
  />
{:else if body.kind === "atlassian-draft"}
  <AtlassianDraftBody {body} {streaming} {fixedRows} />
{:else if body.kind === "text-summary" || body.kind === "atlassian-summary"}
  <div class="grid gap-1.5">
    {#if body.kind === "text-summary" && body.label}
      <p class="m-0 text-xs font-medium text-muted-foreground">{body.label}</p>
    {/if}
    <p
      class="m-0 whitespace-pre-wrap text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]"
    >
      {body.text}
    </p>
  </div>
{/if}
