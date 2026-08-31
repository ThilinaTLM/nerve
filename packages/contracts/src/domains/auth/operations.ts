import { authProviderMetadataSchema } from "./auth.js";
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
] as const;
