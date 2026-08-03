import type { CenterTabIdentity } from "$lib/features/workspace";

export type CenterTabRefreshDependencies = {
  refreshConversation(id: string): void;
  selectTab(tab: CenterTabIdentity): void;
  refreshFile(id: string): void;
  refreshPullRequest(id: string): void;
  refreshDiff(id: string): void;
  loadSettings(): void;
  loadAuth(): void;
  refreshLogs(): void;
};

export function createCenterTabRefresh(
  dependencies: CenterTabRefreshDependencies,
): (tab: CenterTabIdentity) => void {
  return (tab) => {
    switch (tab.kind) {
      case "conversation":
        dependencies.refreshConversation(tab.id);
        return;
      case "pending-conversation":
      case "task":
        dependencies.selectTab(tab);
        return;
      case "file":
        dependencies.refreshFile(tab.id);
        return;
      case "pr":
        dependencies.refreshPullRequest(tab.id);
        return;
      case "diff":
        dependencies.refreshDiff(tab.id);
        return;
      case "settings":
        dependencies.loadSettings();
        return;
      case "auth":
        dependencies.loadAuth();
        return;
      case "logs":
        dependencies.refreshLogs();
        return;
    }
  };
}
