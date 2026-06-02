import {
  respondOAuthFlowRequestSchema,
  setProviderApiKeyRequestSchema,
  startOAuthFlowRequestSchema,
} from "@nerve/shared";
import { Hono } from "hono";
import { requireBearerAuth } from "../http/auth-middleware.js";
import { routeHandler } from "../http/responses.js";
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
  app.post(
    "/auth/oauth/flows",
    routeHandler(async (c) => {
      const authError = requireBearerAuth(c.req.raw, state.storage.localToken);
      if (authError) return authError;
      const body = startOAuthFlowRequestSchema.parse(await c.req.json());
      return c.json({ flow: state.oauthFlows.start(body.provider) });
    }),
  );
  app.get(
    "/auth/oauth/flows/:flowId",
    routeHandler((c) => {
      const authError = requireBearerAuth(c.req.raw, state.storage.localToken);
      if (authError) return authError;
      return c.json({ flow: state.oauthFlows.get(c.req.param("flowId")) });
    }),
  );
  app.post(
    "/auth/oauth/flows/:flowId/respond",
    routeHandler(async (c) => {
      const authError = requireBearerAuth(c.req.raw, state.storage.localToken);
      if (authError) return authError;
      const body = respondOAuthFlowRequestSchema.parse(await c.req.json());
      return c.json({
        flow: await state.oauthFlows.respond(c.req.param("flowId"), body),
      });
    }),
  );
  app.post(
    "/auth/oauth/flows/:flowId/cancel",
    routeHandler(async (c) => {
      const authError = requireBearerAuth(c.req.raw, state.storage.localToken);
      if (authError) return authError;
      return c.json({
        flow: await state.oauthFlows.cancel(c.req.param("flowId")),
      });
    }),
  );
  app.delete("/auth/providers/:provider", async (c) => {
    const authError = requireBearerAuth(c.req.raw, state.storage.localToken);
    if (authError) return authError;
    const provider = c.req.param("provider");
    await state.auth.deleteCredential(provider);
    await state.events.publish("auth.credential_deleted", { provider });
    await state.events.publish("auth.providers_changed", { provider });
    return c.json({ ok: true });
  });
  app.get("/provider-keys", async (c) => {
    const authError = requireBearerAuth(c.req.raw, state.storage.localToken);
    if (authError) return authError;
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
      const authError = requireBearerAuth(c.req.raw, state.storage.localToken);
      if (authError) return authError;
      const body = setProviderApiKeyRequestSchema.parse(await c.req.json());
      await state.auth.setApiKey(body.provider, body.apiKey);
      await state.events.publish("secrets.provider_key_set", {
        provider: body.provider,
      });
      await state.events.publish("auth.providers_changed", {
        provider: body.provider,
      });
      return c.json({ ok: true });
    }),
  );
  app.delete("/provider-keys/:provider", async (c) => {
    const authError = requireBearerAuth(c.req.raw, state.storage.localToken);
    if (authError) return authError;
    const provider = c.req.param("provider");
    await state.auth.deleteCredential(provider);
    await state.events.publish("secrets.provider_key_deleted", { provider });
    await state.events.publish("auth.providers_changed", { provider });
    return c.json({ ok: true });
  });

  return app;
}
