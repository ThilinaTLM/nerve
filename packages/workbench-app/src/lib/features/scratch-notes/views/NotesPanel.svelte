<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import type { Project } from "@nervekit/contracts/core";
import ScrollRegion from "@nervekit/ui-kit/components/composites/scroll-region";
import NotebookPen from "@lucide/svelte/icons/notebook-pen";
import Plus from "@lucide/svelte/icons/plus";

import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import {
  PanelEmpty,
  PanelHeader,
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
  activeProject?: Project;
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

<PanelView>
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
      <Callout layout="strip" tone="neutral"
        >Select a project to take notes.</Callout
      >
    {:else if !project || project.loadStatus === "idle" || project.loadStatus === "loading"}
      <Callout layout="strip" tone="neutral">Loading scratch notes…</Callout>
    {:else if project.loadStatus === "error"}
      <Callout layout="strip" tone="destructive">
        Could not load scratch notes.
        {#snippet actions()}
          <Button
            size="sm"
            variant="outline"
            onclick={() => void loadScratchNotes(projectId, true)}>Retry</Button
          >
        {/snippet}
      </Callout>
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
            size="sm"
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
      <ScrollRegion
        ariaLabel="Scratch notes"
        surface="panel"
        class="-mx-2"
        contentClass="flex min-w-0 shrink-0 flex-col gap-1.5 px-2 py-1"
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
      </ScrollRegion>
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
