<script lang="ts">
// Card body of a direct tool an extension contributes. The extension declares
// its view (sections and their types); the app renders each section with its
// own components and has no per-tool branch.
import type {
  ToolCallDisplayRecord,
  ToolView,
} from "../views/tool-result-view";
import {
  displayArtifactHandles,
  displayLinks,
  displayTable,
} from "../views/extension-display";
import ArtifactList from "./ArtifactList.svelte";
import ExtensionSection from "./ExtensionSection.svelte";
import ToolOutputBlock from "./ToolOutputBlock.svelte";
import ToolSections from "./ToolSections.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "extension" }>;
  expanded?: boolean;
  onOpenFile?: (path: string, line?: number) => void;
};
let { toolCall, view, expanded = false, onOpenFile }: Props = $props();

/** Sections with something to show. */
const shown = $derived(
  view.sections.filter((section) => {
    const value = section.value;
    switch (section.type) {
      case "text":
      case "markdown":
        return typeof value === "string" && value.length > 0;
      case "links":
        return Array.isArray(value) || displayLinks(value).length > 0;
      case "table":
        return Array.isArray(value) || displayTable(value) !== undefined;
      case "artifacts":
        return view.artifacts.length > 0;
    }
  }),
);
const hasArtifactSection = $derived(
  shown.some((section) => section.type === "artifacts"),
);
// Artifacts the call wrote that no `artifacts` section already shows.
const named = $derived(
  shown.flatMap((section) =>
    section.type === "artifacts" ? displayArtifactHandles(section.value) : [],
  ),
);
const otherArtifacts = $derived(
  hasArtifactSection && named.length === 0
    ? []
    : view.artifacts.filter((artifact) => !named.includes(artifact.handle)),
);
</script>

<ToolSections>
  {#each shown as section (section.id)}
    <ExtensionSection
      {section}
      artifacts={view.artifacts}
      labelled={shown.length > 1}
      {expanded}
      {onOpenFile}
    />
  {/each}

  {#if otherArtifacts.length > 0}
    <ArtifactList artifacts={otherArtifacts} {onOpenFile} />
  {/if}

  {#if shown.length === 0 && view.artifacts.length === 0 && !view.live}
    {#if view.resultText}
      <div class="px-2.5 py-2">
        <ToolOutputBlock text={view.resultText} direction="head" {expanded} />
      </div>
    {:else if toolCall.status === "completed"}
      <p class="m-0 px-3 py-2 text-ui text-muted-foreground">No output.</p>
    {/if}
  {/if}
</ToolSections>
