<script lang="ts">
import NotebookPen from "@lucide/svelte/icons/notebook-pen";
import Plus from "@lucide/svelte/icons/plus";
import type { ProjectRecord } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import {
  PanelBanner,
  PanelEmpty,
  PanelHeader,
  PanelToolbarButton,
  PanelView,
} from "@nervekit/workbench-ui/panel";
import ScratchNoteCard from "./ScratchNoteCard.svelte";
import ScratchNoteTitleDialog from "./ScratchNoteTitleDialog.svelte";
import {
  createScratchNote,
  ensureScratchNotesProject,
  getScratchNotesProject,
  loadScratchNotes,
  removeScratchNote,
  renameScratchNote,
  type ScratchNoteEntry,
} from "../state/scratch-notes-state.svelte";

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
</script>

<PanelView padded={false}>
  {#snippet banner()}
    <PanelHeader title="Notes" count={project?.notes.length}>
      {#snippet trailing()}
        {#if projectId}
          <PanelToolbarButton
            icon={Plus}
            label="Add note"
            loading={project?.creating}
            disabled={project?.creating}
            onclick={() => void createScratchNote(projectId)}
          />
        {/if}
      {/snippet}
    </PanelHeader>
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
      >
        {#snippet action()}
          <Button
            size="xs"
            variant="outline"
            disabled={project.creating}
            onclick={() => void createScratchNote(projectId)}
          >
            <Plus />
            New note
          </Button>
        {/snippet}
      </PanelEmpty>
    {:else}
      <div class="flex min-w-0 flex-col gap-1.5 py-1">
        {#each project.notes as note (note.id)}
          <ScratchNoteCard
            {projectId}
            {note}
            onRename={() => (noteToRename = note)}
            onDelete={() => (noteToDelete = note)}
          />
        {/each}
      </div>
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
