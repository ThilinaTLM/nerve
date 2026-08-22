import { refreshConversationView } from "$lib/features/conversations";
import { refreshFilePane, refreshMermaidPane } from "$lib/features/filesystem";
import { refreshDiffPane, refreshPrPane } from "$lib/features/git";
import { requestLogsRefresh } from "$lib/features/logs";
import { loadSettingsPanel } from "$lib/application/settings";
import { selectCenterTab } from "$lib/application/workspace";
import { createCenterTabRefresh } from "./center-tab-refresh";

export const refreshCenterTab = createCenterTabRefresh({
  refreshConversation: (id) => void refreshConversationView(id),
  selectTab: (tab) => void selectCenterTab(tab),
  refreshFile: (id) => void refreshFilePane(id),
  refreshMermaid: (id) => void refreshMermaidPane(id),
  refreshPullRequest: (id) => void refreshPrPane(id),
  refreshDiff: (id) => void refreshDiffPane(id),
  loadSettings: () => void loadSettingsPanel(),
  refreshLogs: requestLogsRefresh,
});
