<script lang="ts">
import MinusIcon from "@lucide/svelte/icons/minus";
import PlusIcon from "@lucide/svelte/icons/plus";
import { onDestroy } from "svelte";
import FloatingToolbar from "@nervekit/ui-kit/components/composites/floating-toolbar";
import { GithubMark } from "@nervekit/ui-kit/components/composites/github-mark";
import { HeightFollow } from "@nervekit/ui-kit/components/composites/height-follow";
import ScrollRegion from "@nervekit/ui-kit/components/composites/scroll-region";
import SelectRow from "@nervekit/ui-kit/components/composites/select-row";
import { StreamingText } from "@nervekit/ui-kit/components/composites/streaming-text";
import VirtualScroller from "@nervekit/ui-kit/components/composites/virtual-list";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Markdown from "@nervekit/ui-kit/renderers/markdown/Markdown.svelte";
import MermaidDiagram from "@nervekit/ui-kit/renderers/mermaid/MermaidDiagram.svelte";
import PlainText from "@nervekit/ui-kit/renderers/plain-text/PlainText.svelte";
import GalleryGroup from "../GalleryGroup.svelte";
import GallerySpecimen from "../GallerySpecimen.svelte";

const noop = () => {};

const lines = Array.from(
  { length: 24 },
  (_, i) => `src/lib/features/example/file-${i + 1}.ts`,
);
const virtualItems = Array.from({ length: 2000 }, (_, i) => ({
  id: i,
  label: `Item ${i + 1}`,
  detail: i % 3 === 0 ? "A longer row with secondary text" : undefined,
}));

/* ------------------------- Streaming / height follow ------------------------ */

const sampleText =
  "The workbench streams assistant output token by token, fading new text in as it arrives. ";
let streamed = $state(sampleText);
let streaming = $state(false);
let streamTimer: ReturnType<typeof setInterval> | undefined;

function toggleStream() {
  if (streaming) {
    clearInterval(streamTimer);
    streaming = false;
    return;
  }
  streaming = true;
  streamTimer = setInterval(() => {
    streamed += sampleText.slice(0, 12 + Math.floor(Math.random() * 20));
  }, 250);
}
function resetStream() {
  clearInterval(streamTimer);
  streaming = false;
  streamed = sampleText;
}
onDestroy(() => clearInterval(streamTimer));

let followItems = $state(2);

/* ------------------------------ Selectable rows ------------------------------ */

let selectedRow = $state("b");
const rowOptions = [
  { id: "a", label: "Plain row", detail: undefined },
  {
    id: "b",
    label: "Selected row",
    detail: "The current value reads as a tint.",
  },
  { id: "c", label: "Another option", detail: "Secondary line" },
];

/* -------------------------------- Renderers -------------------------------- */

const markdown = [
  "## Release notes",
  "",
  "Paragraph with **bold**, _italic_, `inline code` and a [link](https://example.com).",
  "",
  "- First item",
  "- Second item",
  "",
  "> A quoted note.",
  "",
  "| Name | State |",
  "| --- | --- |",
  "| build | passing |",
  "",
  "```ts",
  "export const answer: number = 42;",
  "```",
].join("\n");

const mermaid = [
  "flowchart LR",
  "  A[Prompt] --> B{Tool?}",
  "  B -->|yes| C[Run]",
  "  B -->|no| D[Reply]",
].join("\n");

const plain =
  "Plain text keeps whitespace\n  and wraps long unbroken content such as /home/user/some/very/long/path/that/keeps/going/and/going.txt";
</script>

