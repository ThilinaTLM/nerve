import { z } from "zod";
import type { AccountKind } from "../extensions/settings-schema.js";
import { validateField } from "../extensions/validator.js";

/**
 * The accounts store (`config/accounts.json`): the user's accounts by kind.
 * Kinds, their fields and their secret labels come from extension manifests;
 * the store only knows the shape. Secrets live in the secret store.
 */

/** Kinds are extension-defined ids, so they use the extension id shape. */
const accountKindKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
  .max(64);

export const storedAccountSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(128),
    /** Values of the kind's non-secret fields. */
    fields: z.record(z.string(), z.unknown()),
  })
  .strict();
export type StoredAccount = z.infer<typeof storedAccountSchema>;

const uniqueAccountIds = (
  accounts: StoredAccount[],
  context: z.RefinementCtx,
): void => {
  const seen = new Set<string>();
  for (const [index, account] of accounts.entries()) {
    if (seen.has(account.id))
      context.addIssue({
        code: "custom",
        message: `Duplicate account id '${account.id}'`,
        path: [index, "id"],
      });
    seen.add(account.id);
  }
};

export const accountsConfigSchema = z
  .object({
    version: z.literal(2),
    accounts: z.record(
      accountKindKeySchema,
      z.array(storedAccountSchema).superRefine(uniqueAccountIds),
    ),
  })
  .strict();
export type AccountsConfig = z.infer<typeof accountsConfigSchema>;
export const defaultAccountsConfig: AccountsConfig = {
  version: 2,
  accounts: {},
};

/** An account as the app sees it; the secret itself never leaves the server. */
export const accountViewSchema = z.object({
  kind: z.string().min(1),
  id: z.string().min(1),
  name: z.string().min(1),
  fields: z.record(z.string(), z.unknown()),
  secretConfigured: z.boolean(),
});
export type AccountView = z.infer<typeof accountViewSchema>;

/** Secret-store id of an account's secret, as a provider credential id. */
export const ACCOUNT_SECRET_PREFIX = "account:";

export function accountSecretId(kind: string, id: string): string {
  return `${ACCOUNT_SECRET_PREFIX}${kind}:${id}`;
}

export function isAccountSecretId(value: string): boolean {
  return value.startsWith(ACCOUNT_SECRET_PREFIX);
}

/** The `name` field of a kind is the account name, never a stored field. */
export function accountKindFields(kind: AccountKind): AccountKind["fields"] {
  return Object.fromEntries(
    Object.entries(kind.fields).filter(([key]) => key !== "name"),
  );
}

export type AccountInputValidation =
  | { ok: true; name: string; fields: Record<string, unknown> }
  | { ok: false; message: string };

/**
 * Checks an account against its kind: the name is required, only the kind's
 * fields are accepted, and blank values are dropped. Normalizes values.
 */
export function validateAccountInput(
  kind: AccountKind,
  input: { name: string; fields: Record<string, unknown> },
): AccountInputValidation {
  const name = input.name.trim();
  if (!name) return { ok: false, message: "Enter an account name." };
  if (name.length > 128)
    return { ok: false, message: "The account name is too long." };
  const schema = accountKindFields(kind);
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input.fields)) {
    const field = schema[key];
    if (!field)
      return {
        ok: false,
        message: `${kind.label} has no field '${key}'.`,
      };
    if (value === undefined || value === null || value === "") continue;
    const checked = validateField(field, value);
    if (!checked.ok)
      return { ok: false, message: `${field.label}: ${checked.message}` };
    if (checked.value !== "") fields[key] = checked.value;
  }
  return { ok: true, name, fields };
}

/** Kinds are unique across extensions; a duplicate is a registry error. */
export function assertUniqueAccountKinds(
  extensions: readonly {
    id: string;
    accounts?: readonly Pick<AccountKind, "kind">[];
  }[],
): void {
  const owners = new Map<string, string>();
  for (const extension of extensions)
    for (const { kind } of extension.accounts ?? []) {
      const owner = owners.get(kind);
      if (owner !== undefined)
        throw new Error(
          `Account kind '${kind}' is defined by both '${owner}' and '${extension.id}'.`,
        );
      owners.set(kind, extension.id);
    }
}
