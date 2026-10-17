import type { Settings } from "@nervekit/contracts/settings";
import type { WorkbenchNoticePublisher } from "../events/index.js";

type SettingsEvents = Pick<WorkbenchNoticePublisher, "publish">;

export async function publishSettingsChanged(
  events: SettingsEvents,
  settings: Settings,
): Promise<void> {
  await events.publish("settings.updated", { settings });
}

export async function publishProviderCatalogChanged(
  events: SettingsEvents,
  provider: string,
): Promise<void> {
  await events.publish("providers.catalog_changed", { provider });
  await events.publish("auth.providers_changed", { provider });
}
