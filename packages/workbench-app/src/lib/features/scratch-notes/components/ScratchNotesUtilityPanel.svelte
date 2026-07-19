<script lang="ts">
import NotebookPen from "@lucide/svelte/icons/notebook-pen";
import Plus from "@lucide/svelte/icons/plus";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { ProjectRecord } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import { PanelSection } from "@nervekit/workbench-ui/components/workbench";
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
  setScratchNoteOpen,
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

<div class="flex flex-col gap-2 p-2">
  {#if !projectId}
    <p class="px-1 text-xs text-muted-foreground">
      Select a project to take notes.
    </p>
  {:else}
    {#if !project || project.loadStatus === "idle" || project.loadStatus === "loading"}
      <div
        class="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground"
      >
        <Spinner class="size-3.5" /> Loading scratch notes…
      </div>
    {:else if project.loadStatus === "error"}
      <div class="rounded-md border border-dashed p-3">
        <p class="text-xs text-muted-foreground">
          Could not load scratch notes.
        </p>
        <Button
          size="xs"
          variant="outline"
          class="mt-2"
          onclick={() => void loadScratchNotes(projectId, true)}>Retry</Button
        >
      </div>
    {:else if project.notes.length === 0}
      <p
        class="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground"
      >
        No scratch notes yet.
      </p>
    {:else}
      {#each project.notes as note (note.id)}
        <PanelSection
          title={note.title}
          icon={NotebookPen}
          open={note.open}
          onOpenChange={(open) => setScratchNoteOpen(projectId, note.id, open)}
          onTitleDoubleClick={() => (noteToRename = note)}
          titleHint="Double-click to rename"
        >
          {#snippet meta()}
            {#if statusLabel(note)}
              <span class="truncate">{statusLabel(note)}</span>
            {/if}
          {/snippet}
          {#snippet actions()}
            <button
              type="button"
              class="inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              title={`Delete ${note.title}`}
              aria-label={`Delete ${note.title}`}
              disabled={note.deleting}
              onclick={() => (noteToDelete = note)}
            >
              {#if note.deleting}
                <Spinner class="size-3" />
              {:else}
                <Trash2 size={13} strokeWidth={2.3} />
              {/if}
            </button>
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

    <Button
      variant="outline"
      class="w-full border-dashed text-muted-foreground"
      disabled={project?.creating}
      onclick={() => void createScratchNote(projectId)}
    >
      {#if project?.creating}
        <Spinner class="size-4" /> Creating…
      {:else}
        <Plus class="size-4" /> Add note
      {/if}
    </Button>
  {/if}
</div>

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
