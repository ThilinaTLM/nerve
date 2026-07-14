import { onAnyEvent, type WorkbenchEvent } from "$lib/core/events/event-bus";
import { shouldRefreshSettings } from "$lib/features/workspace/state/workspace-event-policy";
import {
  hasPendingSettingsSave,
  loadSettingsPanel,
} from "./settings-actions.svelte";

export function registerSettingsEventHandlers(): () => void {
  return onAnyEvent(handleSettingsEvent);
}

function handleSettingsEvent(event: WorkbenchEvent): void {
  if (
    shouldRefreshSettings(event.type) &&
    !(event.type.startsWith("settings.") && hasPendingSettingsSave())
  ) {
    void loadSettingsPanel();
  }
}
