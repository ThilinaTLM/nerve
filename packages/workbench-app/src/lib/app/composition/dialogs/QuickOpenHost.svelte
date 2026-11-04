<script lang="ts">
import {
  QuickOpenDialog,
  filesystemWorkspaceReadModel,
  openFilePane,
  quickOpen,
  recentQuickOpenPaths,
  revealFileExplorerPath,
  type QuickOpenItem,
} from "$lib/features/filesystem";
import { fileViewKey } from "$lib/domain/navigation/view-keys";
import { workspaceSelectors } from "$lib/application/workspace";
import { notify } from "$lib/application/notifications/notify.svelte";
import { revealPanelView } from "$lib/app/shell/shell-layout.svelte";
import { responsive } from "$lib/app/shell/responsive.svelte";

const projectId = $derived(workspaceSelectors.activeProject?.id);
const activeTab = $derived(workspaceSelectors.activeCenterTab);

const recentPaths = $derived.by(() => {
  const views = filesystemWorkspaceReadModel.fileViews;
  const paths = filesystemWorkspaceReadModel.openFileTabIds.flatMap((id) => {
    const view = views[fileViewKey(id)];
    return view && view.projectId === projectId ? [view.path] : [];
  });
  const active =
    activeTab?.kind === "file"
      ? views[fileViewKey(activeTab.id)]?.path
      : undefined;
  return recentQuickOpenPaths(paths, active);
});

const parsed = $derived(quickOpen.parsed);
const recent = $derived(parsed.query === "");
const items = $derived<QuickOpenItem[]>(
  recent
    ? recentPaths.map((path) => ({ path, positions: [] }))
    : quickOpen.matches,
);

async function choose(item: QuickOpenItem, options: { reveal: boolean }) {
  const line = parsed.line;
  quickOpen.close();
  if (!projectId) return;
  if (options.reveal) {
    revealPanelView("files", responsive.isCompact);
    try {
      await revealFileExplorerPath(projectId, item.path);
    } catch (caught) {
      notify.error("Could not reveal file", {
        description: caught instanceof Error ? caught.message : String(caught),
      });
    }
    return;
  }
  await openFilePane({ projectId, path: item.path, line });
}
</script>

<QuickOpenDialog
  open={quickOpen.open}
  query={quickOpen.query}
  {items}
  line={recent ? undefined : parsed.line}
  {recent}
  loading={quickOpen.loading}
  indexing={quickOpen.incomplete}
  error={quickOpen.error}
  hasProject={projectId !== undefined}
  onQueryChange={(query) => quickOpen.setQuery(query)}
  onChoose={(item, options) => void choose(item, options)}
  onOpenChange={(open) => {
    if (!open) quickOpen.close();
  }}
/>
