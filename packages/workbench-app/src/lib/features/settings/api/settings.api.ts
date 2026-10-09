import type {
  ApplicationConfigurationSnapshot,
  NotificationTone,
  Settings,
  UpdateApplicationConfigurationRequest,
  UpdateSettingsRequest,
} from "@nervekit/contracts/settings";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";

export type SettingsResponse = Settings;
export type {
  ApplicationConfigurationSnapshot,
  NotificationTone,
  UpdateApplicationConfigurationRequest,
  UpdateSettingsRequest,
};

export async function getSettings(): Promise<Settings> {
  return await requestWorkbench("settings.get", {});
}

export async function updateSettings(
  patch: UpdateSettingsRequest,
): Promise<Settings> {
  return (await requestWorkbench("settings.update", patch)).settings;
}

export async function getApplicationConfiguration(): Promise<ApplicationConfigurationSnapshot> {
  return await requestWorkbench("applicationConfiguration.get", {});
}

export async function updateApplicationConfiguration(
  patch: UpdateApplicationConfigurationRequest,
): Promise<ApplicationConfigurationSnapshot> {
  return await requestWorkbench("applicationConfiguration.update", patch);
}
