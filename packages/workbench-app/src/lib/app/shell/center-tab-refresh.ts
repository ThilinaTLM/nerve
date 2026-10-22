import type { CenterTabIdentity } from "$lib/application/workspace";

export type CenterTabRefreshDependencies = {
  refreshConversation(id: string): void;
  refreshAsyncBash(id: string): void;
  selectTab(tab: CenterTabIdentity): void;
  refreshFile(id: string): void;
  refreshMermaid(id: string): void;
  refreshPullRequest(id: string): void;
  refreshDiff(id: string): void;
  loadSettings(): void;
  refreshLogs(): void;
};

export function createCenterTabRefresh(
  dependencies: CenterTabRefreshDependencies,
): (tab: CenterTabIdentity) => void {
  return (tab) => {
    switch (tab.kind) {
      case "async-bash":
        dependencies.refreshAsyncBash(tab.id);
        return;
      case "conversation":
        dependencies.refreshConversation(tab.id);
        return;
      case "pending-conversation":
      case "launch":
      case "discover":
        dependencies.selectTab(tab);
        return;
      case "system-prompt":
        // Snapshot of one request; reopening it fetches a new one.
        return;
      case "file":
        dependencies.refreshFile(tab.id);
        return;
      case "mermaid":
        dependencies.refreshMermaid(tab.id);
        return;
      case "pr":
        dependencies.refreshPullRequest(tab.id);
        return;
      case "diff":
        dependencies.refreshDiff(tab.id);
        return;
      case "settings":
      case "project-settings":
        dependencies.loadSettings();
        return;
      case "logs":
        dependencies.refreshLogs();
        return;
    }
  };
}
