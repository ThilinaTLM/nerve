import { onAnyEvent, type WorkbenchEvent } from "$lib/kernel/events/event-bus";
import { shouldRefreshSettings } from "$lib/application/workspace/workspace-event-policy";
import {
  hasPendingSettingsSave,
  loadSettingsPanel,
} from "$lib/application/settings";

export function registerSettingsEventHandlers(): () => void {
  return onAnyEvent(handleSettingsEvent);
}

function handleSettingsEvent(event: WorkbenchEvent): void {
  if (
    (event.type === "applicationConfiguration.updated" ||
      shouldRefreshSettings(event.type)) &&
    !(event.type.startsWith("settings.") && hasPendingSettingsSave())
  ) {
    void loadSettingsPanel();
  }
}
