import type { AgentRecord, ModelInfo } from "$lib/api";
import {
  isEditableTarget,
  matchesShortcut,
} from "$lib/core/shortcuts/keyboard";
import {
  DEFAULT_SHORTCUTS,
  type ShortcutCommandId,
} from "$lib/core/shortcuts/registry";
import type { CenterTabIdentity } from "$lib/features/workspace";

type CenterTabLike = { kind: CenterTabIdentity["kind"]; id: string };

type AppShortcutsOptions = {
  currentZoomLevel: () => number;
  setUiZoomLevel: (value: number) => void;
  centerTabs: () => CenterTabLike[];
  activeCenterTab: () => CenterTabIdentity | undefined;
  selectCenterTab: (tab: CenterTabIdentity) => void | Promise<void>;
  newConversation: () => void;
  openProjectPicker: () => void;
  closeCenterTab: (tab: CenterTabIdentity) => void | Promise<void>;
  closeCenterTabs: (
    tabs: CenterTabIdentity[],
    except?: CenterTabIdentity,
  ) => void | Promise<void>;
  centerTabsExcept: (tab: CenterTabIdentity) => CenterTabIdentity[];
  refreshCenterTab: (tab: CenterTabIdentity) => void;
  focusProjectSearch: () => void;
  hasConversationComposer: () => boolean;
  sending: () => boolean;
  abortActiveRun: () => void | Promise<void>;
  composerEscape: () => void;
  toggleMic: () => void;
  selectedPermissionLevel: () => AgentRecord["permissionLevel"];
  setComposerPermission: (
    value: AgentRecord["permissionLevel"],
  ) => void | Promise<void>;
  usableModels: () => ModelInfo[];
  selectedModelKey: () => string;
  selectedThinkingLevel: () => AgentRecord["thinkingLevel"];
  setComposerThinkingLevel: (
    value: AgentRecord["thinkingLevel"],
  ) => void | Promise<void>;
  selectedMode: () => AgentRecord["mode"];
  setComposerMode: (value: AgentRecord["mode"]) => void | Promise<void>;
};

