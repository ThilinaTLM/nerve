import type {
  ApplicationConfigurationSnapshot,
  NotificationTone,
  Settings,
  UpdateApplicationConfigurationRequest,
  UpdateSettingsRequest,
} from "@nervekit/contracts";
import { protocolRequest } from "@nervekit/protocol";

export type SettingsResponse = Settings;
export type {
  ApplicationConfigurationSnapshot,
  NotificationTone,
  UpdateApplicationConfigurationRequest,
  UpdateSettingsRequest,
};

export async function getSettings(): Promise<Settings> {
  return (await protocolRequest("settings.get", {})).result;
}

export async function updateSettings(
  patch: UpdateSettingsRequest,
): Promise<Settings> {
  return (await protocolRequest("settings.update", patch)).result.settings;
}

export async function getApplicationConfiguration(): Promise<ApplicationConfigurationSnapshot> {
  return (await protocolRequest("applicationConfiguration.get", {})).result;
}

export async function updateApplicationConfiguration(
  patch: UpdateApplicationConfigurationRequest,
): Promise<ApplicationConfigurationSnapshot> {
  return (await protocolRequest("applicationConfiguration.update", patch))
    .result;
}
