<script lang="ts">
import ExtensionFrame from "./ExtensionFrame.svelte";
import { contributionsOf } from "../state/extension-ui.svelte";
import { openExtensionPage } from "../state/page-tabs.svelte";
import type { ExtensionPreview } from "../model/preview-selection";

let {
  projectId,
  preview,
  filePath,
  mode,
  instance,
  onFileWritten,
}: {
  projectId: string;
  preview: ExtensionPreview;
  /** Project-relative path of the file. */
  filePath: string;
  mode: "preview" | "edit";
  /** Identifies the file tab for the frame's persisted view state. */
  instance: string;
  onFileWritten?: (size: number) => void;
} = $props();

const baseCssUrl = $derived(contributionsOf(projectId)?.baseCssUrl);
</script>

{#if baseCssUrl}
  <ExtensionFrame
    {projectId}
    extensionId={preview.extensionId}
    extensionName={preview.extensionName}
    contribution={{ kind: "preview", id: preview.id, edit: preview.edit }}
    frameUrl={preview.frameUrl}
    {baseCssUrl}
    title={`${preview.label} preview: ${filePath}`}
    {instance}
    {filePath}
    {mode}
    onOpenPage={(id, params) =>
      openExtensionPage(projectId, preview.extensionId, id, params)}
    {onFileWritten}
  />
{/if}
