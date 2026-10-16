import { Hono } from "hono";
import { settingsResolutionRequestSchema } from "@nervekit/contracts/settings";
import type { ProviderCatalogStore } from "../../../domains/providers/provider-catalog.store.js";
import type { WorkbenchNoticePublisher } from "../../../infrastructure/events/index.js";
import {
  publishSettingsChanged,
  publishProviderCatalogChanged,
} from "../../../infrastructure/configuration/settings-notifications.js";
import type { InitializedStorage } from "../../../infrastructure/storage-bootstrap/index.js";
import { serializeSettingsMutation } from "../../../infrastructure/storage-bootstrap/settings-mutations.js";
import {
  readHomeConfiguration,
  readSettingsHealth,
  reloadHomeConfigurationDocument,
  resetHomeConfigurationDocument,
  settingsFromConfiguration,
} from "../../../infrastructure/configuration/home-configuration.js";

export function createSettingsHealthRoutes({
  storage,
  events,
  providerCatalog,
}: {
  storage: InitializedStorage;
  events: Pick<WorkbenchNoticePublisher, "publish">;
  providerCatalog: Pick<ProviderCatalogStore, "load">;
}): Hono {
  const app = new Hono();
  app.get("/settings/health", async (c) =>
    c.json(await readSettingsHealth(storage.paths)),
  );
  app.post("/settings/health/resolve", async (c) => {
    const parsed = settingsResolutionRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success)
      return c.json(
        {
          error: { message: "Choose a settings document and reset or reload." },
        },
        400,
      );
    try {
      const health = await serializeSettingsMutation(storage, async () => {
        const providerIds = new Set([
          ...storage.configuration.providers.providers.map(
            (provider) => provider.id,
          ),
          ...storage.configuration.providers.models.map(
            (model) => model.provider,
          ),
          ...storage.configuration.providers.authentication.map(
            (auth) => auth.provider,
          ),
        ]);
        if (parsed.data.action === "reset")
          await resetHomeConfigurationDocument(storage.paths, parsed.data.id);
        else
          await reloadHomeConfigurationDocument(storage.paths, parsed.data.id);
        storage.configuration = await readHomeConfiguration(storage.paths);
        storage.settings = settingsFromConfiguration(storage.configuration);
        const health = await readSettingsHealth(storage.paths);
        if (!health.invalid.some((item) => item.id === parsed.data.id)) {
          if (parsed.data.id === "providers") {
            await providerCatalog.load();
            for (const provider of storage.configuration.providers.providers)
              providerIds.add(provider.id);
            for (const model of storage.configuration.providers.models)
              providerIds.add(model.provider);
            for (const auth of storage.configuration.providers.authentication)
              providerIds.add(auth.provider);
            for (const provider of providerIds)
              await publishProviderCatalogChanged(events, provider);
          }
          await publishSettingsChanged(events, storage.settings);
        }
        return health;
      });
      return c.json(health);
    } catch (error) {
      return c.json(
        {
          error: {
            message:
              error instanceof Error
                ? error.message
                : "Could not resolve settings.",
          },
        },
        409,
      );
    }
  });
  return app;
}
