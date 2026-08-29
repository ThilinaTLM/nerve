<script lang="ts">
import NotebookPen from "@lucide/svelte/icons/notebook-pen";
import Plus from "@lucide/svelte/icons/plus";
import type { ProjectRecord } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import {
  PanelBanner,
  PanelEmpty,
  PanelHeader,
  PanelScrollRegion,
  PanelToolbarButton,
  PanelView,
} from "$lib/presentation/panels";
import ScratchNoteCard from "./ScratchNoteCard.svelte";
import {
  createScratchNote,
  ensureScratchNotesProject,
  getScratchNotesProject,
  loadScratchNotes,
  removeScratchNote,
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
let noteToDelete = $state<ScratchNoteEntry | undefined>();

$effect(() => {
  if (!projectId) return;
  ensureScratchNotesProject(projectId);
  void loadScratchNotes(projectId);
});
</script>

<PanelView padded={false} scroll={false}>
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
      <PanelScrollRegion
        ariaLabel="Scratch notes"
        contentClass="flex min-w-0 shrink-0 flex-col gap-1.5 py-1"
      >
        {#each project.notes as note (note.id)}
          <ScratchNoteCard
            {projectId}
            {note}
            onDelete={() => {
              if (note.draftContent.trim()) noteToDelete = note;
              else void removeScratchNote(projectId, note.id);
            }}
          />
        {/each}
      </PanelScrollRegion>
    {/if}
  {/if}
</PanelView>

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