export function createAppShortcuts(options: AppShortcutsOptions) {
  function handleZoomShortcut(event: KeyboardEvent): boolean {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return false;
    if (event.key === "=" || event.key === "+") {
      event.preventDefault();
      options.setUiZoomLevel(options.currentZoomLevel() + 1);
      return true;
    }
    if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      options.setUiZoomLevel(options.currentZoomLevel() - 1);
      return true;
    }
    if (event.key === "0") {
      event.preventDefault();
      options.setUiZoomLevel(0);
      return true;
    }
    return false;
  }

  function centerTabIdentity(tab: CenterTabLike): CenterTabIdentity {
    if (tab.kind === "settings") return { kind: "settings", id: "settings" };
    if (tab.kind === "logs") return { kind: "logs", id: "logs" };
    return { kind: tab.kind, id: tab.id } as CenterTabIdentity;
  }

  function activeCenterTabIndex(): number {
    const activeCenterTab = options.activeCenterTab();
    if (!activeCenterTab) return -1;
    return options
      .centerTabs()
      .findIndex(
        (tab) =>
          tab.kind === activeCenterTab.kind && tab.id === activeCenterTab.id,
      );
  }

  function selectRelativeCenterTab(delta: number): boolean {
    const centerTabs = options.centerTabs();
    if (centerTabs.length === 0) return false;
    const currentIndex = activeCenterTabIndex();
    const startIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex =
      (startIndex + delta + centerTabs.length) % centerTabs.length;

    void options.selectCenterTab(centerTabIdentity(centerTabs[nextIndex]));
    return true;
  }

  function selectCenterTabByIndex(index: number): boolean {
    const tab = options.centerTabs()[index];
    if (!tab) return false;
    void options.selectCenterTab(centerTabIdentity(tab));
    return true;
  }

  function cyclePermissionLevel(): boolean {
    if (!options.hasConversationComposer()) return false;
    const order: NonNullable<AgentRecord["permissionLevel"]>[] = [
      "read_only",
      "supervised",
      "autonomous",
    ];
    const currentIndex = order.indexOf(options.selectedPermissionLevel());
    const next = order[(currentIndex + 1) % order.length] ?? order[0];
    void options.setComposerPermission(next);
    return true;
  }

  function cycleThinkingLevel(): boolean {
    if (!options.hasConversationComposer()) return false;
    const selectedModel = options.usableModels().find((model) => {
      const key = `${model.provider}:${model.modelId}`;
      return key === options.selectedModelKey();
    });
    const levels = selectedModel?.supportedThinkingLevels?.length
      ? selectedModel.supportedThinkingLevels
      : ["off" as const];
    const currentIndex = levels.indexOf(options.selectedThinkingLevel());
    const next =
      levels[(currentIndex + 1) % levels.length] ?? levels[0] ?? "off";
    void options.setComposerThinkingLevel(next);
    return true;
  }

  function toggleComposerModeShortcut(): boolean {
    if (!options.hasConversationComposer()) return false;
    void options.setComposerMode(
      options.selectedMode() === "coding" ? "planning" : "coding",
    );
    return true;
  }

  function runShortcutCommand(id: ShortcutCommandId): boolean {
    if (id.startsWith("pane.focusByIndex.")) {
      const index = Number(id.split(".").at(-1)) - 1;
      return Number.isInteger(index) && selectCenterTabByIndex(index);
    }

    const activeCenterTab = options.activeCenterTab();

    switch (id) {
      case "conversation.new":
        options.newConversation();
        return true;
      case "conversation.newFromProject":
        options.openProjectPicker();
        return true;
      case "pane.close":
        if (!activeCenterTab) return false;
        void options.closeCenterTab(activeCenterTab);
        return true;
      case "pane.closeOthers":
        if (!activeCenterTab) return false;
        void options.closeCenterTabs(
          options.centerTabsExcept(activeCenterTab),
          activeCenterTab,
        );
        return true;
      case "pane.refresh":
        if (!activeCenterTab) return false;
        options.refreshCenterTab(activeCenterTab);
        return true;
      case "pane.previous":
        return selectRelativeCenterTab(-1);
      case "pane.next":
        return selectRelativeCenterTab(1);
      case "projectSearch.focus":
        options.focusProjectSearch();
        return true;
      case "composer.focus":
      case "composer.cancelMic":
        if (!options.hasConversationComposer()) return false;
        options.composerEscape();
        return true;
      case "composer.stopRun":
        if (!options.sending()) return false;
        void options.abortActiveRun();
        return true;
      case "composer.toggleMic":
        if (!options.hasConversationComposer()) return false;
        options.toggleMic();
        return true;
      case "composer.toggleMode":
        return toggleComposerModeShortcut();
      case "composer.cyclePermission":
        return cyclePermissionLevel();
      case "composer.cycleThinking":
        return cycleThinkingLevel();
      case "zoom.in":
      case "zoom.out":
      case "zoom.reset":
      case "composer.send":
        return false;
    }
    return false;
  }

  function handleWorkbenchShortcut(event: KeyboardEvent) {
    if (handleZoomShortcut(event)) return;

    const command = DEFAULT_SHORTCUTS.find((candidate) =>
      matchesShortcut(event, candidate.defaultBinding),
    );
    if (!command) return;
    if (isEditableTarget(event.target) && !command.allowInEditable) return;

    const handled = runShortcutCommand(command.id);
    if (!handled) return;
    if (
      command.id !== "composer.focus" &&
      command.id !== "composer.cancelMic"
    ) {
      event.preventDefault();
    }
  }

  return {
    activeCenterTabIndex,
    centerTabIdentity,
    cyclePermissionLevel,
    cycleThinkingLevel,
    handleWorkbenchShortcut,
    handleZoomShortcut,
    runShortcutCommand,
    selectCenterTabByIndex,
    selectRelativeCenterTab,
    toggleComposerModeShortcut,
  };
}
