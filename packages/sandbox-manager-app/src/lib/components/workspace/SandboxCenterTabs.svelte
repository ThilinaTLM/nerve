<script lang="ts">
import BookOpenText from "@lucide/svelte/icons/book-open-text";
import Code2 from "@lucide/svelte/icons/code-2";
import FileClock from "@lucide/svelte/icons/file-clock";
import FileCode2 from "@lucide/svelte/icons/file-code-2";
import FileText from "@lucide/svelte/icons/file-text";
import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
import ImageIcon from "@lucide/svelte/icons/image";
import LayoutDashboard from "@lucide/svelte/icons/layout-dashboard";
import MessageSquare from "@lucide/svelte/icons/message-square";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import Settings from "@lucide/svelte/icons/settings";
import Terminal from "@lucide/svelte/icons/terminal";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import X from "@lucide/svelte/icons/x";
import type { ContextMenuItem } from "@nervekit/workbench-ui/components/ui/context-menu-list";
import {
  WorkbenchCenter,
  WorkbenchTabStrip,
} from "@nervekit/workbench-ui/components/workbench";
import type {
  WorkbenchTabIdentity,
  WorkbenchTabModel,
} from "@nervekit/workbench-ui/components/workbench";
import { isMarkdownPath } from "@nervekit/workbench-ui/core/utils/file-display";
import SandboxDashboard from "../dashboard/SandboxDashboard.svelte";
import SandboxSettingsPanel from "../settings/SandboxSettingsPanel.svelte";
import SandboxChatPane from "./SandboxChatPane.svelte";
import SandboxEmptyCenterPlaceholder from "./SandboxEmptyCenterPlaceholder.svelte";
import SandboxFilePane from "./SandboxFilePane.svelte";
import SandboxSummaryTab from "./SandboxSummaryTab.svelte";
import SandboxPrPane from "./SandboxPrPane.svelte";
import SandboxTaskOutputPane from "./SandboxTaskOutputPane.svelte";
import SandboxConfigView from "../../routes/SandboxConfigView.svelte";
import SandboxEventsView from "../../routes/SandboxEventsView.svelte";
import SandboxLogsView from "../../routes/SandboxLogsView.svelte";
import { isPendingConversationId } from "../../state/sandbox-conversation-state";
import { sandboxCanCreateConversation } from "../../state/sandbox-lifecycle";
import { sandboxConversationById } from "../../state/sandbox-manager-selectors.svelte";
import { useSandboxCenter } from "../../state/sandbox-center.svelte";
import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";
import type {
  SandboxWorkspaceFileViewState,
  SandboxWorkspaceTabIdentity,
} from "../../state/sandbox-ui-types";

const store = useSandboxManagerStore();
const center = useSandboxCenter();

const SETTINGS_KIND = "settings";

const selectedSandboxId = $derived(center.selectedSandboxId);
const record = $derived(
  selectedSandboxId
    ? store.sandboxes.find((item) => item.sandboxId === selectedSandboxId)
    : undefined,
);
const sandboxId = $derived(record?.sandboxId);
const detail = $derived(sandboxId ? store.details[sandboxId] : undefined);
const workspaceTabs = $derived(detail?.openWorkspaceTabs ?? []);
const activeWorkspaceTab = $derived(detail?.activeWorkspaceTab);
const fileViewsById = $derived(detail?.workspaceFileViewsById ?? {});
const activeFileView = $derived(
  activeWorkspaceTab?.kind === "file"
    ? fileViewsById[activeWorkspaceTab.id]
    : undefined,
);
const canCreateConversation = $derived(
  sandboxCanCreateConversation(record, detail),
);

const contentMode = $derived(
  center.mode === "settings" && center.settingsOpen
    ? "settings"
    : selectedSandboxId
      ? "sandbox"
      : "dashboard",
);

function sameTab(
  a: SandboxWorkspaceTabIdentity | undefined,
  b: SandboxWorkspaceTabIdentity | undefined,
): boolean {
  return Boolean(a && b && a.kind === b.kind && a.id === b.id);
}

