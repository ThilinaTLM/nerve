import type { ScratchNote } from "@nervekit/contracts";
import { SvelteMap } from "svelte/reactivity";
import { notify } from "$lib/features/notifications/notify.svelte";
import {
  createScratchNote as createScratchNoteRequest,
  deleteScratchNote as deleteScratchNoteRequest,
  listScratchNotes,
  updateScratchNote as updateScratchNoteRequest,
} from "../api/scratch-notes.api";
import { KeyedSerialQueue } from "./keyed-serial-queue";

export type ScratchNoteSaveStatus = "idle" | "saving" | "saved" | "error";
export type ScratchNotesLoadStatus = "idle" | "loading" | "loaded" | "error";

const SAVE_DEBOUNCE_MS = 700;

type ScratchNoteEntry = ScratchNote & {
  draftContent: string;
  savedContent: string;
  saveStatus: ScratchNoteSaveStatus;
  open: boolean;
  deleting: boolean;
  contentSaveFailed: boolean;
  saveTimer?: ReturnType<typeof setTimeout>;
};

type ScratchNotesProjectEntry = {
  notes: ScratchNoteEntry[];
  loadStatus: ScratchNotesLoadStatus;
  loadToken: number;
  creating: boolean;
};

const store = $state({
  projects: {} as Record<string, ScratchNotesProjectEntry>,
});
const mutationQueue = new KeyedSerialQueue();
const loadPromises = new SvelteMap<string, Promise<void>>();

/** Shared scratch-note state that survives utility-tab and project switches. */
export const scratchNotesUi = store;

export function ensureScratchNotesProject(
  projectId: string,
): ScratchNotesProjectEntry {
  let project = store.projects[projectId];
  if (!project) {
    project = {
      notes: [],
      loadStatus: "idle",
      loadToken: 0,
      creating: false,
    };
    store.projects[projectId] = project;
  }
  return project;
}

function toEntry(note: ScratchNote): ScratchNoteEntry {
  return {
    ...note,
    draftContent: note.content,
    savedContent: note.content,
    saveStatus: "idle",
    open: true,
    deleting: false,
    contentSaveFailed: false,
    saveTimer: undefined,
  };
}

function findNote(
  projectId: string,
  noteId: string,
): ScratchNoteEntry | undefined {
  return store.projects[projectId]?.notes.find((note) => note.id === noteId);
}

export function getScratchNotesProject(
  projectId: string,
): ScratchNotesProjectEntry | undefined {
  return store.projects[projectId];
}

export function loadScratchNotes(
  projectId: string,
  force = false,
): Promise<void> {
  const project = ensureScratchNotesProject(projectId);
  if (!force && project.loadStatus === "loaded") return Promise.resolve();
  if (!force && project.loadStatus === "loading") {
    return loadPromises.get(projectId) ?? Promise.resolve();
  }

  const token = ++project.loadToken;
  project.loadStatus = "loading";
  const promise = listScratchNotes(projectId)
    .then((notes) => {
      if (token !== project.loadToken) return;
      project.notes = notes.map(toEntry);
      project.loadStatus = "loaded";
    })
    .catch(() => {
      if (token !== project.loadToken) return;
      project.loadStatus = "error";
      notify.error("Could not load scratch notes");
    })
    .finally(() => {
      if (loadPromises.get(projectId) === promise) {
        loadPromises.delete(projectId);
      }
    });
  loadPromises.set(projectId, promise);
  return promise;
}

export async function createScratchNote(projectId: string): Promise<void> {
  const project = ensureScratchNotesProject(projectId);
  if (project.creating) return;
  project.creating = true;
  try {
    await loadScratchNotes(projectId);
    const note = await createScratchNoteRequest(projectId);
    project.notes.push(toEntry(note));
    project.loadStatus = "loaded";
  } catch {
    notify.error("Could not create scratch note");
  } finally {
    project.creating = false;
  }
}

