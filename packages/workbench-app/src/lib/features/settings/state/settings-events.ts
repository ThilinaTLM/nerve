import {
  onAnyEvent,
  onWorkbenchReconnect,
  type WorkbenchEvent,
} from "$lib/application/events/workbench-event-bus";
import { shouldRefreshSettings } from "$lib/application/workspace/workspace-event-policy";
import {
  hasPendingSettingsSave,
  loadSettingsPanel,
} from "$lib/application/settings";

export function registerSettingsEventHandlers(): () => void {
  const unregisterEvents = onAnyEvent(handleSettingsEvent);
  const unregisterReconnect = onWorkbenchReconnect(loadSettingsPanel);
  return () => {
    unregisterEvents();
    unregisterReconnect();
  };
}

function handleSettingsEvent(event: WorkbenchEvent): void {
  if (
    (event.type === "applicationConfiguration.updated" ||
      shouldRefreshSettings(event)) &&
    !(event.type.startsWith("settings.") && hasPendingSettingsSave())
  ) {
    void loadSettingsPanel();
  }
}
