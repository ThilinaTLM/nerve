<script lang="ts">
import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
import Pencil from "@lucide/svelte/icons/pencil";
import Trash2 from "@lucide/svelte/icons/trash-2";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Dialog from "@nervekit/ui-kit/components/ui/dialog";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import { MobileActionSheet, MobileScreen } from "$lib/presentation/shell";
import {
  flushScratchNote,
  loadScratchNotes,
  removeScratchNote,
  renameScratchNote,
  scratchNotesUi,
  setScratchNoteContent,
} from "$lib/features/scratch-notes/state/scratch-notes-state.svelte";
import { backFromMobileScreen } from "$lib/app/shell/mobile/mobile-shell.svelte";
import type { MobileScreenProps } from "./mobile-screen-registry";

/**
 * Full-screen scratch note editor. Edits autosave through the shared note
 * state (the same debounce the desktop uses) and flush when the screen is
 * left, so the system back gesture never drops a change.
 */
let { route, visible }: MobileScreenProps<"note"> = $props();

const note = $derived(
  scratchNotesUi.projects[route.projectId]?.notes.find(
    (candidate) => candidate.id === route.noteId,
  ),
);
const saveLabel = $derived.by(() => {
  switch (note?.saveStatus) {
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved";
    case "error":
      return "Not saved";
    default:
      return undefined;
  }
});

let menuOpen = $state(false);
let renameOpen = $state(false);
let renameValue = $state("");
let deleteOpen = $state(false);

$effect(() => {
  void loadScratchNotes(route.projectId);
});

// Flush as soon as the editor leaves the screen, and again on unmount.
$effect(() => {
  const { projectId, noteId } = route;
  if (!visible) void flushScratchNote(projectId, noteId);
  return () => void flushScratchNote(projectId, noteId);
});

const menuItems = $derived<ContextMenuItem[]>([
  {
    label: "Rename",
    icon: Pencil,
    onSelect: () => {
      renameValue = note?.title ?? "";
      renameOpen = true;
    },
  },
  {
    label: "Delete",
    icon: Trash2,
    destructive: true,
    onSelect: () => (deleteOpen = true),
  },
]);

async function rename(event: SubmitEvent) {
  event.preventDefault();
  if (await renameScratchNote(route.projectId, route.noteId, renameValue)) {
    renameOpen = false;
  }
}
</script>

<MobileScreen
  title={note?.title ?? "Note"}
  subtitle={saveLabel}
  onBack={backFromMobileScreen}
  backLabel="Back to notes"
  scroll={false}
>
  {#snippet actions()}
    {#if note}
      <Button
        variant="ghost"
        size="icon-sm"
        ariaLabel="Note actions"
        onclick={() => (menuOpen = true)}
      >
        <EllipsisVertical size={18} strokeWidth={1.9} />
      </Button>
    {/if}
  {/snippet}

  {#if note}
    <div class="grid min-h-0 p-3">
      <Textarea
        class="field-sizing-fixed h-full min-h-0 resize-none bg-card"
        value={note.draftContent}
        placeholder="Write something…"
        aria-label={note.title}
        oninput={(event) =>
          setScratchNoteContent(
            route.projectId,
            route.noteId,
            event.currentTarget.value,
          )}
      />
    </div>
  {:else}
    <p class="px-6 py-10 text-center text-sm text-muted-foreground">
      This note is no longer available.
    </p>
  {/if}
</MobileScreen>

{#if note}
  <MobileActionSheet
    open={menuOpen}
    title={note.title}
    items={menuItems}
    onOpenChange={(open) => (menuOpen = open)}
  />

  <Dialog.Root bind:open={renameOpen}>
    <Dialog.Content>
      <form class="grid gap-4" onsubmit={rename}>
        <Dialog.Header>
          <Dialog.Title>Rename note</Dialog.Title>
        </Dialog.Header>
        <Input bind:value={renameValue} aria-label="Note title" />
        <Dialog.Footer>
          <Button variant="outline" onclick={() => (renameOpen = false)}
            >Cancel</Button
          >
          <Button type="submit" disabled={!renameValue.trim()}>Rename</Button>
        </Dialog.Footer>
      </form>
    </Dialog.Content>
  </Dialog.Root>

  <ConfirmDialog
    bind:open={deleteOpen}
    title="Delete note?"
    description={`“${note.title}” is removed from this project. This cannot be undone.`}
    confirmLabel="Delete"
    destructive
    onConfirm={async () => {
      if (await removeScratchNote(route.projectId, route.noteId))
        backFromMobileScreen();
    }}
  />
{/if}
