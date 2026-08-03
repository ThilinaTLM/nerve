import { loadAuthPanel } from "$lib/features/auth";
import { refreshConversationView } from "$lib/features/conversations";
import { refreshFilePane } from "$lib/features/filesystem";
import { refreshDiffPane, refreshPrPane } from "$lib/features/git";
import { requestLogsRefresh } from "$lib/features/logs";
import { loadSettingsPanel } from "$lib/features/settings";
import { selectCenterTab } from "$lib/features/workspace";
import { createCenterTabRefresh } from "./center-tab-refresh";

export const refreshCenterTab = createCenterTabRefresh({
  refreshConversation: (id) => void refreshConversationView(id),
  selectTab: (tab) => void selectCenterTab(tab),
  refreshFile: (id) => void refreshFilePane(id),
  refreshPullRequest: (id) => void refreshPrPane(id),
  refreshDiff: (id) => void refreshDiffPane(id),
  loadSettings: () => void loadSettingsPanel(),
  loadAuth: () => void loadAuthPanel(),
  refreshLogs: requestLogsRefresh,
});
