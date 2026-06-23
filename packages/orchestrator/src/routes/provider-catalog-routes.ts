import {
  upsertCustomProviderRequestSchema,
  upsertModelDefinitionRequestSchema,
} from "@nerve/shared";
import { Hono } from "hono";
import { providerApiKeySecretName, providerOAuthSecretName } from "../auth.js";
import { routeHandler } from "../http/responses.js";
import { routeParam } from "../http/route-params.js";
import type { OrchestratorState } from "../server.js";

async function publishChanged(
  state: OrchestratorState,
  provider?: string,
): Promise<void> {
  await state.events.publish("providers.catalog_changed", { provider });
  await state.events.publish("auth.providers_changed", { provider });
}

export function createProviderCatalogRoutes(state: OrchestratorState): Hono {
  const app = new Hono();

  app.get("/providers/catalog", async (c) => {
    await state.providerCatalog.ensureLoaded();
    return c.json(state.providerCatalog.catalog);
  });

  app.put(
    "/providers/custom",
    routeHandler(async (c) => {
      const provider = upsertCustomProviderRequestSchema.parse(
        await c.req.json(),
      );
      const catalog = await state.providerCatalog.upsertProvider(provider);
      await publishChanged(state, provider.id);
      return c.json(catalog);
    }),
  );

  app.delete(
    "/providers/custom/:id",
    routeHandler(async (c) => {
      const id = routeParam(c, "id");
      const catalog = await state.providerCatalog.deleteProvider(id);
      // Remove any stored credential for the deleted provider.
      await state.secrets.delete(providerApiKeySecretName(id));
      await state.secrets.delete(providerOAuthSecretName(id));
      await publishChanged(state, id);
      return c.json(catalog);
    }),
  );

  app.put(
    "/providers/models",
    routeHandler(async (c) => {
      const model = upsertModelDefinitionRequestSchema.parse(
        await c.req.json(),
      );
      const catalog = await state.providerCatalog.upsertModel(model);
      await publishChanged(state, model.provider);
      return c.json(catalog);
    }),
  );

  app.delete(
    "/providers/models/:provider/:modelId",
    routeHandler(async (c) => {
      const provider = routeParam(c, "provider");
      const modelId = routeParam(c, "modelId");
      const catalog = await state.providerCatalog.deleteModel(
        provider,
        modelId,
      );
      await publishChanged(state, provider);
      return c.json(catalog);
    }),
  );

  return app;
}
