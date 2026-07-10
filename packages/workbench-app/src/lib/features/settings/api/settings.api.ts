import type { Settings, UpdateSettingsRequest } from "@nervekit/contracts";
import { protocolRequest } from "../../../core/protocol/http-client";

export type SettingsResponse = Settings;
export type { UpdateSettingsRequest };

export async function getSettings(): Promise<Settings> {
  return (await protocolRequest<Settings>("settings.get", {})).result;
}

export async function updateSettings(
  patch: UpdateSettingsRequest,
): Promise<Settings> {
  return (
    await protocolRequest<{ settings: Settings }>("settings.update", patch)
  ).result.settings;
}