function mutationKey(projectId: string, noteId: string): string {
  return `${projectId}:${noteId}`;
}

function queueUpdate(
  projectId: string,
  noteId: string,
  request: { title?: string; content?: string },
  failureMessage: string,
): Promise<boolean> {
  const key = mutationKey(projectId, noteId);
  return mutationQueue.enqueue(key, async () => {
    const note = findNote(projectId, noteId);
    if (!note) return false;
    note.saveStatus = "saving";
    try {
      const updated = await updateScratchNoteRequest(
        projectId,
        noteId,
        request,
      );
      const current = findNote(projectId, noteId);
      if (!current) return false;
      current.title = updated.title;
      current.content = updated.content;
      current.createdAt = updated.createdAt;
      current.updatedAt = updated.updatedAt;
      if (request.content !== undefined) {
        current.savedContent = request.content;
        current.contentSaveFailed = false;
      }
      current.saveStatus =
        current.draftContent === current.savedContent
          ? "saved"
          : current.contentSaveFailed
            ? "error"
            : "saving";
      return true;
    } catch {
      const current = findNote(projectId, noteId);
      if (current) {
        if (request.content !== undefined) current.contentSaveFailed = true;
        current.saveStatus = "error";
      }
      notify.error(failureMessage);
      return false;
    }
  });
}

function saveScratchNote(projectId: string, noteId: string): Promise<boolean> {
  const note = findNote(projectId, noteId);
  if (!note || note.draftContent === note.savedContent) {
    if (note && note.saveStatus !== "error") note.saveStatus = "idle";
    return Promise.resolve(true);
  }
  return queueUpdate(
    projectId,
    noteId,
    { content: note.draftContent },
    "Could not save scratch note",
  );
}

export function setScratchNoteContent(
  projectId: string,
  noteId: string,
  value: string,
): void {
  const note = findNote(projectId, noteId);
  if (!note) return;
  note.draftContent = value;
  note.saveStatus = "saving";
  note.contentSaveFailed = false;
  clearTimeout(note.saveTimer);
  note.saveTimer = setTimeout(
    () => void saveScratchNote(projectId, noteId),
    SAVE_DEBOUNCE_MS,
  );
}

export function flushScratchNote(
  projectId: string,
  noteId: string,
): Promise<boolean> {
  const note = findNote(projectId, noteId);
  if (!note) return Promise.resolve(false);
  clearTimeout(note.saveTimer);
  note.saveTimer = undefined;
  return saveScratchNote(projectId, noteId);
}

export async function renameScratchNote(
  projectId: string,
  noteId: string,
  title: string,
): Promise<boolean> {
  const note = findNote(projectId, noteId);
  const trimmed = title.trim();
  if (!note || !trimmed) return false;
  await flushScratchNote(projectId, noteId);
  return queueUpdate(
    projectId,
    noteId,
    { title: trimmed },
    "Could not rename scratch note",
  );
}

export async function removeScratchNote(
  projectId: string,
  noteId: string,
): Promise<boolean> {
  const note = findNote(projectId, noteId);
  if (!note || note.deleting) return false;
  note.deleting = true;
  clearTimeout(note.saveTimer);
  try {
    await mutationQueue.wait(mutationKey(projectId, noteId));
    await deleteScratchNoteRequest(projectId, noteId);
    const project = store.projects[projectId];
    if (project) {
      project.notes = project.notes.filter((entry) => entry.id !== noteId);
    }
    return true;
  } catch {
    const current = findNote(projectId, noteId);
    if (current) current.deleting = false;
    notify.error("Could not delete scratch note");
    return false;
  }
}

export function setScratchNoteOpen(
  projectId: string,
  noteId: string,
  open: boolean,
): void {
  const note = findNote(projectId, noteId);
  if (note) note.open = open;
}

export type { ScratchNoteEntry, ScratchNotesProjectEntry };
