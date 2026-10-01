import {
  atlassianProfileHealthSchema,
  authProviderMetadataSchema,
} from "./auth.js";
import { z } from "zod";
import { defineOperation } from "../../operations/definition.js";

const emptyParamsSchema = z.object({}).optional();

export const authOperationDefinitions = [
  defineOperation(
    "auth.providers.list",
    emptyParamsSchema,
    z.object({ providers: z.array(authProviderMetadataSchema) }),
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.auth.providers.list",
  ),
  defineOperation(
    "auth.integrationHealth.list",
    emptyParamsSchema,
    z.object({ profiles: z.array(atlassianProfileHealthSchema) }),
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.auth.integrationHealth.list",
  ),
  defineOperation(
    "auth.integrationHealth.check",
    z.object({ profileId: z.string().min(1).max(256) }),
    z.object({ health: atlassianProfileHealthSchema }),
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.auth.integrationHealth.check",
  ),
] as const;
