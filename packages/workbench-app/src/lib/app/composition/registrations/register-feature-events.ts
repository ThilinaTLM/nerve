import { registerPromptSuggestionEventHandlers } from "$lib/features/prompt-suggestions";
import { registerGitEventHandlers } from "$lib/features/git";
import {
  registerProviderCatalogEventHandlers,
  registerSettingsEventHandlers,
} from "$lib/features/settings";
import { registerTaskEventHandlers } from "$lib/features/tasks";
import { registerUsageEventHandlers } from "$lib/features/usage";

export function registerFeatureEventHandlers(): () => void {
  const unregister = [
    registerTaskEventHandlers(),
    registerSettingsEventHandlers(),
    registerProviderCatalogEventHandlers(),
    registerUsageEventHandlers(),
    registerGitEventHandlers(),
    registerPromptSuggestionEventHandlers(),
  ];
  return () => {
    for (const dispose of unregister.splice(0)) dispose();
  };
}

import "$lib/app/composition/registrations/register-center-tabs.svelte";
