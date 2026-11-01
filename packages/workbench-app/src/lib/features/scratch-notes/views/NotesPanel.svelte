<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
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
import type {
  ScratchNoteEntry,
  ScratchNotesProjectEntry,
} from "../state/scratch-notes-state.svelte";
import type { NotesPanelActions } from "./notes-panel-types";

type Props = {
  projectId?: string;
  project?: ScratchNotesProjectEntry;
  actions: NotesPanelActions;
};

let { projectId, project, actions }: Props = $props();

// The Callout `actions` snippet shadows the `actions` prop in the template.
const retry = () => actions.retry();

let noteToDelete = $state<ScratchNoteEntry | undefined>();
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
            onclick={() => actions.create()}
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
          <Button size="sm" variant="outline" onclick={retry}>Retry</Button>
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
            onclick={() => actions.create()}
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
            {note}
            onContentChange={(content) => actions.setContent(note.id, content)}
            onFlush={() => actions.flush(note.id)}
            onRename={(title) => actions.rename(note.id, title)}
            onDelete={() => {
              if (note.draftContent.trim()) noteToDelete = note;
              else actions.remove(note.id);
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
      actions.remove(noteToDelete.id);
    }
  }}
  onCancel={() => (noteToDelete = undefined)}
  onOpenChange={(open) => {
    if (!open) noteToDelete = undefined;
  }}
/>
