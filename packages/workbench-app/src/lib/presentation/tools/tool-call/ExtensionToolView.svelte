<script lang="ts">
// Result of a direct tool an extension contributes. The extension names how the
// result renders (`display.kind`); there is one renderer per kind and no
// per-tool branch.
import Markdown from "@nervekit/ui-kit/renderers/markdown/Markdown.svelte";
import type {
  ToolCallDisplayRecord,
  ToolView,
} from "../views/tool-result-view";
import { COLLAPSED_LINES } from "../views/tool-result-view";
import {
  displayArtifactHandles,
  displayLinks,
  displayTable,
} from "../views/extension-display";
import ArtifactList from "./ArtifactList.svelte";
import ToolOutputBlock from "./ToolOutputBlock.svelte";
import ToolSections from "./ToolSections.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "extension" }>;
  expanded?: boolean;
  onOpenFile?: (path: string, line?: number) => void;
};
let { toolCall, view, expanded = false, onOpenFile }: Props = $props();

const kind = $derived(view.display.kind);
const value = $derived(view.display.value);
// Text of the value for `text` and `markdown`; the agent-facing result text otherwise.
const bodyText = $derived(
  typeof value === "string" && value.length > 0 ? value : view.resultText,
);
const links = $derived(
  kind === "links"
    ? expanded
      ? displayLinks(value)
      : displayLinks(value).slice(0, COLLAPSED_LINES)
    : [],
);
const table = $derived(kind === "table" ? displayTable(value) : undefined);
const tableRows = $derived(
  table ? (expanded ? table.rows : table.rows.slice(0, COLLAPSED_LINES)) : [],
);
const handles = $derived(
  kind === "artifact" ? displayArtifactHandles(value) : [],
);
// Artifacts the call wrote; for `artifact`, those the value names (else all).
const artifacts = $derived(
  kind === "artifact" && handles.length > 0
    ? view.artifacts.filter((artifact) => handles.includes(artifact.handle))
    : view.artifacts,
);
const emptyList = $derived(
  (kind === "links" || kind === "table") &&
    Array.isArray(value) &&
    value.length === 0,
);
const rendered = $derived(
  (kind === "links" && displayLinks(value).length > 0) ||
    (kind === "table" && table !== undefined) ||
    (kind === "artifact" && artifacts.length > 0) ||
    ((kind === "text" || kind === "markdown") && Boolean(bodyText)),
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
  {#if kind === "links" && links.length > 0}
    {#each links as link, index (index)}
      <a
        class="group grid gap-0.5 px-2.5 py-1.5 text-inherit no-underline hover:bg-hover"
        href={link.url}
        target="_blank"
        rel="noreferrer"
        title={link.url}
      >
        <span class="flex min-w-0 items-baseline gap-2 text-ui">
          <span
            class="w-4 flex-none text-right font-mono text-muted-foreground tabular-nums"
            >{index + 1}</span
          >
          <span class="min-w-0 flex-1 truncate text-foreground"
            >{link.title}</span
          >
          <span class="flex-none font-mono text-muted-foreground"
            >{hostname(link.url)}</span
          >
        </span>
        {#if link.snippet}
          <span class="line-clamp-2 pl-6 text-ui text-muted-foreground"
            >{link.snippet}</span
          >
        {/if}
      </a>
    {/each}
  {:else if kind === "table" && table}
    <div class="min-w-0 overflow-x-auto px-2.5 py-2">
      <table class="w-full border-collapse text-left text-ui">
        <thead>
          <tr>
            {#each table.columns as column, index (index)}
              <th
                class="border-b border-border-subtle px-2 py-1 font-normal text-muted-foreground"
                >{column}</th
              >
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each tableRows as row, rowIndex (rowIndex)}
            <tr>
              {#each row as cell, cellIndex (cellIndex)}
                <td
                  class="px-2 py-1 align-top text-foreground [overflow-wrap:anywhere]"
                  >{cell}</td
                >
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else if kind === "artifact" && artifacts.length > 0}
    <ArtifactList {artifacts} {onOpenFile} />
  {:else if kind === "markdown" && bodyText}
    {#if expanded}
      <div class="min-w-0 p-3">
        <Markdown text={bodyText} {onOpenFile} />
      </div>
    {:else}
      <div class="px-2.5 py-2">
        <ToolOutputBlock text={bodyText} language="markdown" direction="head" />
      </div>
    {/if}
  {:else if kind === "text" && bodyText}
    <div class="px-2.5 py-2">
      <ToolOutputBlock text={bodyText} direction="head" {expanded} />
    </div>
  {/if}

  <!-- Files the call wrote that the value does not already show. -->
  {#if kind !== "artifact" && view.artifacts.length > 0}
    <ArtifactList artifacts={view.artifacts} {onOpenFile} />
  {/if}

  {#if !rendered && view.artifacts.length === 0}
    {#if emptyList}
      <p class="m-0 px-3 py-2 text-ui text-muted-foreground">No results.</p>
    {:else if view.resultText}
      <div class="px-2.5 py-2">
        <ToolOutputBlock text={view.resultText} direction="head" {expanded} />
      </div>
    {:else if toolCall.status === "completed"}
      <p class="m-0 px-3 py-2 text-ui text-muted-foreground">No output.</p>
    {/if}
  {/if}
</ToolSections>
