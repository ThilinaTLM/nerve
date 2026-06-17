import type { Settings, UpdateSettingsRequest } from "@nerve/shared";
import { apiGet, apiPut } from "../../../core/api/client";

export type SettingsResponse = Settings;
export type { UpdateSettingsRequest };

export async function getSettings(): Promise<Settings> {
  return apiGet<Settings>("/api/settings");
}

export async function updateSettings(
  patch: UpdateSettingsRequest,
): Promise<Settings> {
  return (await apiPut<{ settings: Settings }>("/api/settings", patch))
    .settings;
}
