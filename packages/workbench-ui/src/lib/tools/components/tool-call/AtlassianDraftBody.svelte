<script lang="ts">
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import type { ToolArgumentBody as ArgumentBody } from "../../lifecycle/registry";
import ResultCodeBlock from "./ResultCodeBlock.svelte";

type AtlassianDraftBody = Extract<ArgumentBody, { kind: "atlassian-draft" }>;

type Props = {
  body: AtlassianDraftBody;
  /** True while the draft is still streaming; enables skeleton placeholders. */
  streaming?: boolean;
  fixedRows?: number;
};
let { body, streaming = false, fixedRows = 10 }: Props = $props();

const fields = $derived(
  body.fields.filter((field) => field.value !== undefined || streaming),
);
const showText = $derived(
  Boolean(body.text && (body.text.text !== undefined || streaming)),
);
</script>

{#snippet textSection()}
  {#if body.text}
    <div class="grid gap-1.5">
      <span class="text-xs font-medium text-muted-foreground"
        >{body.text.label}</span
      >
      {#if body.text.text !== undefined}
        <ResultCodeBlock
          code={body.text.text}
          language={body.text.language}
          trim={false}
          highlight={!streaming && Boolean(body.text.language)}
          wrap
          overflow="hidden"
          tail
          {fixedRows}
        />
      {:else}
        <Skeleton class="h-3 w-full" />
        <Skeleton class="h-3 w-2/3" />
      {/if}
    </div>
  {/if}
{/snippet}

{#if fields.length > 0}
  <div class="grid gap-1.5 rounded-sm border bg-sidebar px-2.5 py-2">
    <dl
      class="m-0 grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[max-content_minmax(0,1fr)]"
    >
      {#each fields as field (field.label)}
        <dt class="text-muted-foreground">{field.label}</dt>
        <dd
          class="m-0 min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]"
          class:font-mono={field.mono}
          class:text-warning={field.tone === "warning"}
          class:text-destructive={field.tone === "error"}
          class:text-success={field.tone === "success"}
          class:text-info={field.tone === "info"}
        >
          {#if field.value !== undefined}
            {field.value}
          {:else}
            <Skeleton class="h-3 w-24" />
          {/if}
        </dd>
      {/each}
    </dl>
    {#if showText}
      {@render textSection()}
    {/if}
  </div>
{:else if showText}
  {@render textSection()}
{/if}
