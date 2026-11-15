<script lang="ts">
// One section of an extension tool's card, rendered by its declared type.
import Markdown from "@nervekit/ui-kit/renderers/markdown/Markdown.svelte";
import type { QuickScriptArtifact } from "@nervekit/contracts/tools";
import type { ExtensionSectionView } from "../views/tool-view-types";
import { COLLAPSED_LINES } from "../views/tool-result-view";
import {
  displayArtifactHandles,
  displayLinks,
  displayTable,
} from "../views/extension-display";
import ArtifactList from "./ArtifactList.svelte";
import ToolOutputBlock from "./ToolOutputBlock.svelte";

type Props = {
  section: ExtensionSectionView;
  /** Artifacts the call wrote; an `artifacts` section shows those its value names (else all). */
  artifacts: QuickScriptArtifact[];
  /** Shows the section's label above it. */
  labelled?: boolean;
  expanded?: boolean;
  onOpenFile?: (path: string, line?: number) => void;
};
let {
  section,
  artifacts,
  labelled = false,
  expanded = false,
  onOpenFile,
}: Props = $props();

const value = $derived(section.value);
const text = $derived(typeof value === "string" ? value : "");
const links = $derived(
  section.type === "links"
    ? expanded
      ? displayLinks(value)
      : displayLinks(value).slice(0, COLLAPSED_LINES)
    : [],
);
const table = $derived(
  section.type === "table" ? displayTable(value) : undefined,
);
const tableRows = $derived(
  table ? (expanded ? table.rows : table.rows.slice(0, COLLAPSED_LINES)) : [],
);
const shownArtifacts = $derived.by(() => {
  if (section.type !== "artifacts") return [];
  const handles = displayArtifactHandles(value);
  return handles.length > 0
    ? artifacts.filter((artifact) => handles.includes(artifact.handle))
    : artifacts;
});
const emptyList = $derived(
  (section.type === "links" || section.type === "table") &&
    Array.isArray(value) &&
    value.length === 0,
);

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
</script>

{#if labelled && section.label}
  <p class="m-0 px-3 pt-2 text-caption text-muted-foreground">
    {section.label}
  </p>
{/if}
{#if section.type === "links" && links.length > 0}
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
        <span class="min-w-0 flex-1 truncate text-foreground">{link.title}</span
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
{:else if section.type === "table" && table}
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
{:else if section.type === "artifacts" && shownArtifacts.length > 0}
  <ArtifactList artifacts={shownArtifacts} {onOpenFile} />
{:else if section.live && text}
  <!-- Streaming: follow the end of the text. -->
  <div class="px-2.5 py-2">
    <ToolOutputBlock {text} direction="tail" />
  </div>
{:else if section.type === "markdown" && text}
  {#if expanded}
    <div class="min-w-0 p-3">
      <Markdown {text} {onOpenFile} />
    </div>
  {:else}
    <div class="px-2.5 py-2">
      <ToolOutputBlock {text} language="markdown" direction="head" />
    </div>
  {/if}
{:else if section.type === "text" && text}
  <div class="px-2.5 py-2">
    <ToolOutputBlock {text} direction="head" {expanded} />
  </div>
{:else if emptyList}
  <p class="m-0 px-3 py-2 text-ui text-muted-foreground">No results.</p>
{/if}