function fileLabel(
  view: SandboxWorkspaceFileViewState | undefined,
  id: string,
): string {
  const path = view?.content?.relativePath || view?.path || id;
  const parts = path.split("/").filter(Boolean);
  return parts.at(-1) ?? path;
}

function fileTitle(
  view: SandboxWorkspaceFileViewState | undefined,
  id: string,
): string {
  return view?.content?.path || view?.path || id;
}

function isMarkdownView(
  view: SandboxWorkspaceFileViewState | undefined,
): boolean {
  return Boolean(
    view &&
    (view.content?.type === "text" || !view.content) &&
    isMarkdownPath(view.content?.relativePath || view.path),
  );
}

function fileIcon(view: SandboxWorkspaceFileViewState | undefined) {
  if (view?.loading) return RefreshCw;
  if (view?.error) return TriangleAlert;
  if (view?.content?.type === "image") return ImageIcon;
  return FileText;
}

function diagnosticLabel(tab: SandboxWorkspaceTabIdentity): string {
  if (tab.kind !== "diagnostic") return "";
  if (tab.id === "logs") return "Logs";
  if (tab.id === "config") return "Config YAML";
  return "Events";
}

function diagnosticIcon(tab: SandboxWorkspaceTabIdentity) {
  if (tab.kind !== "diagnostic") return FileClock;
  if (tab.id === "logs") return Terminal;
  if (tab.id === "config") return FileCode2;
  return FileClock;
}

function toWorkbenchTab(tab: SandboxWorkspaceTabIdentity): WorkbenchTabModel {
  const active = contentMode === "sandbox" && sameTab(activeWorkspaceTab, tab);
  if (tab.kind === "summary") {
    const label = record?.name ?? record?.sandboxId ?? "Summary";
    return {
      ...tab,
      label,
      title: label,
      active,
      icon: LayoutDashboard,
      closeable: true,
    };
  }
  if (tab.kind === "chat") {
    const conversation = sandboxConversationById(detail, tab.id);
    const pending = isPendingConversationId(tab.id)
      ? detail?.pendingConversationsById[tab.id]
      : undefined;
    const label =
      pending?.title ??
      conversation?.title ??
      (tab.id.startsWith("conv_") ? tab.id : "Chat");
    return {
      ...tab,
      label,
      title: pending ? "Draft conversation" : `Sandbox chat ${tab.id}`,
      active,
      icon: MessageSquare,
      closeable: true,
    };
  }
  if (tab.kind === "task") {
    const task = detail?.tasks.find((item) => item.id === tab.id);
    return {
      ...tab,
      label: task?.name ?? task?.command ?? tab.id,
      title: task?.command ?? tab.id,
      active,
      icon: Terminal,
      running: task
        ? ["starting", "running", "ready", "stopping"].includes(task.status)
        : false,
      error: task?.status === "failed" ? "failed" : undefined,
      closeable: true,
    };
  }
  if (tab.kind === "pr") {
    const view = detail?.prViewsById[tab.id];
    return {
      ...tab,
      label: view?.detail ? `#${view.detail.number}` : `PR #${tab.number}`,
      title: view?.detail?.title ?? `${tab.repo}#${tab.number}`,
      active,
      icon: GitPullRequest,
      running: view?.loading,
      error: view?.error,
      closeable: true,
    };
  }
  if (tab.kind === "diagnostic") {
    return {
      ...tab,
      label: diagnosticLabel(tab),
      title: diagnosticLabel(tab),
      active,
      icon: diagnosticIcon(tab),
      closeable: true,
    };
  }
  const view = fileViewsById[tab.id];
  const model: WorkbenchTabModel = {
    ...tab,
    label: fileLabel(view, tab.id),
    title: fileTitle(view, tab.id),
    active,
    wide: true,
    running: view?.loading,
    error: view?.error,
    closeable: true,
    icon: fileIcon(view),
  };
  if (isMarkdownView(view)) {
    model.icon = undefined;
    model.toggle = {
      label:
        view?.displayMode === "rendered"
          ? "Show raw markdown"
          : "Show rendered markdown",
      icon: view?.displayMode === "rendered" ? BookOpenText : Code2,
      onClick: () =>
        sandboxId && store.toggleWorkspaceFileDisplayMode(sandboxId, tab.id),
    };
  }
  return model;
}

