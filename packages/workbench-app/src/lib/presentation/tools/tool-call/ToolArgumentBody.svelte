<script lang="ts">
import type { ToolArgumentBody as ArgumentBody } from "../lifecycle/registry";
import { COLLAPSED_LINES } from "../views/tool-view-helpers";
import AtlassianDraftBody from "./AtlassianDraftBody.svelte";
import DiffSections from "./DiffSections.svelte";
import EntityList from "./EntityList.svelte";
import ResultCodeBlock from "./ResultCodeBlock.svelte";
import TodoChecklist from "./TodoChecklist.svelte";
import { StreamingText } from "@nervekit/ui-kit/components/composites/streaming-text";
import { getToolMotion } from "./tool-motion-context";
import { parseToolView } from "../views/tool-result-parser";
import { enrichEntities } from "./subagent-entities";
import type { ToolCallDisplayRecord } from "../views/tool-result-view";

type Props = {
  body: ArgumentBody;
  /** Settled call: entity rows are filled with its structured result. */
  toolCall?: ToolCallDisplayRecord;
  fixedRows?: number;
  highlight?: boolean;
  /** True while draft arguments are still streaming (skeleton placeholders). */
  streaming?: boolean;
  /**
   * The body is its own sheet section and pads itself. Bodies embedded in
   * another padded section (result views) leave this off.
   */
  section?: boolean;
};

let {
  body,
  toolCall,
  fixedRows = COLLAPSED_LINES,
  highlight = true,
  streaming = false,
  section = false,
}: Props = $props();

// Persistent checklist rows show the durable result's state once settled.
function checklistItems(items: Array<{ text: string; done: boolean }>) {
  const fromArgs = items.map((item) => ({ todo: item.text, done: item.done }));
  if (!toolCall) return fromArgs;
  const view = parseToolView(toolCall);
  return view.kind === "todos" && view.items.length > 0 ? view.items : fromArgs;
}

const pad = $derived(section ? "px-2.5 py-2" : "");

const toolMotion = getToolMotion();
const streamMotion = $derived(streaming && toolMotion.streamMotion);
</script>

{#if body.kind === "entities"}
  <EntityList
    items={toolCall ? enrichEntities(toolCall, body.items) : body.items}
    context={body.context}
    {streaming}
  />
{:else if body.kind === "diff-sections"}
  <DiffSections
    sections={body.sections}
    tail={body.tail}
    {fixedRows}
    {streaming}
  />
{:else if body.kind === "code"}
  <div class={`grid gap-1.5 ${pad}`}>
    {#if body.label}
      <p class="m-0 text-ui text-muted-foreground">{body.label}</p>
    {/if}
    <ResultCodeBlock
      code={body.text}
      language={body.language === "text" ? undefined : body.language}
      trim={false}
      highlight={highlight && body.language !== "text"}
      progressiveHighlight={streamMotion && body.language !== "text"}
      wrap
      overflow="hidden"
      tail={body.tail}
      {fixedRows}
      live={streaming}
      caret={streaming}
      {streamMotion}
    />
  </div>
{:else if body.kind === "diff"}
  <div class={`grid gap-1.5 ${pad}`}>
    {#if body.label}
      <p class="m-0 text-ui text-muted-foreground">{body.label}</p>
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
      live={streaming}
      caret={streaming}
      {streamMotion}
    />
  </div>
{:else if body.kind === "key-values"}
  <dl
    class={`m-0 grid gap-x-3 gap-y-1 text-ui sm:grid-cols-[max-content_minmax(0,1fr)] ${pad}`}
  >
    {#each body.items as item, index (`${item.label}:${index}`)}
      <dt class="text-muted-foreground">{item.label}</dt>
      <dd
        class="m-0 min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]"
        class:font-mono={item.mono}
        class:text-warning={item.tone === "warning"}
        class:text-destructive={item.tone === "destructive"}
        class:text-success={item.tone === "success"}
        class:text-info={item.tone === "info"}
      >
        <StreamingText text={item.value} fade={streamMotion} />
      </dd>
    {/each}
  </dl>
{:else if body.kind === "checklist"}
  <TodoChecklist items={checklistItems(body.items)} {streaming} />
{:else if body.kind === "atlassian-draft"}
  <AtlassianDraftBody {body} {streaming} {fixedRows} />
{:else if body.kind === "text-summary" || body.kind === "atlassian-summary"}
  <div class={`grid gap-1.5 ${pad}`}>
    {#if body.kind === "text-summary" && body.label}
      <p class="m-0 text-ui text-muted-foreground">{body.label}</p>
    {/if}
    <p
      class="m-0 whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]"
      class:font-mono={body.kind === "text-summary" && body.mono}
      class:text-ui={body.kind === "text-summary" && body.mono}
      class:text-body={body.kind !== "text-summary" || !body.mono}
      class:leading-relaxed={body.kind !== "text-summary" || !body.mono}
    >
      <StreamingText text={body.text} fade={streamMotion} />
    </p>
  </div>
{/if}
