<script lang="ts">
import NotebookPen from "@lucide/svelte/icons/notebook-pen";
import Pencil from "@lucide/svelte/icons/pencil";
import Trash2 from "@lucide/svelte/icons/trash-2";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import { relativeTimeLabel } from "@nervekit/ui-kit/core/utils/time";
import { PanelCard, PanelToolbarButton } from "@nervekit/workbench-ui/panel";
import {
  flushScratchNote,
  setScratchNoteBodyHeight,
  setScratchNoteContent,
  toggleScratchNoteCollapsed,
  type ScratchNoteEntry,
} from "../state/scratch-notes-state.svelte";

let {
  projectId,
  note,
  onRename,
  onDelete,
}: {
  projectId: string;
  note: ScratchNoteEntry;
  onRename: () => void;
  onDelete: () => void;
} = $props();

const status = $derived.by(() => {
  switch (note.saveStatus) {
    case "saving":
      return { text: "Saving…", failed: false };
    case "saved":
      return { text: "Saved", failed: false };
    case "error":
      return { text: "Save failed", failed: true };
    default:
      return { text: relativeTimeLabel(note.updatedAt), failed: false };
  }
});

function captureHeight(event: PointerEvent): void {
  const target = event.currentTarget as HTMLTextAreaElement | null;
  if (!target) return;
  setScratchNoteBodyHeight(projectId, note.id, target.offsetHeight);
}
</script>

<PanelCard
  title={note.title}
  icon={NotebookPen}
  collapsed={note.collapsed}
  titleHint={`${note.title} — double-click to rename`}
  onToggleCollapsed={() => toggleScratchNoteCollapsed(projectId, note.id)}
  onTitleDblClick={onRename}
>
  {#snippet meta()}
    <span class={status.failed ? "text-destructive" : undefined}
      >{status.text}</span
    >
  {/snippet}

  {#snippet actions()}
    <PanelToolbarButton
      icon={Pencil}
      label={`Rename ${note.title}`}
      dense
      disabled={note.deleting}
      onclick={onRename}
    />
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
    onpointerup={captureHeight}
    spellcheck={false}
    disabled={note.deleting}
    placeholder="Jot down notes for this project…"
    style={note.bodyHeight ? `height:${note.bodyHeight}px` : undefined}
    class="min-h-24 resize-y rounded-none border-0 bg-transparent px-2 py-1.5 text-xs leading-relaxed shadow-none focus-visible:ring-0 [field-sizing:content]"
  />
</PanelCard>
