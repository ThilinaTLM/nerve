<script lang="ts">
  import BookOpenText from "@lucide/svelte/icons/book-open-text";
  import Code2 from "@lucide/svelte/icons/code-2";
  import FileClock from "@lucide/svelte/icons/file-clock";
  import FileCode2 from "@lucide/svelte/icons/file-code-2";
  import FileText from "@lucide/svelte/icons/file-text";
  import ImageIcon from "@lucide/svelte/icons/image";
  import MessageSquare from "@lucide/svelte/icons/message-square";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Terminal from "@lucide/svelte/icons/terminal";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import X from "@lucide/svelte/icons/x";
  import { WorkbenchTabStrip } from "@nervekit/ui/components/workbench";
  import type { WorkbenchTabIdentity, WorkbenchTabModel } from "@nervekit/ui/components/workbench";
  import type { ContextMenuItem } from "@nervekit/ui/components/ui/context-menu-list";
  import { isMarkdownPath } from "@nervekit/ui/core/utils/file-display";
  import type {
    SandboxWorkspaceFileViewState,
    SandboxWorkspaceTabIdentity,
  } from "../../state/sandbox-ui-types";

  let {
    tabs,
    activeTab,
    fileViewsById,
    onSelect,
    onClose,
    onRefresh,
    onCloseOther,
    onCloseLeft,
    onCloseRight,
    onToggleFileDisplayMode,
    onToggleFileLineWrap,
    onNewConversation,
  }: {
    tabs: SandboxWorkspaceTabIdentity[];
    activeTab: SandboxWorkspaceTabIdentity;
    fileViewsById: Record<string, SandboxWorkspaceFileViewState>;
    onSelect: (tab: SandboxWorkspaceTabIdentity) => void;
    onClose: (tab: SandboxWorkspaceTabIdentity) => void;
    onRefresh: (tab: SandboxWorkspaceTabIdentity) => void;
    onCloseOther?: (tab: SandboxWorkspaceTabIdentity) => void;
    onCloseLeft?: (tab: SandboxWorkspaceTabIdentity) => void;
    onCloseRight?: (tab: SandboxWorkspaceTabIdentity) => void;
    onToggleFileDisplayMode: (fileTabId: string) => void;
    onToggleFileLineWrap: (fileTabId: string) => void;
    onNewConversation?: () => void;
  } = $props();

  const workbenchTabs = $derived(tabs.map(toWorkbenchTab));

  function sameTab(a: SandboxWorkspaceTabIdentity, b: SandboxWorkspaceTabIdentity): boolean {
    return a.kind === b.kind && a.id === b.id;
  }

  function cast(tab: WorkbenchTabIdentity): SandboxWorkspaceTabIdentity {
    return tab as SandboxWorkspaceTabIdentity;
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
    return Boolean(view && (view.content?.type === "text" || !view.content) && isMarkdownPath(view.content?.relativePath || view.path));
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
    const active = sameTab(activeTab, tab);
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
        onClick: () => onToggleFileDisplayMode(tab.id),
      };
    }
    return model;
  }

  function menuItems(tab: WorkbenchTabModel): ContextMenuItem[] {
    const identity = cast(tab);
    const index = tabs.findIndex((candidate) => sameTab(candidate, identity));
    const hasLeft = index > 0;
    const hasRight = index >= 0 && index < tabs.length - 1;
    const items: ContextMenuItem[] = [];
    if (identity.kind === "file") {
      const view = fileViewsById[identity.id];
      if (view?.content?.type === "text") {
        items.push({
          label: view.wrapLines ? "Disable line wrap" : "Wrap long lines",
          icon: Code2,
          onSelect: () => onToggleFileLineWrap(identity.id),
        });
      }
    }
    items.push(
      { label: "Refresh", icon: RefreshCw, onSelect: () => onRefresh(identity) },
      { type: "separator" },
      { label: "Close Pane", icon: X, disabled: identity.kind === "chat", onSelect: () => onClose(identity) },
      { label: "Close Other Panes", icon: X, disabled: tabs.length <= 1 || !onCloseOther, onSelect: () => onCloseOther?.(identity) },
      { label: "Close Panes on Right", icon: X, disabled: !hasRight || !onCloseRight, onSelect: () => onCloseRight?.(identity) },
      { label: "Close Panes on Left", icon: X, disabled: !hasLeft || !onCloseLeft, onSelect: () => onCloseLeft?.(identity) },
    );
    return items;
  }
</script>

<WorkbenchTabStrip
  tabs={workbenchTabs}
  buildMenuItems={({ tab }) => menuItems(tab)}
  onSelect={(tab) => onSelect(cast(tab))}
  onClose={(tab) => onClose(cast(tab))}
  onRefresh={(tab) => onRefresh(cast(tab))}
  onCloseOther={(tab) => onCloseOther?.(cast(tab))}
  onCloseLeft={(tab) => onCloseLeft?.(cast(tab))}
  onCloseRight={(tab) => onCloseRight?.(cast(tab))}
  onNew={onNewConversation}
/>
