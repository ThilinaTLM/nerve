<script lang="ts">
import NotebookPen from "@lucide/svelte/icons/notebook-pen";
import Plus from "@lucide/svelte/icons/plus";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Empty from "@nervekit/ui-kit/components/ui/empty";
import { relativeTimeLabel } from "@nervekit/ui-kit/display/time";
import {
  MobileListRow,
  MobileScreen,
  MobileSection,
} from "$lib/presentation/shell";
import {
  createScratchNote,
  loadScratchNotes,
  scratchNotesUi,
} from "$lib/features/scratch-notes/state/scratch-notes-state.svelte";
import { workspaceSelectors } from "$lib/application/workspace";
import {
  backFromMobileScreen,
  pushMobileScreen,
} from "$lib/app/shell/mobile/mobile-shell.svelte";
import type { MobileScreenProps } from "./mobile-screen-registry";

/** A project's scratch notes, newest edit first; each opens its editor. */
let { route }: MobileScreenProps<"notes"> = $props();

const projectId = $derived(route.projectId);
const project = $derived(
  workspaceSelectors.projects.find((candidate) => candidate.id === projectId),
);
const entry = $derived(scratchNotesUi.projects[projectId]);
const notes = $derived(
  (entry?.notes ?? [])
    .filter((note) => !note.deleting)
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
);

$effect(() => {
  void loadScratchNotes(projectId);
});

function preview(content: string): string | undefined {
  return (
    content
      .split("\n")
      .find((line) => line.trim())
      ?.trim() || undefined
  );
}

async function create() {
  const noteId = await createScratchNote(projectId);
  if (noteId) pushMobileScreen({ kind: "note", projectId, noteId });
}
</script>

<MobileScreen
  title="Scratch notes"
  subtitle={project?.name}
  onBack={backFromMobileScreen}
  backLabel="Back to project"
>
  {#snippet actions()}
    <Button
      variant="ghost"
      size="icon-sm"
      ariaLabel="New note"
      disabled={entry?.creating}
      onclick={() => void create()}
    >
      <Plus size={18} strokeWidth={2.1} />
    </Button>
  {/snippet}

  {#if notes.length}
    <MobileSection>
      {#each notes as note (note.id)}
        <MobileListRow
          title={note.title}
          detail={preview(note.draftContent)}
          meta={relativeTimeLabel(note.updatedAt)}
          icon={NotebookPen}
          onclick={() =>
            pushMobileScreen({ kind: "note", projectId, noteId: note.id })}
        />
      {/each}
    </MobileSection>
  {:else if entry?.loadStatus === "loading" || !entry}
    <p class="px-6 py-10 text-center text-sm text-muted-foreground">Loading…</p>
  {:else}
    <Empty.Root class="px-6 py-10">
      <Empty.Header>
        <Empty.Media class="text-muted-foreground">
          <NotebookPen size={28} strokeWidth={1.6} />
        </Empty.Media>
        <Empty.Title class="text-sm">No notes yet</Empty.Title>
        <Empty.Description class="text-xs">
          Scratch notes stay with this project and sync with the desktop.
        </Empty.Description>
      </Empty.Header>
    </Empty.Root>
  {/if}
</MobileScreen>
