import { registerPromptSuggestionEventHandlers } from "$lib/features/prompt-suggestions";
import { registerGitEventHandlers } from "$lib/features/git";
import {
  registerProviderCatalogEventHandlers,
  registerSettingsEventHandlers,
} from "$lib/features/settings";
import { registerLaunchEventHandlers } from "$lib/features/launches";
import { registerProjectConfigurationHealthEffects } from "./register-project-configuration-health";
import { registerUsageEventHandlers } from "$lib/features/usage";

export function registerFeatureEventHandlers(): () => void {
  const unregister = [
    registerLaunchEventHandlers(),
    registerSettingsEventHandlers(),
    registerProviderCatalogEventHandlers(),
    registerUsageEventHandlers(),
    registerGitEventHandlers(),
    registerPromptSuggestionEventHandlers(),
    registerProjectConfigurationHealthEffects(),
  ];
  return () => {
    for (const dispose of unregister.splice(0)) dispose();
  };
}

import "$lib/app/composition/registrations/register-center-tabs.svelte";
