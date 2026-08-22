import { registerConversationEventHandlers } from "$lib/features/conversations";
import { registerGitEventHandlers } from "$lib/features/git";
import { registerNotificationEventHandlers } from "$lib/application/notifications";
import { registerPromptSuggestionEventHandlers } from "$lib/features/prompt-suggestions";
import {
  registerProviderCatalogEventHandlers,
  registerSettingsEventHandlers,
} from "$lib/features/settings";
import { registerTaskEventHandlers } from "$lib/features/tasks";
import { registerUsageEventHandlers } from "$lib/features/usage";
import { registerWorkspaceEventHandlers } from "$lib/application/workspace/workspace-events";

export function registerFeatureEventHandlers(): () => void {
  const unregister = [
    registerWorkspaceEventHandlers(),
    registerConversationEventHandlers(),
    registerTaskEventHandlers(),
    registerSettingsEventHandlers(),
    registerProviderCatalogEventHandlers(),
    registerUsageEventHandlers(),
    registerNotificationEventHandlers(),
    registerPromptSuggestionEventHandlers(),
    registerGitEventHandlers(),
  ];
  return () => {
    for (const dispose of unregister.splice(0)) dispose();
  };
}

import "$lib/app/composition/register-center-tabs.svelte";
