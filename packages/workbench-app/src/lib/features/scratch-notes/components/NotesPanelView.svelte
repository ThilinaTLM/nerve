<script lang="ts">
import NotebookPen from "@lucide/svelte/icons/notebook-pen";
import Pencil from "@lucide/svelte/icons/pencil";
import Plus from "@lucide/svelte/icons/plus";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { ProjectRecord } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import {
  PanelBanner,
  PanelEmpty,
  PanelSection,
  PanelToolbar,
  PanelToolbarButton,
  PanelToolbarGroup,
  PanelView,
} from "@nervekit/workbench-ui/panel";
import ScratchNoteTitleDialog from "./ScratchNoteTitleDialog.svelte";
import {
  createScratchNote,
  ensureScratchNotesProject,
  flushScratchNote,
  getScratchNotesProject,
  loadScratchNotes,
  removeScratchNote,
  renameScratchNote,
  setScratchNoteContent,
  type ScratchNoteEntry,
} from "../state/scratch-notes-state.svelte";
import { panelSectionPreferences } from "$lib/app/shell/panel-section-preferences.svelte";

type Props = {
  activeProject?: ProjectRecord;
};

let { activeProject }: Props = $props();

const projectId = $derived(activeProject?.id);
const project = $derived(
  projectId ? getScratchNotesProject(projectId) : undefined,
);
let noteToRename = $state<ScratchNoteEntry | undefined>();
let noteToDelete = $state<ScratchNoteEntry | undefined>();

$effect(() => {
  if (!projectId) return;
  ensureScratchNotesProject(projectId);
  void loadScratchNotes(projectId);
});

function statusLabel(note: ScratchNoteEntry): string {
  switch (note.saveStatus) {
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved";
    case "error":
      return "Save failed";
    default:
      return "";
  }
}
</script>

<PanelView padded={false}>
  {#snippet toolbar()}
    {#if projectId}
      <PanelToolbar>
        <PanelToolbarGroup trailing>
          <PanelToolbarButton
            icon={Plus}
            label="Add note"
            loading={project?.creating}
            disabled={project?.creating}
            onclick={() => void createScratchNote(projectId)}
          />
        </PanelToolbarGroup>
      </PanelToolbar>
    {/if}
  {/snippet}

  {#snippet banner()}
    {#if !projectId}
      <PanelBanner tone="muted">Select a project to take notes.</PanelBanner>
    {:else if !project || project.loadStatus === "idle" || project.loadStatus === "loading"}
      <PanelBanner tone="muted">Loading scratch notes…</PanelBanner>
    {:else if project.loadStatus === "error"}
      <PanelBanner tone="destructive">
        Could not load scratch notes.
        {#snippet actions()}
          <Button
            size="xs"
            variant="outline"
            onclick={() => void loadScratchNotes(projectId, true)}>Retry</Button
          >
        {/snippet}
      </PanelBanner>
    {/if}
  {/snippet}

  {#if projectId && project?.loadStatus === "loaded"}
    {#if project.notes.length === 0}
      <PanelEmpty
        icon={NotebookPen}
        title="No scratch notes yet"
        description="Notes are scoped to this project."
      />
    {:else}
      {#each project.notes as note (note.id)}
        <PanelSection
          title={note.title}
          icon={NotebookPen}
          open={panelSectionPreferences.isOpen(`notes.${note.id}`)}
          onOpenChange={(open) =>
            panelSectionPreferences.setOpen(`notes.${note.id}`, open)}
        >
          {#snippet meta()}
            {#if statusLabel(note)}
              <span class="truncate">{statusLabel(note)}</span>
            {/if}
          {/snippet}
          {#snippet actions()}
            <PanelToolbarButton
              icon={Pencil}
              label={`Edit title for ${note.title}`}
              disabled={note.deleting}
              onclick={() => (noteToRename = note)}
            />
            <PanelToolbarButton
              icon={Trash2}
              label={`Delete ${note.title}`}
              loading={note.deleting}
              disabled={note.deleting}
              onclick={() => (noteToDelete = note)}
            />
          {/snippet}

          <Textarea
            value={note.draftContent}
            oninput={(event) =>
              setScratchNoteContent(
                projectId,
                note.id,
                event.currentTarget.value,
              )}
            onblur={() => void flushScratchNote(projectId, note.id)}
            spellcheck={false}
            disabled={note.deleting}
            placeholder="Jot down notes for this project…"
            class="min-h-36 resize-none text-sm leading-relaxed [field-sizing:content]"
          />
        </PanelSection>
      {/each}
    {/if}
  {/if}
</PanelView>

<ScratchNoteTitleDialog
  open={Boolean(noteToRename)}
  title={noteToRename?.title}
  onSave={(title) =>
    noteToRename && projectId
      ? renameScratchNote(projectId, noteToRename.id, title)
      : Promise.resolve(false)}
  onOpenChange={(open) => {
    if (!open) noteToRename = undefined;
  }}
/>

<ConfirmDialog
  open={Boolean(noteToDelete)}
  destructive
  title="Delete scratch note?"
  description={`This permanently deletes “${noteToDelete?.title ?? ""}”.`}
  confirmLabel="Delete"
  onConfirm={() => {
    if (projectId && noteToDelete) {
      void removeScratchNote(projectId, noteToDelete.id);
    }
  }}
  onCancel={() => (noteToDelete = undefined)}
  onOpenChange={(open) => {
    if (!open) noteToDelete = undefined;
  }}
/>
