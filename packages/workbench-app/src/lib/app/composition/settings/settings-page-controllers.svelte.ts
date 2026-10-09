import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import type { Settings } from "$lib/api";
import { selection } from "$lib/application/workspace/selection.svelte";
import {
  retainConversationStore,
  type ConversationStore,
} from "$lib/features/conversations";
import { StoragePageController } from "$lib/features/settings/views/pages/storage/storage-page-state.svelte";
export type SettingsScope = "user" | "project";
export function createSettingsPageControllers() {
  let activeStore = $state<ConversationStore>();
  $effect(() => {
    const id = selection.conversationId;
    if (!id) {
      activeStore = undefined;
      return;
    }
    const retained = retainConversationStore(id);
    activeStore = retained.store;
    void retained.ready.catch(() => undefined);
    return retained.release;
  });
  const storageController = new StoragePageController();
  function readComposerSelection(): Settings["lastAgentSelection"] {
    const saved = settingsState.settingsDraft?.lastAgentSelection;
    if (!saved) throw new Error("Settings not loaded");
    const config = activeStore?.snapshot?.config;
    return config
      ? {
          ...saved,
          mode: config.mode,
          model: config.model,
          thinkingLevel: config.reasoningLevel,
          permissionRuleSetId: config.permissionRuleSetId,
        }
      : { ...saved };
  }
  return { storageController, readComposerSelection };
}
export type SettingsPageControllers = ReturnType<
  typeof createSettingsPageControllers
>;
