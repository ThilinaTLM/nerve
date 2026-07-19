<script lang="ts">
import NotebookPen from "@lucide/svelte/icons/notebook-pen";
import {
  getScratchNote,
  updateScratchNote,
  type ProjectRecord,
} from "$lib/api";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import { notify } from "$lib/features/notifications/notify.svelte";

type Props = {
  activeProject?: ProjectRecord;
};

let { activeProject }: Props = $props();

type SaveStatus = "idle" | "loading" | "saving" | "saved" | "error";

const SAVE_DEBOUNCE_MS = 700;
const EPOCH = new Date(0).toISOString();

let content = $state("");
let savedContent = $state("");
let status = $state<SaveStatus>("idle");
let updatedAt = $state<string | undefined>(undefined);

let loadToken = 0;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

const projectId = $derived(activeProject?.id);

const statusLabel = $derived.by(() => {
  switch (status) {
    case "loading":
      return "Loading…";
    case "saving":
      return "Saving…";
    case "error":
      return "Save failed";
    case "saved":
      return "Saved";
    default:
      return updatedAt && updatedAt !== EPOCH
        ? `Saved ${new Date(updatedAt).toLocaleString()}`
        : "";
  }
});

$effect(() => {
  const id = projectId;
  const token = ++loadToken;
  clearTimeout(saveTimer);
  saveTimer = undefined;
  content = "";
  savedContent = "";
  updatedAt = undefined;

  if (!id) {
    status = "idle";
    return;
  }

  status = "loading";
  void getScratchNote(id)
    .then((note) => {
      if (token !== loadToken) return;
      content = note.content;
      savedContent = note.content;
      updatedAt = note.updatedAt;
      status = "idle";
    })
    .catch(() => {
      if (token !== loadToken) return;
      status = "error";
      notify.error("Could not load scratch notes");
    });

  return () => clearTimeout(saveTimer);
});

async function save(): Promise<void> {
  const id = projectId;
  if (!id) return;
  if (content === savedContent) {
    status = "idle";
    return;
  }
  const token = loadToken;
  const pending = content;
  status = "saving";
  try {
    const note = await updateScratchNote(id, pending);
    if (token !== loadToken) return;
    savedContent = pending;
    updatedAt = note.updatedAt;
    status = "saved";
  } catch {
    if (token !== loadToken) return;
    status = "error";
    notify.error("Could not save scratch notes");
  }
}

function scheduleSave(): void {
  if (!projectId) return;
  status = "saving";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
}

function flushSave(): void {
  if (!projectId) return;
  clearTimeout(saveTimer);
  if (content !== savedContent) void save();
}
</script>

<div class="flex min-h-full flex-col gap-2 p-2">
  <div class="flex items-center justify-between gap-2 px-1">
    <div
      class="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-foreground"
    >
      <NotebookPen
        size={13}
        strokeWidth={2.2}
        class="shrink-0 text-muted-foreground"
      />
      <span class="truncate">Scratch Notes</span>
    </div>
    {#if projectId && statusLabel}
      <span class="shrink-0 truncate text-xs text-muted-foreground"
        >{statusLabel}</span
      >
    {/if}
  </div>

  {#if projectId}
    <Textarea
      bind:value={content}
      oninput={scheduleSave}
      onblur={flushSave}
      spellcheck={false}
      placeholder="Jot down notes for this project…"
      class="min-h-0 flex-1 resize-none text-sm leading-relaxed [field-sizing:fixed]"
    />
  {:else}
    <p class="px-1 text-xs text-muted-foreground">
      Select a project to take notes.
    </p>
  {/if}
</div>
