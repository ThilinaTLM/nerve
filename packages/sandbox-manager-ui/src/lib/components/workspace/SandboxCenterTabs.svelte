<script lang="ts">
  import BookOpenText from "@lucide/svelte/icons/book-open-text";
  import Code2 from "@lucide/svelte/icons/code-2";
  import FileClock from "@lucide/svelte/icons/file-clock";
  import FileCode2 from "@lucide/svelte/icons/file-code-2";
  import FileText from "@lucide/svelte/icons/file-text";
  import ImageIcon from "@lucide/svelte/icons/image";
  import MessageSquare from "@lucide/svelte/icons/message-square";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Settings from "@lucide/svelte/icons/settings";
  import Terminal from "@lucide/svelte/icons/terminal";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import X from "@lucide/svelte/icons/x";
  import type { ContextMenuItem } from "@nervekit/ui/components/ui/context-menu-list";
  import { WorkbenchTabStrip } from "@nervekit/ui/components/workbench";
  import type {
    WorkbenchTabIdentity,
    WorkbenchTabModel,
  } from "@nervekit/ui/components/workbench";
  import { isMarkdownPath } from "@nervekit/ui/core/utils/file-display";
  import SandboxDashboard from "../dashboard/SandboxDashboard.svelte";
  import SandboxSettingsPanel from "../settings/SandboxSettingsPanel.svelte";
  import SandboxChatPane from "./SandboxChatPane.svelte";
  import SandboxFilePane from "./SandboxFilePane.svelte";
  import SandboxConfigView from "../../routes/SandboxConfigView.svelte";
  import SandboxEventsView from "../../routes/SandboxEventsView.svelte";
  import SandboxLogsView from "../../routes/SandboxLogsView.svelte";
  import { useSandboxCenter } from "../../state/sandbox-center.svelte";
  import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";
  import type {
    SandboxWorkspaceFileViewState,
    SandboxWorkspaceTabIdentity,
  } from "../../state/sandbox-ui-types";

  const store = useSandboxManagerStore();
  const center = useSandboxCenter();

  const SETTINGS_KIND = "settings";

  const chatTab: SandboxWorkspaceTabIdentity = { kind: "chat", id: "chat" };

  const sandboxId = $derived(center.selectedSandboxId);
  const detail = $derived(sandboxId ? store.details[sandboxId] : undefined);
  const record = $derived(
    sandboxId ? store.sandboxes.find((item) => item.sandboxId === sandboxId) : undefined,
  );
  const workspaceTabs = $derived(detail?.openWorkspaceTabs ?? (sandboxId ? [chatTab] : []));
  const activeWorkspaceTab = $derived(detail?.activeWorkspaceTab ?? chatTab);
  const fileViewsById = $derived(detail?.workspaceFileViewsById ?? {});
  const activeFileView = $derived(
    activeWorkspaceTab.kind === "file"
      ? fileViewsById[activeWorkspaceTab.id]
      : undefined,
  );

  const contentMode = $derived(
    center.mode === "settings" && center.settingsOpen
      ? "settings"
      : sandboxId
        ? "sandbox"
        : "dashboard",
  );

  function sameTab(a: SandboxWorkspaceTabIdentity, b: SandboxWorkspaceTabIdentity): boolean {
    return a.kind === b.kind && a.id === b.id;
  }

  function fileLabel(view: SandboxWorkspaceFileViewState | undefined, id: string): string {
    const path = view?.content?.relativePath || view?.path || id;
    const parts = path.split("/").filter(Boolean);
    return parts.at(-1) ?? path;
  }

  function fileTitle(view: SandboxWorkspaceFileViewState | undefined, id: string): string {
    return view?.content?.path || view?.path || id;
  }

  function isMarkdownView(view: SandboxWorkspaceFileViewState | undefined): boolean {
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
    if (tab.kind === "chat") {
      return { ...tab, label: "Chat", title: "Sandbox chat", active, icon: MessageSquare, closeable: false };
    }
    if (tab.kind === "diagnostic") {
      return { ...tab, label: diagnosticLabel(tab), title: diagnosticLabel(tab), active, icon: diagnosticIcon(tab), closeable: true };
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
        label: view?.displayMode === "rendered" ? "Show raw markdown" : "Show rendered markdown",
        icon: view?.displayMode === "rendered" ? BookOpenText : Code2,
        onClick: () => sandboxId && store.toggleWorkspaceFileDisplayMode(sandboxId, tab.id),
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
      void store.recoverConversationSnapshot(sandboxId).catch(() => undefined);
      return;
    }
    if (identity.kind === "file") {
      void store.refreshWorkspaceFile(sandboxId, identity.id);
      return;
    }
    if (identity.id === "logs") void store.loadLogs(sandboxId);
    if (identity.id === "config") void store.loadSandboxConfigYaml(sandboxId);
  }

  function buildMenuItems({
    tab,
    index,
  }: {
    tab: WorkbenchTabModel;
    tabs: WorkbenchTabModel[];
    index: number;
  }): ContextMenuItem[] {
    if (tab.kind === SETTINGS_KIND) {
      return [{ label: "Close Pane", icon: X, onSelect: () => center.closeSettings() }];
    }
    if (!sandboxId) return [];
    const identity = cast(tab);
    const workspaceIndex = workspaceTabs.findIndex((candidate) => sameTab(candidate, identity));
    const hasLeft = workspaceIndex > 0;
    const hasRight = workspaceIndex >= 0 && workspaceIndex < workspaceTabs.length - 1;
    const items: ContextMenuItem[] = [];
    if (identity.kind === "file") {
      const view = fileViewsById[identity.id];
      if (view?.content?.type === "text") {
        items.push({
          label: view.wrapLines ? "Disable line wrap" : "Wrap long lines",
          icon: Code2,
          onSelect: () => store.toggleWorkspaceFileLineWrap(sandboxId, identity.id),
        });
      }
    }
    items.push(
      { label: "Refresh", icon: RefreshCw, onSelect: () => handleRefresh(identity) },
      { type: "separator" },
      { label: "Close Pane", icon: X, disabled: identity.kind === "chat", onSelect: () => store.closeWorkspaceTab(sandboxId, identity) },
      { label: "Close Other Panes", icon: X, disabled: workspaceTabs.length <= 1, onSelect: () => store.closeOtherWorkspaceTabs(sandboxId, identity) },
      { label: "Close Panes on Right", icon: X, disabled: !hasRight, onSelect: () => store.closeWorkspaceTabsRight(sandboxId, identity) },
      { label: "Close Panes on Left", icon: X, disabled: !hasLeft, onSelect: () => store.closeWorkspaceTabsLeft(sandboxId, identity) },
    );
    return items;
  }