const settingsTab = $derived<WorkbenchTabModel>({
  kind: SETTINGS_KIND,
  id: SETTINGS_KIND,
  label: "Settings",
  title: "Settings",
  icon: Settings,
  active: contentMode === "settings",
  closeable: true,
});

const unifiedTabs = $derived<WorkbenchTabModel[]>([
  ...(sandboxId ? workspaceTabs.map(toWorkbenchTab) : []),
  ...(center.settingsOpen ? [settingsTab] : []),
]);

function isSettings(tab: WorkbenchTabIdentity): boolean {
  return tab.kind === SETTINGS_KIND;
}

function cast(tab: WorkbenchTabIdentity): SandboxWorkspaceTabIdentity {
  return tab as SandboxWorkspaceTabIdentity;
}

function handleSelect(tab: WorkbenchTabIdentity): void {
  if (isSettings(tab)) {
    center.openSettings();
    return;
  }
  if (!sandboxId) return;
  center.openSandbox(sandboxId);
  store.selectWorkspaceTab(sandboxId, cast(tab));
}

function handleClose(tab: WorkbenchTabIdentity): void {
  if (isSettings(tab)) {
    center.closeSettings();
    return;
  }
  if (sandboxId) store.closeWorkspaceTab(sandboxId, cast(tab));
}

function handleRefresh(tab: WorkbenchTabIdentity): void {
  if (isSettings(tab) || !sandboxId) return;
  const identity = cast(tab);
  if (identity.kind === "chat") {
    if (!isPendingConversationId(identity.id))
      void store
        .recoverConversationSnapshot(sandboxId, identity.id)
        .catch(() => undefined);
    return;
  }
  if (identity.kind === "file") {
    void store.refreshWorkspaceFile(sandboxId, identity.id);
    return;
  }
  if (identity.kind === "task") {
    void store.refreshSandboxTaskLogs(sandboxId, identity.id);
    return;
  }
  if (identity.kind === "pr") {
    void store.refreshSandboxPr(sandboxId, identity.repo, identity.number);
    return;
  }
  if (identity.kind === "summary") {
    void store.loadDetail(sandboxId);
    return;
  }
  if (identity.id === "logs") void store.loadLogs(sandboxId);
  if (identity.id === "config") void store.loadSandboxConfigYaml(sandboxId);
}

function buildMenuItems({
  tab,
}: {
  tab: WorkbenchTabModel;
}): ContextMenuItem[] {
  if (tab.kind === SETTINGS_KIND) {
    return [
      { label: "Close Pane", icon: X, onSelect: () => center.closeSettings() },
    ];
  }
  if (!sandboxId) return [];
  const identity = cast(tab);
  const workspaceIndex = workspaceTabs.findIndex((candidate) =>
    sameTab(candidate, identity),
  );
  const hasLeft = workspaceIndex > 0;
  const hasRight =
    workspaceIndex >= 0 && workspaceIndex < workspaceTabs.length - 1;
  const items: ContextMenuItem[] = [];
  if (identity.kind === "file") {
    const view = fileViewsById[identity.id];
    if (view?.content?.type === "text") {
      items.push({
        label: view.wrapLines ? "Disable line wrap" : "Wrap long lines",
        icon: Code2,
        onSelect: () =>
          store.toggleWorkspaceFileLineWrap(sandboxId, identity.id),
      });
    }
  }
  items.push(
    {
      label: "Refresh",
      icon: RefreshCw,
      onSelect: () => handleRefresh(identity),
    },
    { type: "separator" },
    {
      label: "Close Pane",
      icon: X,
      onSelect: () => store.closeWorkspaceTab(sandboxId, identity),
    },
    {
      label: "Close Other Panes",
      icon: X,
      disabled: workspaceTabs.length <= 1,
      onSelect: () => store.closeOtherWorkspaceTabs(sandboxId, identity),
    },
    {
      label: "Close Panes on Right",
      icon: X,
      disabled: !hasRight,
      onSelect: () => store.closeWorkspaceTabsRight(sandboxId, identity),
    },
    {
      label: "Close Panes on Left",
      icon: X,
      disabled: !hasLeft,
      onSelect: () => store.closeWorkspaceTabsLeft(sandboxId, identity),
    },
  );
  return items;
}
</script>

