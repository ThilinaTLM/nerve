<script lang="ts">
import type { Project } from "@nervekit/contracts/core";
import NotesPanel from "../views/NotesPanel.svelte";
import type { NotesPanelActions } from "../views/notes-panel-types";
import {
  createScratchNote,
  ensureScratchNotesProject,
  flushScratchNote,
  getScratchNotesProject,
  loadScratchNotes,
  removeScratchNote,
  renameScratchNote,
  setScratchNoteContent,
} from "../state/scratch-notes-state.svelte";

type Props = {
  activeProject?: Project;
};

let { activeProject }: Props = $props();

const projectId = $derived(activeProject?.id);
const project = $derived(
  projectId ? getScratchNotesProject(projectId) : undefined,
);

$effect(() => {
  if (!projectId) return;
  ensureScratchNotesProject(projectId);
  void loadScratchNotes(projectId);
});

const actions: NotesPanelActions = {
  create() {
    if (projectId) void createScratchNote(projectId);
  },
  retry() {
    if (projectId) void loadScratchNotes(projectId, true);
  },
  setContent(noteId, content) {
    if (projectId) setScratchNoteContent(projectId, noteId, content);
  },
  flush(noteId) {
    if (projectId) void flushScratchNote(projectId, noteId);
  },
  rename(noteId, title) {
    if (projectId) void renameScratchNote(projectId, noteId, title);
  },
  remove(noteId) {
    if (projectId) void removeScratchNote(projectId, noteId);
  },
};
</script>

<NotesPanel {projectId} {project} {actions} />
