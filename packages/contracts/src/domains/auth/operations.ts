import {
  accountHealthSchema,
  accountRefSchema,
  authProviderMetadataSchema,
  oauthFlowInfoSchema,
  duplicateAccountRequestSchema,
  moveAccountRequestSchema,
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
    // With a project: the accounts that project sees (user-level and its own); without: every account.
    z.object({ projectId: z.string().min(1).optional() }).optional(),
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
    "accounts.move",
    moveAccountRequestSchema,
    z.object({ account: accountViewSchema }),
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.accounts.move",
  ),
  defineOperation(
    "accounts.duplicate",
    duplicateAccountRequestSchema,
    z.object({ account: accountViewSchema }),
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.accounts.duplicate",
  ),
  defineOperation(
    "accounts.clearCredentials",
    accountRefSchema,
    z.object({ account: accountViewSchema }),
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.accounts.clearCredentials",
  ),
  defineOperation(
    "accounts.signIn",
    // Starts the sign-in of an account whose kind has a provider that signs in (oauth2). The prompts are
    // answered and cancelled through the OAuth flow routes, by flow id.
    accountRefSchema,
    z.object({ flow: oauthFlowInfoSchema }),
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.accounts.signIn",
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
