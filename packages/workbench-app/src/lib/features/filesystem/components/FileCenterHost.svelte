<script lang="ts">
import { FilePane } from "$lib/presentation/components/file";
import {
  openFilePane,
  toggleFileLineWrap,
} from "$lib/features/filesystem/state/file-tabs.svelte";
import {
  fileViewerPreferences,
  setHighlightSelectionMatches,
} from "$lib/features/filesystem/state/file-viewer-preferences.svelte";
import { openMarkdownMermaidPane } from "$lib/features/filesystem/state/mermaid-tabs.svelte";
import type { MermaidMarkdownBlock } from "@nervekit/ui-kit/core/components/mermaid-blocks";
import { fileSelectors } from "$lib/features/filesystem/state/file-selectors.svelte";

const activeCenterFileView = $derived(fileSelectors.activeCenterFileView);

function openLinkedFile(path: string, line?: number): void {
  if (!activeCenterFileView) return;
  void openFilePane({
    projectId: activeCenterFileView.projectId,
    path,
    line,
  });
}

function toggleLineWrap(): void {
  if (activeCenterFileView) toggleFileLineWrap(activeCenterFileView.id);
}

function toggleSelectionMatches(): void {
  setHighlightSelectionMatches(
    !fileViewerPreferences.highlightSelectionMatches,
  );
}

function openMermaid(block: MermaidMarkdownBlock): void {
  if (!activeCenterFileView) return;
  const content = activeCenterFileView.content;
  void openMarkdownMermaidPane({
    projectId: activeCenterFileView.projectId,
    path: content?.path ?? activeCenterFileView.path,
    relativePath: content?.relativePath,
    name: content?.name,
    block,
  });
}
</script>

<FilePane
  view={activeCenterFileView}
  onOpenFile={openLinkedFile}
  onOpenMermaid={openMermaid}
  highlightSelectionMatches={fileViewerPreferences.highlightSelectionMatches}
  onToggleSelectionMatches={toggleSelectionMatches}
  onToggleWrap={toggleLineWrap}
/>
