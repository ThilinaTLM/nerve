<script lang="ts">
import { onMount } from "svelte";
import { listDirectories } from "$lib/api";
import {
  openProjectDirectory,
  selectProject,
  workspaceSelectors,
} from "$lib/application/workspace";
import { tildePath } from "$lib/domain/filesystem/project-path";
import {
  buildDropPlan,
  DropToOpenDialog,
  DropToOpenOverlay,
  dropParentPath,
  loadFilesystemLocations,
  type DroppedItem,
  type DropPlan,
} from "$lib/features/projects";
import { getDesktopBridge, isLocalDesktopDaemon } from "$lib/platform/desktop";

type DroppedPath = { path: string; hint: "folder" | "file" | "unknown" };

let enabled = $state(false);
let dragging = $state(false);
let overZone = $state(false);
let dragDepth = 0;

let open = $state(false);
let plan = $state<DropPlan>();
let pick = $state(0);
let busy = $state(false);
let error = $state<string>();
let separator = $state<"/" | "\\">("/");
let locationsHome = $state<string>();
let caseInsensitive = $state(false);
let resolveToken = 0;

const home = $derived(
  locationsHome ?? workspaceSelectors.status?.storage.userHome,
);
const projects = $derived(
  workspaceSelectors.projects.map((project) => ({
    id: project.id,
    name: project.name,
    directory: project.directory,
  })),
);

function displayPath(path: string): string {
  const shown = tildePath(path, home);
  return separator === "\\" ? shown.replaceAll("/", "\\") : shown;
}

function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function resetDrag() {
  dragDepth = 0;
  dragging = false;
  overZone = false;
}

// Enter/leave are tracked in the capture phase so drop targets that stop
// propagation (the composer) cannot unbalance the depth count.
function onDragEnterCapture(event: DragEvent) {
  if (!enabled || !hasFiles(event)) return;
  dragDepth += 1;
  dragging = true;
}

function onDragLeaveCapture() {
  if (!dragging) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) resetDrag();
}

/** Outside the titlebar zone, refuse unhandled file drops instead of letting
 * the browser navigate to the file. */
function onWindowDragOver(event: DragEvent) {
  if (!enabled || event.defaultPrevented || !hasFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
}

function onWindowDrop(event: DragEvent) {
  if (!enabled || event.defaultPrevented || !hasFiles(event)) return;
  event.preventDefault();
}

function onZoneDragOver(event: DragEvent) {
  if (!hasFiles(event)) return;
  event.preventDefault();
  overZone = true;
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}

function onZoneDragLeave() {
  overZone = false;
}

function collectDropped(event: DragEvent): DroppedPath[] {
  const getPath = getDesktopBridge()?.files?.getPathForFile;
  if (!getPath) return [];
  const result: DroppedPath[] = [];
  const items = Array.from(event.dataTransfer?.items ?? []).filter(
    (item) => item.kind === "file",
  );
  const files = Array.from(event.dataTransfer?.files ?? []);
  files.forEach((file, index) => {
    let path: string;
    try {
      path = getPath(file);
    } catch {
      return;
    }
    if (!path) return;
    const entry = items[index]?.webkitGetAsEntry?.();
    result.push({
      path,
      hint: entry ? (entry.isDirectory ? "folder" : "file") : "unknown",
    });
  });
  return result;
}

function onZoneDrop(event: DragEvent) {
  resetDrag();
  if (!enabled || !hasFiles(event)) return;
  event.preventDefault();
  const dropped = collectDropped(event);
  if (dropped.length > 0) void present(dropped);
}

async function classify(
  dropped: DroppedPath,
): Promise<{ item: DroppedItem; error?: string }> {
  if (dropped.hint !== "file") {
    try {
      const listing = await listDirectories(dropped.path);
      return {
        item: {
          path: dropped.path,
          kind: "folder",
          signals: listing.signals,
        },
      };
    } catch (caught) {
      if (dropped.hint === "folder") {
        return {
          item: { path: dropped.path, kind: "folder" },
          error: messageOf(caught),
        };
      }
    }
  }
  return { item: { path: dropped.path, kind: "file" } };
}

async function present(paths: DroppedPath[]) {
  const token = ++resolveToken;
  plan = undefined;
  error = undefined;
  busy = false;
  pick = 0;
  open = true;

  const classified = await Promise.all(paths.map(classify));
  let failure = classified.find((entry) => entry.error)?.error;
  const items = classified.map((entry) => entry.item);

  if (items.length === 1 && items[0].kind === "file") {
    const parent = dropParentPath(items[0].path);
    try {
      const listing = await listDirectories(parent);
      items[0] = {
        ...items[0],
        containingFolder: { path: parent, signals: listing.signals },
      };
    } catch (caught) {
      failure = messageOf(caught);
    }
  }
  if (token !== resolveToken) return;

  plan = buildDropPlan(items, projects, caseInsensitive);
  pick = Math.max(plan.defaultPick, 0);
  error = failure;
}

function cancel() {
  resolveToken += 1;
  open = false;
  plan = undefined;
  error = undefined;
  busy = false;
}

async function confirm() {
  const row = plan?.rows[pick];
  if (!row?.selectable || busy) return;
  busy = true;
  error = undefined;
  try {
    // The daemon is the authority: the folder must exist where it will run.
    await listDirectories(row.path);
  } catch (caught) {
    error = messageOf(caught);
    busy = false;
    return;
  }
  const { projectId, path } = row;
  cancel();
  if (projectId) await selectProject(projectId);
  else await openProjectDirectory(path);
}

function presentOpenRequest(paths: string[]) {
  if (!enabled || paths.length === 0) return;
  void present(paths.map((path) => ({ path, hint: "unknown" as const })));
}

onMount(() => {
  const bridge = getDesktopBridge();
  if (!bridge?.files?.getPathForFile) return;
  let disposed = false;
  let unsubscribe: (() => void) | undefined;
  void isLocalDesktopDaemon()
    .then((local) => {
      if (disposed || !local) return;
      enabled = true;
      unsubscribe = bridge.files.onOpenPathRequest?.(presentOpenRequest);
      void loadFilesystemLocations()
        .then((locations) => {
          separator = locations.separator;
          locationsHome = locations.home;
          caseInsensitive = locations.caseInsensitive;
        })
        .catch(() => undefined);
    })
    .catch(() => undefined);
  return () => {
    disposed = true;
    enabled = false;
    unsubscribe?.();
  };
});
</script>

<svelte:window
  ondragentercapture={onDragEnterCapture}
  ondragleavecapture={onDragLeaveCapture}
  ondragover={onWindowDragOver}
  ondropcapture={resetDrag}
  ondrop={onWindowDrop}
  ondragend={resetDrag}
/>

{#if enabled && dragging}
  <DropToOpenOverlay
    over={overZone}
    ondragover={onZoneDragOver}
    ondragleave={onZoneDragLeave}
    ondrop={onZoneDrop}
  />
{/if}

{#if enabled}
  <DropToOpenDialog
    bind:open
    bind:pick
    {plan}
    {busy}
    {error}
    {displayPath}
    onConfirm={() => void confirm()}
    onCancel={cancel}
  />
{/if}
