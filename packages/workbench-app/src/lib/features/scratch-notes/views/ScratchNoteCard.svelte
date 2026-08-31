<script lang="ts">
import Pencil from "@lucide/svelte/icons/pencil";
import Trash2 from "@lucide/svelte/icons/trash-2";
import { SCRATCH_NOTE_TITLE_MAX_LENGTH } from "@nervekit/contracts/scratch-notes";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import { PanelCard, PanelToolbarButton } from "$lib/presentation/panels";
import {
  flushScratchNote,
  renameScratchNote,
  setScratchNoteContent,
  type ScratchNoteEntry,
} from "../state/scratch-notes-state.svelte";

let {
  projectId,
  note,
  onDelete,
}: {
  projectId: string;
  note: ScratchNoteEntry;
  onDelete: () => void;
} = $props();

let renaming = $state(false);

/** Only in-flight and failed saves surface; steady state stays quiet. */
const status = $derived.by(() => {
  switch (note.saveStatus) {
    case "saving":
      return { text: "Saving…", failed: false };
    case "error":
      return { text: "Save failed", failed: true };
    default:
      return undefined;
  }
});
</script>

<PanelCard
  title={note.title}
  titleHint={`${note.title} — double-click to rename`}
  titleEditing={renaming}
  titleMaxLength={SCRATCH_NOTE_TITLE_MAX_LENGTH}
  onTitleDblClick={() => (renaming = true)}
  onTitleCommit={(title) => {
    renaming = false;
    void renameScratchNote(projectId, note.id, title);
  }}
  onTitleCancel={() => (renaming = false)}
>
  {#snippet titleActions()}
    <PanelToolbarButton
      icon={Pencil}
      label={`Rename ${note.title}`}
      dense
      class="opacity-0 transition-opacity group-hover/title:opacity-100 group-focus-within/title:opacity-100"
      disabled={note.deleting}
      onclick={() => (renaming = true)}
    />
  {/snippet}

  {#snippet meta()}
    {#if status}
      <span class={status.failed ? "text-destructive" : undefined}
        >{status.text}</span
      >
    {/if}
  {/snippet}

  {#snippet actions()}
    <PanelToolbarButton
      icon={Trash2}
      label={`Delete ${note.title}`}
      dense
      loading={note.deleting}
      disabled={note.deleting}
      onclick={onDelete}
    />
  {/snippet}

  <Textarea
    value={note.draftContent}
    oninput={(event) =>
      setScratchNoteContent(projectId, note.id, event.currentTarget.value)}
    onblur={() => void flushScratchNote(projectId, note.id)}
    spellcheck={false}
    disabled={note.deleting}
    placeholder="Jot down notes for this project…"
    class="min-h-16 resize-none rounded-none border-0 bg-transparent px-3 py-2 text-xs font-normal leading-relaxed shadow-none focus-visible:ring-0 md:text-xs dark:bg-transparent [field-sizing:content]"
  />
</PanelCard>
