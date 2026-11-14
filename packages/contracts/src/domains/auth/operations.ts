import {
  accountHealthSchema,
  accountRefSchema,
  authProviderMetadataSchema,
  saveAccountRequestSchema,
} from "./auth.js";
import { accountKindSchema } from "../extensions/settings-schema.js";
import { accountViewSchema } from "../settings/accounts.js";
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
    "accounts.list",
    emptyParamsSchema,
    z.object({
      accounts: z.array(accountViewSchema),
      /** The kinds the registered extensions define, with their fields and secret labels. */
      kinds: z.array(accountKindSchema),
    }),
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.accounts.list",
  ),
  defineOperation(
    "accounts.save",
    saveAccountRequestSchema,
    z.object({ account: accountViewSchema }),
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.accounts.save",
  ),
  defineOperation(
    "accounts.delete",
    accountRefSchema,
    z.object({ deleted: z.boolean() }),
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.accounts.delete",
  ),
  defineOperation(
    "accounts.health.list",
    emptyParamsSchema,
    z.object({ health: z.array(accountHealthSchema) }),
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.accounts.health.list",
  ),
  defineOperation(
    "accounts.test",
    accountRefSchema,
    z.object({ health: accountHealthSchema }),
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.accounts.test",
  ),
] as const;