</script>

<div class="flex h-full min-h-0 min-w-0 flex-col bg-background">
  {#if unifiedTabs.length > 0}
    <WorkbenchTabStrip
      tabs={unifiedTabs}
      {buildMenuItems}
      onSelect={handleSelect}
      onClose={handleClose}
      onRefresh={handleRefresh}
      onCloseOther={(tab) => sandboxId && !isSettings(tab) && store.closeOtherWorkspaceTabs(sandboxId, cast(tab))}
      onCloseLeft={(tab) => sandboxId && !isSettings(tab) && store.closeWorkspaceTabsLeft(sandboxId, cast(tab))}
      onCloseRight={(tab) => sandboxId && !isSettings(tab) && store.closeWorkspaceTabsRight(sandboxId, cast(tab))}
      onNew={sandboxId ? () => store.startNewConversation(sandboxId) : undefined}
    />
  {/if}

  {#if contentMode === "settings"}
    <div class="min-h-0 min-w-0 flex-1">
      <SandboxSettingsPanel />
    </div>
  {:else if contentMode === "sandbox"}
    {#if !record}
      <div class="flex h-full items-center justify-center bg-background p-6">
        <div class="rounded-md border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          {detail?.loading ? "Loading sandbox…" : "Sandbox not found."}
        </div>
      </div>
    {:else}
      {#if record.lastError}
        <p class="flex-none border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">{record.lastError.code}: {record.lastError.message}</p>
      {/if}
      <div class="min-h-0 min-w-0 flex-1">
        {#if activeWorkspaceTab.kind === "file"}
          <SandboxFilePane view={activeFileView} />
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
    {/if}
  {:else}
    <div class="min-h-0 min-w-0 flex-1">
      <SandboxDashboard />
    </div>
  {/if}
</div>
