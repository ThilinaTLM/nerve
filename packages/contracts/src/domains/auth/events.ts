import { z } from "zod";
import { definePublicEvent } from "../../events/definition.js";
import { oauthFlowInfoSchema } from "./auth.js";

const workbenchRoles = ["workbench_server"] as const;
const providerSchema = z.string().min(1).max(128);
const accountPayloadSchema = z.object({
  kind: z.string().min(1).max(64),
  accountId: z.string().min(1).max(256),
});
const providerPayloadSchema = z.object({ provider: providerSchema });

export const authEventDefinitions = [
  definePublicEvent("providers.catalog_changed", providerPayloadSchema, {
    allowedSourceRoles: workbenchRoles,
    scope: ["provider"],
  }),
  definePublicEvent("auth.providers_changed", providerPayloadSchema, {
    allowedSourceRoles: workbenchRoles,
    scope: ["provider"],
  }),
  definePublicEvent(
    "auth.oauth_login_succeeded",
    z.object({ provider: providerSchema, flow: oauthFlowInfoSchema }),
    { allowedSourceRoles: workbenchRoles, scope: ["flow.flowId"] },
  ),
  definePublicEvent(
    "auth.oauth_login_failed",
    z.object({ provider: providerSchema, flow: oauthFlowInfoSchema }),
    { allowedSourceRoles: workbenchRoles, scope: ["flow.flowId"] },
  ),
  definePublicEvent(
    "auth.oauth_flow_updated",
    z.object({ flow: oauthFlowInfoSchema }),
    { allowedSourceRoles: workbenchRoles, scope: ["flow.flowId"] },
  ),
  definePublicEvent("accounts.changed", accountPayloadSchema, {
    allowedSourceRoles: workbenchRoles,
    scope: ["accountId"],
  }),
  definePublicEvent("accounts.health_changed", accountPayloadSchema, {
    allowedSourceRoles: workbenchRoles,
    scope: ["accountId"],
  }),
  definePublicEvent("auth.credential_deleted", providerPayloadSchema, {
    allowedSourceRoles: workbenchRoles,
    scope: ["provider"],
  }),
  definePublicEvent("secrets.provider_key_set", providerPayloadSchema, {
    allowedSourceRoles: workbenchRoles,
    scope: ["provider"],
  }),
  definePublicEvent("secrets.provider_key_deleted", providerPayloadSchema, {
    allowedSourceRoles: workbenchRoles,
    scope: ["provider"],
  }),
];
