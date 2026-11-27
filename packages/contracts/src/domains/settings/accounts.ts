import { z } from "zod";
import { layerSchema } from "../core/scope.js";
import type { AccountKind } from "../extensions/settings-schema.js";
import { validateField } from "../extensions/validator.js";

/**
 * Accounts live in the `account` table of the Nerve home database. Kinds, their fields and their
 * secret labels come from extension manifests; secrets are only ever held by the credential vault.
 */

/** A user-level account is available in every project; a project-level one in one project. */
export const accountLevelSchema = layerSchema;
export type AccountLevel = z.infer<typeof accountLevelSchema>;

/**
 * What an account can do now. `ready`, `needs_sign_in` and `failed` are stored with the
 * credential; `unavailable` (the kind's extension is gone or off) is derived when read.
 */
export const accountStateSchema = z.enum([
  "ready",
  "needs_sign_in",
  "failed",
  "unavailable",
]);
export type AccountState = z.infer<typeof accountStateSchema>;

/** An account as the app sees it; the secret itself never leaves the server. */
export const accountViewSchema = z.object({
  kind: z.string().min(1),
  id: z.string().min(1),
  name: z.string().min(1),
  fields: z.record(z.string(), z.unknown()),
  level: accountLevelSchema,
  /** The project of a project-level account. */
  projectId: z.string().min(1).optional(),
  state: accountStateSchema,
  /** Why the account `failed`, as the provider reported it. */
  error: z.string().optional(),
});
export type AccountView = z.infer<typeof accountViewSchema>;

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
 * fields are accepted, and blank values are dropped. Normalizes values; URL fields lose a trailing slash.
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
    if (checked.value === "") continue;
    // Account URLs are origins that templates extend (`{siteUrl}/rest/...`).
    fields[key] =
      field.type === "string" && field.format === "url"
        ? String(checked.value).replace(/\/+$/, "")
        : checked.value;
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
