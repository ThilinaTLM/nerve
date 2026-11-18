<script lang="ts">
import { notify } from "$lib/application/notifications/notify.svelte";
import { workspaceSelectors } from "$lib/application/workspace";
import {
  fileViewerPreferences,
  setExtensionPreviewChoice,
} from "$lib/application/workspace/file-viewer-preferences.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import {
  defaultPreviewChoice,
  ExtensionPreviewBar,
  ExtensionPreviewHost,
  contributionsOf,
  fileExtensionOf,
  matchingPreviews,
  previewKey,
  selectPreview,
} from "$lib/features/extension-ui";
import {
  refreshFilePane,
  toggleFileDisplayMode,
} from "$lib/features/filesystem";
import FileCenterHost from "$lib/features/filesystem/hosts/FileCenterHost.svelte";

// The file tab, plus the extension previews that match its type: an extension preview is a
// render kind of this tab, not another tab.
const tab = $derived.by(() => {
  const active = workspaceSelectors.activeCenterTab;
  return active?.kind === "file"
    ? workspaceSelectors.openFileTabs.find((model) => model.id === active.id)
    : undefined;
});
const projectId = $derived(workspaceState.selectedProjectId);
const path = $derived(tab?.relativePath);
const matches = $derived(
  path
    ? matchingPreviews(contributionsOf(projectId)?.previews ?? [], path)
    : [],
);
let tabChoices = $state<Record<string, string>>({});
let modes = $state<Record<string, "preview" | "edit">>({});
const selected = $derived(
  tab && path
    ? selectPreview({
        matches,
        tabChoice: tabChoices[tab.id],
        remembered:
          fileViewerPreferences.extensionPreviews[fileExtensionOf(path)],
      })
    : undefined,
);
const mode = $derived((tab && modes[tab.id]) || "preview");

function select(choice: string): void {
  if (!tab || !path) return;
  if (choice !== defaultPreviewChoice && tab.dirty) {
    notify.warning("File has unsaved changes", {
      description: "Save or discard your changes to open a preview.",
    });
    return;
  }
  tabChoices[tab.id] = choice;
  modes[tab.id] = "preview";
  setExtensionPreviewChoice(fileExtensionOf(path), choice);
}

function editSource(): void {
  if (!tab) return;
  tabChoices[tab.id] = defaultPreviewChoice;
  // Rendered built-in views (Markdown) switch to their source for editing.
  if (tab.displayMode === "rendered") toggleFileDisplayMode(tab.id);
}
</script>

{#if tab && projectId && path && matches.length > 0}
  <div class="flex h-full min-h-0 min-w-0 flex-col">
    <ExtensionPreviewBar
      previews={matches}
      {selected}
      {mode}
      onSelect={select}
      onModeChange={(next) => (modes[tab.id] = next)}
      onEditSource={editSource}
    />
    <div class="min-h-0 min-w-0 flex-1">
      {#if selected}
        {#key `${tab.id}:${previewKey(selected)}`}
          <ExtensionPreviewHost
            {projectId}
            preview={selected}
            filePath={path}
            {mode}
            instance={tab.id}
            onFileWritten={() => void refreshFilePane(tab.id)}
          />
        {/key}
      {:else}
        <FileCenterHost />
      {/if}
    </div>
  </div>
{:else}
  <FileCenterHost />
{/if}
