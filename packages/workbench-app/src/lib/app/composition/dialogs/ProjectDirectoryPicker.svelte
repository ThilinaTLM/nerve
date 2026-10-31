<script lang="ts">
import type { Project } from "$lib/api";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import { pathKey } from "$lib/domain/filesystem/project-path";
import { FolderBrowser } from "$lib/features/projects/state/folder-browser.svelte";
import { toDisplayPath } from "$lib/features/projects/state/folder-browser-path";
import FolderBrowserFooter from "$lib/features/projects/views/FolderBrowserFooter.svelte";
import FolderBrowserView from "$lib/features/projects/views/FolderBrowserView.svelte";

type Props = {
  open?: boolean;
  projects?: Project[];
  /** Folder to show first; defaults to the last folder browsed. */
  initialPath?: string;
  /** Where the folders live, e.g. "this computer"; omitted when unknown. */
  hostLabel?: string;
  onClose?: () => void;
  onSelectProject?: (projectId: string) => void | Promise<void>;
  onOpenDirectory?: (path: string) => void | Promise<void>;
};

let {
  open = $bindable(false),
  projects = [],
  initialPath,
  hostLabel,
  onClose,
  onSelectProject,
  onOpenDirectory,
}: Props = $props();

const browser = new FolderBrowser();
let wasOpen = false;

const caseInsensitive = $derived(browser.ctx.caseInsensitive);
const projectIdByKey = $derived(
  new Map(
    projects.map((project) => [
      pathKey(project.directory, caseInsensitive),
      project.id,
    ]),
  ),
);
const projectDirectories = $derived(projects.map((p) => p.directory));
const target = $derived(browser.target);
const knownProjectId = $derived(
  target ? projectIdByKey.get(pathKey(target, caseInsensitive)) : undefined,
);

function projectIdForPath(path: string): string | undefined {
  return projectIdByKey.get(pathKey(path, caseInsensitive));
}

function handleOpenChange(next: boolean) {
  open = next;
  if (!next) onClose?.();
}

async function openTarget() {
  if (!target) return;
  if (knownProjectId) await onSelectProject?.(knownProjectId);
  else await onOpenDirectory?.(target);
  handleOpenChange(false);
}

$effect(() => {
  if (open && !wasOpen) void browser.open(initialPath);
  wasOpen = open;
});
</script>

{#snippet footer()}
  <FolderBrowserFooter
    path={target}
    displayPath={target ? toDisplayPath(target, browser.ctx) : undefined}
    signals={browser.targetSignals}
    known={Boolean(knownProjectId)}
    busy={browser.loading || Boolean(browser.error)}
    onCancel={() => handleOpenChange(false)}
    onOpen={() => void openTarget()}
  />
{/snippet}

<Dialog
  flush
  bind:open
  title="Open project"
  description={hostLabel
    ? `Folders on ${hostLabel}`
    : "Choose a folder to open as a project"}
  class="project-picker-dialog"
  {footer}
  onOpenChange={handleOpenChange}
>
  <FolderBrowserView
    {browser}
    {projectDirectories}
    {projectIdForPath}
    onOpen={() => void openTarget()}
  />
</Dialog>

<style>
/* DialogShell portals its content, so the picker's geometry has to be declared
 * globally on the shell's own element (escape-hatch reason 5). The compound
 * selector keeps it ahead of `.dialog-content`'s default width. */
:global(.dialog-content.project-picker-dialog) {
  width: min(820px, calc(100vw - 24px));
  width: min(820px, calc(100dvw - 1.5rem));
  height: min(600px, calc(100vh - 48px));
  height: min(600px, calc(100dvh - 3rem));
  min-height: min(420px, calc(100vh - 48px));
  min-height: min(420px, calc(100dvh - 3rem));
  max-height: min(600px, calc(100vh - 48px));
  max-height: min(600px, calc(100dvh - 3rem));
}

@media (max-width: 639px) {
  :global(.dialog-content.project-picker-dialog) {
    width: calc(100vw - 12px);
    width: calc(100dvw - 0.75rem);
    height: calc(100vh - 12px);
    height: calc(100dvh - 0.75rem);
    max-height: calc(100vh - 12px);
    max-height: calc(100dvh - 0.75rem);
  }
}
</style>
