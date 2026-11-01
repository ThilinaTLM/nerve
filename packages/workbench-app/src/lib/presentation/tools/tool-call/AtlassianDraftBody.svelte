<script lang="ts">
// Jira/Confluence create and update draft: a fields section and a long-form
// section, kept from the first streamed byte through completion. Unknown values
// are skeleton slots that fade into text in place.
import { fade } from "svelte/transition";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import type { ToolArgumentBody as ArgumentBody } from "../lifecycle/registry";
import { COLLAPSED_LINES } from "../views/tool-view-helpers";
import { StreamingText } from "@nervekit/ui-kit/components/composites/streaming-text";
import { getToolMotion } from "./tool-motion-context";
import ResultCodeBlock from "./ResultCodeBlock.svelte";
import ToolSections from "./ToolSections.svelte";

type AtlassianDraftBody = Extract<ArgumentBody, { kind: "atlassian-draft" }>;

type Props = {
  body: AtlassianDraftBody;
  /** True while the draft is still streaming; enables skeleton placeholders. */
  streaming?: boolean;
  fixedRows?: number;
};
let { body, streaming = false, fixedRows = COLLAPSED_LINES }: Props = $props();

const toolMotion = getToolMotion();
const streamMotion = $derived(streaming && toolMotion.streamMotion);

const fields = $derived(
  body.fields.filter((field) => field.value !== undefined || streaming),
);
const showText = $derived(
  Boolean(body.text && (body.text.text !== undefined || streaming)),
);
</script>

<ToolSections>
  {#if fields.length > 0}
    <dl
      class="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 px-3 py-2 text-ui"
    >
      {#each fields as field (field.label)}
        <dt class="text-muted-foreground">{field.label}</dt>
        <dd
          class="m-0 min-w-0 text-foreground [overflow-wrap:anywhere]"
          class:font-mono={field.mono}
          class:text-warning={field.tone === "warning"}
          class:text-destructive={field.tone === "destructive"}
          class:text-success={field.tone === "success"}
          class:text-info={field.tone === "info"}
        >
          {#if field.value !== undefined}
            <span in:fade={{ duration: 220 }}
              ><StreamingText text={field.value} fade={streamMotion} /></span
            >
          {:else}
            <span class="inline-flex h-[1lh] items-center align-bottom">
              <Skeleton class="h-[0.7em] w-20 rounded-sm" />
            </span>
          {/if}
        </dd>
      {/each}
    </dl>
  {/if}

  {#if showText && body.text}
    {#if body.text.text !== undefined && body.text.language}
      <div class="grid gap-1.5 px-2.5 py-2">
        <span class="text-ui font-medium text-muted-foreground"
          >{body.text.label}</span
        >
        <ResultCodeBlock
          code={body.text.text}
          language={body.text.language}
          trim={false}
          highlight={!streaming}
          progressiveHighlight={streamMotion}
          live={streaming}
          caret={streaming}
          {streamMotion}
          wrap
          overflow="hidden"
          tail
          {fixedRows}
        />
      </div>
    {:else}
      <div class="px-3 py-2">
        <p
          class="m-0 line-clamp-3 text-ui whitespace-pre-line text-muted-foreground [overflow-wrap:anywhere]"
        >
          <span class="font-medium text-foreground">{body.text.label}</span> · {#if body.text.text !== undefined}
            <span in:fade={{ duration: 220 }}
              ><StreamingText text={body.text.text} fade={streamMotion} /></span
            >
          {:else}
            <span class="inline-flex h-[1lh] items-center align-bottom">
              <Skeleton class="h-[0.7em] w-64 max-w-full rounded-sm" />
            </span>
          {/if}
        </p>
      </div>
    {/if}
  {/if}
</ToolSections>
