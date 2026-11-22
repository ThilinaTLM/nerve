<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { GroupLabel } from "@nervekit/ui-kit/components/composites/group-label";
import Pin from "@lucide/svelte/icons/pin";
import FolderIcon from "@lucide/svelte/icons/folder";
import KeyboardIcon from "@lucide/svelte/icons/keyboard";
import MonitorIcon from "@lucide/svelte/icons/monitor";
import AlertTriangleIcon from "@lucide/svelte/icons/triangle-alert";
import MinusIcon from "@lucide/svelte/icons/minus";
import PlusIcon from "@lucide/svelte/icons/plus";
import { onDestroy } from "svelte";
import {
  FloatingLayer,
  FloatingNotice,
  FloatingPanel,
  FloatingToolbar,
  FloatingToolbarButton,
  FloatingToolbarGroup,
  FloatingToolbarText,
} from "@nervekit/ui-kit/components/composites/floating-toolbar";
import { FloatingToolbarMenu } from "@nervekit/ui-kit/components/composites/floating-toolbar-menu";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import Copy from "@lucide/svelte/icons/copy";
import Download from "@lucide/svelte/icons/download";
import Maximize2 from "@lucide/svelte/icons/maximize-2";
import Scan from "@lucide/svelte/icons/scan";
import Search from "@lucide/svelte/icons/search";
import WrapText from "@lucide/svelte/icons/wrap-text";
import X from "@lucide/svelte/icons/x";
import ZoomIn from "@lucide/svelte/icons/zoom-in";
import ZoomOut from "@lucide/svelte/icons/zoom-out";
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
let specimenFind = $state(true);
let specimenWrap = $state(false);

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
  { id: "a", label: "Plain row", detail: undefined, icon: FolderIcon },
  {
    id: "b",
    label: "Selected row",
    detail: "Tint, medium label and a brand icon.",
    icon: MonitorIcon,
  },
  {
    id: "c",
    label: "Another option",
    detail: "Secondary line",
    icon: FolderIcon,
  },
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
    title="Messages and labels"
    description="Group captions above rows, and tinted callouts for settings, dialogs and panels."
  >
    <GallerySpecimen
      title="GroupLabel"
      source="composites/group-label"
      description="The quiet caption above a group of rows: sentence case, optional icon and count."
      layout="stack"
    >
      <GroupLabel label="Pinned" icon={Pin} count={1} />
      <GroupLabel label="Today" count={24} />
      <GroupLabel label="Connections" />
    </GallerySpecimen>

    <GallerySpecimen
      title="Callout"
      source="composites/callout"
      description="Six status tones in block layout, plus a compact panel strip."
      layout="stack"
    >
      <Callout layout="block" tone="neutral" text="No changes pending." />
      <Callout layout="block" tone="brand" text="Your default workspace." />
      <Callout
        layout="block"
        tone="info"
        text="Changes apply to new conversations."
      />
      <Callout layout="block" tone="success" text="Settings saved." />
      <Callout
        layout="block"
        tone="warning"
        text="Review permissions before continuing."
      />
      <Callout
        layout="block"
        tone="destructive"
        title="Connection failed"
        text="The provider could not be reached."
      >
        {#snippet actions()}<Button size="sm" variant="outline" onclick={noop}
            >Retry</Button
          >{/snippet}
      </Callout>
      <Callout
        layout="strip"
        tone="warning"
        icon={AlertTriangleIcon}
        text="Some panel data may be out of date."
      />
    </GallerySpecimen>
  </GalleryGroup>
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
          viewportClass="h-full"
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
      description="Floating chrome of a pane: a FloatingLayer with four anchors. Top start: identity; top end: actions, with a find panel stacked below; bottom end: icon-only zoom bar; bottom start: notices. Toggle find to see the motion."
      layout="bare"
    >
      <div
        class="group/pane relative h-72 w-full max-w-2xl overflow-hidden rounded-md border bg-well"
      >
        <p class="p-3 pt-14 text-ui text-muted-foreground">
          Content scrolls under the floating chrome.
        </p>
        <FloatingLayer>
          {#snippet topStart()}
            <FloatingToolbar label="Details">
              <FloatingToolbarGroup collapse>
                <FloatingToolbarText>PNG · 180 × 180</FloatingToolbarText>
              </FloatingToolbarGroup>
            </FloatingToolbar>
          {/snippet}
          {#snippet topEnd()}
            <FloatingToolbar label="Actions">
              <FloatingToolbarGroup>
                <FloatingToolbarButton
                  label="Find"
                  shortcut="Ctrl+F"
                  icon={Search}
                  pressed={specimenFind}
                  onclick={() => (specimenFind = !specimenFind)}
                />
                <FloatingToolbarButton
                  label="Wrap lines"
                  icon={WrapText}
                  pressed={specimenWrap}
                  onclick={() => (specimenWrap = !specimenWrap)}
                />
              </FloatingToolbarGroup>
              <FloatingToolbarGroup>
                <FloatingToolbarButton
                  label="Copy"
                  icon={Copy}
                  onclick={noop}
                />
                <FloatingToolbarButton label="Download" icon={Download} busy />
                <FloatingToolbarButton
                  label="Full screen"
                  shortcut="F"
                  icon={Maximize2}
                  onclick={noop}
                />
                <FloatingToolbarMenu>
                  <DropdownMenu.Item onSelect={noop}
                    >Open in tab</DropdownMenu.Item
                  >
                </FloatingToolbarMenu>
              </FloatingToolbarGroup>
            </FloatingToolbar>
            {#if specimenFind}
              <FloatingPanel
                label="Find"
                role="search"
                size="sm"
                onClose={() => (specimenFind = false)}
              >
                <div class="flex min-w-0 items-center gap-0.5">
                  <Input class="min-w-0 flex-1" placeholder="Find" />
                  <FloatingToolbarText live>3 of 12</FloatingToolbarText>
                  <FloatingToolbarButton
                    label="Close"
                    shortcut="Esc"
                    icon={X}
                    onclick={() => (specimenFind = false)}
                  />
                </div>
              </FloatingPanel>
            {/if}
          {/snippet}
          {#snippet bottomStart()}
            <FloatingNotice tone="warning" onDismiss={noop}
              >Preview loaded from a truncated file window.</FloatingNotice
            >
          {/snippet}
          {#snippet bottomEnd()}
            <FloatingToolbar label="Zoom" orientation="vertical">
              <FloatingToolbarGroup>
                <FloatingToolbarButton
                  label="Zoom in"
                  shortcut="+"
                  icon={ZoomIn}
                  onclick={noop}
                />
                <FloatingToolbarButton
                  label="Zoom out"
                  shortcut="-"
                  icon={ZoomOut}
                  onclick={noop}
                />
              </FloatingToolbarGroup>
              <FloatingToolbarGroup>
                <FloatingToolbarButton
                  label="Fit to view"
                  shortcut="0"
                  icon={Scan}
                  pressed
                  onclick={noop}
                />
              </FloatingToolbarGroup>
            </FloatingToolbar>
          {/snippet}
        </FloatingLayer>
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
      description="Plain, selected (tint, medium label, brand icon), highlighted (keyboard), and disabled. selectRowVariants carries the same states to custom rows."
      layout="stack"
      class="max-w-sm"
    >
      {#each rowOptions as option (option.id)}
        {#snippet icon()}<option.icon
            class="size-4"
            aria-hidden="true"
          />{/snippet}
        <SelectRow
          label={option.label}
          detail={option.detail}
          {icon}
          selected={selectedRow === option.id}
          onclick={() => (selectedRow = option.id)}
        />
      {/each}
      <SelectRow label="Highlighted (keyboard)" highlighted onclick={noop}>
        {#snippet icon()}<KeyboardIcon
            class="size-4"
            aria-hidden="true"
          />{/snippet}
      </SelectRow>
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
        <MermaidDiagram source={mermaid} class="h-full" />
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
