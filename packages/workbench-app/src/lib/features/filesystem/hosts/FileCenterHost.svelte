<script lang="ts">
import { untrack } from "svelte";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import { createHtmlPreview, revokeHtmlPreview } from "../api/filesystem.api";
import { createHtmlPreviewController } from "../state/html-preview-controller";
import { htmlPreviewAvailability } from "../state/html-preview-source";
import type { HtmlPreviewViewModel } from "$lib/presentation/files/file-pane-contracts";
import type { HtmlPreviewApproval } from "$lib/presentation/files/html-preview-message";
import { resolveFilePaneModel } from "$lib/presentation/files/file-pane-model";
import { FilePane } from "$lib/presentation/files";
import {
  openFilePane,
  saveFileView,
  toggleFileLineWrap,
  updateFileDraft,
} from "$lib/features/filesystem/state/file-tabs.svelte";
import {
  fileViewerPreferences,
  setHighlightSelectionMatches,
} from "$lib/application/workspace/file-viewer-preferences.svelte";
import { openMarkdownMermaidPane } from "$lib/features/filesystem/state/mermaid-tabs.svelte";
import type { MermaidMarkdownBlock } from "@nervekit/ui-kit/renderers/mermaid/mermaid-blocks";
import { fileSelectors } from "$lib/features/filesystem/state/file-selectors.svelte";

const activeCenterFileView = $derived(fileSelectors.activeCenterFileView);
let htmlPreview = $state.raw<
  HtmlPreviewViewModel & { pending?: HtmlPreviewApproval }
>({});
const htmlController = createHtmlPreviewController({
  create: createHtmlPreview,
  revoke: revokeHtmlPreview,
  changed: (state) => {
    htmlPreview = state;
  },
});
const htmlPreviewUnavailable = $derived(
  htmlPreviewAvailability(activeCenterFileView?.content),
);
$effect(() => {
  const view = activeCenterFileView;
  const model = view ? resolveFilePaneModel(view) : undefined;
  const source =
    view &&
    model?.renderKind === "html" &&
    model.displayMode === "rendered" &&
    !htmlPreviewUnavailable
      ? {
          key: view.id,
          projectId: view.projectId,
          path: view.content!.relativePath!,
          text: view.draft ?? view.content?.text ?? "",
        }
      : undefined;
  untrack(() => htmlController.activate(source));
});
$effect(() => () => htmlController.dispose());

function htmlResourceMessage(data: unknown) {
  htmlController.resource(data, window.location.origin);
}

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

function changeDraft(text: string): void {
  if (activeCenterFileView) updateFileDraft(activeCenterFileView.id, text);
}

function save(): void {
  if (activeCenterFileView) void saveFileView(activeCenterFileView.id);
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
  onChange={changeDraft}
  onSave={save}
  {htmlPreview}
  {htmlPreviewUnavailable}
  onHtmlResourceMessage={htmlResourceMessage}
  onRetryHtmlPreview={() => htmlController.retry()}
/>

{#if htmlPreview.pending}
  {@const candidate = htmlPreview.pending}
  {#key candidate}
    <ConfirmDialog
      open={true}
      title={`Allow remote ${candidate.category}?`}
      description={`Allow ${candidate.category} resources from ${candidate.origin} for this preview only? ${candidate.category === "script" ? "This code executes in the preview and can transmit information through permitted resource loads. " : "Permitted loads can transmit information. "}Approval reloads the preview; permissions reset when the source or draft changes, or preview closes.`}
      confirmLabel="Allow and reload"
      cancelLabel="Keep blocked"
      onConfirm={() => htmlController.decide(true, candidate)}
      onCancel={() => htmlController.decide(false, candidate)}
      onOpenChange={(open) => {
        if (!open) htmlController.decide(false, candidate);
      }}
    />
  {/key}
{/if}