<div class="flex flex-col gap-10">
  <GalleryGroup
    title="Scrolling"
    description="Edge-shadow regions and the virtualised list behind transcripts."
  >
    <GallerySpecimen
      title="ScrollRegion"
      source="composites/scroll-region"
      description="Overflow is stated by edge shadows instead of a scrollbar. `surface` must match the background."
      layout="stack"
    >
      <div class="flex flex-wrap gap-4">
        <div class="flex h-40 w-64 flex-col rounded-md border bg-card">
          <ScrollRegion surface="card" ariaLabel="Card region">
            <ul class="flex flex-col gap-1 p-2 font-mono text-ui">
              {#each lines as line (line)}<li>{line}</li>{/each}
            </ul>
          </ScrollRegion>
        </div>
        <div class="flex h-40 w-64 flex-col rounded-md border bg-popover">
          <ScrollRegion surface="popover" ariaLabel="Popover region">
            <ul class="flex flex-col gap-1 p-2 font-mono text-ui">
              {#each lines as line (line)}<li>{line}</li>{/each}
            </ul>
          </ScrollRegion>
        </div>
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="VirtualScroller"
      source="composites/virtual-list"
      description="2,000 rows, only the visible window mounted. Anchored to the start."
      layout="bare"
    >
      <div class="h-56 w-80 max-w-full rounded-md border bg-background">
        <VirtualScroller
          items={virtualItems}
          getKey={(item) => item.id}
          estimateSize={() => 32}
          viewportAriaLabel="Virtual rows"
          gap={2}
          paddingStart={4}
          paddingEnd={4}
        >
          {#snippet row({ item })}
            <div class="px-3 py-1 text-ui">
              <span class="text-foreground">{item.label}</span>
              {#if item.detail}
                <span class="block text-muted-foreground">{item.detail}</span>
              {/if}
            </div>
          {/snippet}
        </VirtualScroller>
      </div>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Overlay and motion helpers"
    description="Small composites used across panes."
  >
    <GallerySpecimen
      title="FloatingToolbar"
      source="composites/floating-toolbar"
      description="Pinned to the top-right of a content pane; content scrolls underneath."
      layout="bare"
    >
      <div
        class="relative h-32 w-96 max-w-full overflow-hidden rounded-md border bg-well"
      >
        <FloatingToolbar label="Diagram controls">
          <Button variant="ghost" size="icon-sm" aria-label="Zoom out"
            ><MinusIcon /></Button
          >
          <Button variant="ghost" size="icon-sm" aria-label="Zoom in"
            ><PlusIcon /></Button
          >
        </FloatingToolbar>
        <p class="p-3 text-ui text-muted-foreground">
          Content under the toolbar.
        </p>
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="StreamingText"
      source="composites/streaming-text"
      description="Appended text fades in; text present at mount is settled."
      layout="stack"
    >
      <div class="flex gap-2">
        <Button size="sm" variant="outline" onclick={toggleStream}
          >{streaming ? "Pause" : "Stream"}</Button
        >
        <Button size="sm" variant="ghost" onclick={resetStream}>Reset</Button>
      </div>
      <p class="max-w-xl text-ui"><StreamingText text={streamed} /></p>
    </GallerySpecimen>

    <GallerySpecimen
      title="HeightFollow"
      source="composites/height-follow"
      description="Height changes of the content animate with a spring while `active`."
      layout="stack"
    >
      <div class="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onclick={() => (followItems = Math.min(followItems + 1, 8))}
          ><PlusIcon data-icon="inline-start" />Add line</Button
        >
        <Button
          size="sm"
          variant="ghost"
          onclick={() => (followItems = Math.max(followItems - 1, 1))}
          ><MinusIcon data-icon="inline-start" />Remove</Button
        >
      </div>
      <HeightFollow active class="max-w-sm rounded-md border bg-card">
        <ul class="flex flex-col gap-1 p-3 text-ui">
          {#each Array.from({ length: followItems }, (_, i) => i) as i (i)}
            <li>Line {i + 1}</li>
          {/each}
        </ul>
      </HeightFollow>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Rows and marks"
    description="Selectable rows and brand glyph."
  >
    <GallerySpecimen
      title="SelectRow"
      source="composites/select-row"
      description="Plain, selected (tint), active (keyboard highlight), and disabled."
      layout="stack"
      class="max-w-sm"
    >
      {#each rowOptions as option (option.id)}
        <SelectRow
          label={option.label}
          detail={option.detail}
          selected={selectedRow === option.id}
          onclick={() => (selectedRow = option.id)}
        />
      {/each}
      <SelectRow label="Active (keyboard)" active onclick={noop} />
      <SelectRow label="Disabled" disabled onclick={noop} />
    </GallerySpecimen>

    <GallerySpecimen
      title="GithubMark"
      source="composites/github-mark"
      description="Sized and coloured like a Lucide icon."
    >
      <GithubMark class="size-3 text-muted-foreground" />
      <GithubMark class="size-4" />
      <GithubMark class="size-6 text-primary" />
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Renderers"
    description="Content renderers from ui-kit/renderers."
  >
    <GallerySpecimen
      title="Markdown"
      source="renderers/markdown/Markdown"
      layout="bare"
    >
      <Markdown text={markdown} onOpenFile={noop} />
    </GallerySpecimen>

    <GallerySpecimen
      title="MermaidDiagram"
      source="renderers/mermaid/MermaidDiagram"
      layout="bare"
    >
      <div class="h-64 w-full overflow-hidden rounded-md border">
        <MermaidDiagram source={mermaid} />
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="PlainText"
      source="renderers/plain-text/PlainText"
      layout="bare"
    >
      <PlainText text={plain} class="max-w-md text-ui" />
    </GallerySpecimen>
  </GalleryGroup>
</div>
