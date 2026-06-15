import {
  respondOAuthFlowRequestSchema,
  setProviderApiKeyRequestSchema,
  startOAuthFlowRequestSchema,
} from "@nerve/shared";
import { Hono } from "hono";
import { routeHandler } from "../http/responses.js";
import { routeParam } from "../http/route-params.js";
import type { OrchestratorState } from "../server.js";

export function createAuthRoutes(state: OrchestratorState): Hono {
  const app = new Hono();

  app.get("/auth/providers", async (c) =>
    c.json({
      providers: await state.auth.listProviderMetadata(
        state.registry.listModels(),
      ),
    }),
  );
  app.get("/auth/credential-key", (c) =>
    c.json(state.credentialKey.getPublicKey()),
  );
  app.post(
    "/auth/oauth/flows",
    routeHandler(async (c) => {
      const body = startOAuthFlowRequestSchema.parse(await c.req.json());
      return c.json({ flow: state.oauthFlows.start(body.provider) });
    }),
  );
  app.get(
    "/auth/oauth/flows/:flowId",
    routeHandler((c) =>
      c.json({ flow: state.oauthFlows.get(routeParam(c, "flowId")) }),
    ),
  );
  app.post(
    "/auth/oauth/flows/:flowId/respond",
    routeHandler(async (c) => {
      const body = respondOAuthFlowRequestSchema.parse(await c.req.json());
      return c.json({
        flow: await state.oauthFlows.respond(routeParam(c, "flowId"), body),
      });
    }),
  );
  app.post(
    "/auth/oauth/flows/:flowId/cancel",
    routeHandler(async (c) =>
      c.json({
        flow: await state.oauthFlows.cancel(routeParam(c, "flowId")),
      }),
    ),
  );
  app.delete(
    "/auth/providers/:provider",
    routeHandler(async (c) => {
      const provider = routeParam(c, "provider");
      await state.auth.deleteCredential(provider);
      await state.events.publish("auth.credential_deleted", { provider });
      await state.events.publish("auth.providers_changed", { provider });
      return c.json({ ok: true });
    }),
  );
  app.get("/provider-keys", async (c) => {
    const providers = await state.auth.listProviderMetadata(
      state.registry.listModels(),
    );
    return c.json({
      keys: providers
        .filter((provider) => provider.supportsApiKey)
        .map((provider) => ({
          provider: provider.provider,
          envVar: provider.envVar ?? "",
          configured: provider.credentialType === "api_key",
        })),
    });
  });
  app.put(
    "/provider-keys",
    routeHandler(async (c) => {
      const body = setProviderApiKeyRequestSchema.parse(await c.req.json());
      const apiKey = body.encryptedApiKey
        ? state.credentialKey.decryptEnvelope(body.encryptedApiKey)
        : body.apiKey;
      if (!apiKey) {
        throw new Error("Missing API key.");
      }
      await state.auth.setApiKey(body.provider, apiKey);
      await state.events.publish("secrets.provider_key_set", {
        provider: body.provider,
      });
      await state.events.publish("auth.providers_changed", {
        provider: body.provider,
      });
      return c.json({ ok: true });
    }),
  );
  app.delete(
    "/provider-keys/:provider",
    routeHandler(async (c) => {
      const provider = routeParam(c, "provider");
      await state.auth.deleteCredential(provider);
      await state.events.publish("secrets.provider_key_deleted", { provider });
      await state.events.publish("auth.providers_changed", { provider });
      return c.json({ ok: true });
    }),
  );

  return app;
}