<WorkbenchCenter contentVisible={true}>
  {#snippet tabStrip()}
    {#if unifiedTabs.length > 0}
      <WorkbenchTabStrip
        tabs={unifiedTabs}
        {buildMenuItems}
        onSelect={handleSelect}
        onClose={handleClose}
        onRefresh={handleRefresh}
        onCloseOther={(tab) =>
          sandboxId &&
          !isSettings(tab) &&
          store.closeOtherWorkspaceTabs(sandboxId, cast(tab))}
        onCloseLeft={(tab) =>
          sandboxId &&
          !isSettings(tab) &&
          store.closeWorkspaceTabsLeft(sandboxId, cast(tab))}
        onCloseRight={(tab) =>
          sandboxId &&
          !isSettings(tab) &&
          store.closeWorkspaceTabsRight(sandboxId, cast(tab))}
        onNew={sandboxId && canCreateConversation
          ? () => store.startNewConversation(sandboxId)
          : undefined}
      />
    {/if}
  {/snippet}
  {#snippet content()}
    <div class="sandbox-center-content">
      {#if contentMode === "settings"}
        <SandboxSettingsPanel />
      {:else if contentMode === "sandbox"}
        {#if !record}
          <SandboxEmptyCenterPlaceholder />
        {:else}
          <div class="flex h-full min-h-0 min-w-0 flex-col">
            {#if record.lastError && activeWorkspaceTab?.kind !== "summary"}
              <p
                class="flex-none border-b bg-destructive/10 px-4 py-2 text-xs text-destructive"
              >
                {record.lastError.code}: {record.lastError.message}
              </p>
            {/if}
            <div class="min-h-0 min-w-0 flex-1">
              {#if !activeWorkspaceTab}
                <SandboxEmptyCenterPlaceholder />
              {:else if activeWorkspaceTab.kind === "summary"}
                <SandboxSummaryTab {record} />
              {:else if activeWorkspaceTab.kind === "file"}
                <SandboxFilePane view={activeFileView} />
              {:else if activeWorkspaceTab.kind === "task"}
                <SandboxTaskOutputPane
                  {record}
                  taskId={activeWorkspaceTab.id}
                />
              {:else if activeWorkspaceTab.kind === "pr"}
                <SandboxPrPane {record} viewId={activeWorkspaceTab.id} />
              {:else if activeWorkspaceTab.kind === "diagnostic"}
                {#if activeWorkspaceTab.id === "logs"}
                  <SandboxLogsView {record} />
                {:else if activeWorkspaceTab.id === "config"}
                  <SandboxConfigView {record} />
                {:else}
                  <SandboxEventsView {record} />
                {/if}
              {:else}
                <SandboxChatPane sandboxId={record.sandboxId} />
              {/if}
            </div>
          </div>
        {/if}
      {:else}
        <SandboxDashboard />
      {/if}
    </div>
  {/snippet}
</WorkbenchCenter>

<style>
/* WorkbenchCenter owns the tab/content rows; this host wrapper stretches
     the single active view through the full content row. */
.sandbox-center-content {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  min-height: 0;
  min-width: 0;
  background: var(--background);
}
</style>
