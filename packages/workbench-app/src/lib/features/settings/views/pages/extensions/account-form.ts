import type { AccountKind } from "@nervekit/contracts/extensions";
import {
  accountKindFields,
  validateAccountInput,
  type AccountView,
} from "@nervekit/contracts/settings";

/** One input of the generated account dialog. */
export type AccountFormInput = {
  key: string;
  label: string;
  description?: string;
  placeholder?: string;
  control: "text" | "url" | "number" | "switch" | "select";
  options?: { value: string; label: string }[];
};

export type AccountFormValues = {
  name: string;
  /** Text for text, URL, number and select inputs; booleans for switches. */
  fields: Record<string, string | boolean>;
  secret: string;
};

/** The dialog's inputs after the name: the kind's own fields. */
export function accountFormInputs(kind: AccountKind): AccountFormInput[] {
  return Object.entries(accountKindFields(kind)).flatMap(
    ([key, field]): AccountFormInput[] => {
      const base = {
        key,
        label: field.label,
        ...(field.description ? { description: field.description } : {}),
      };
      switch (field.type) {
        case "boolean":
          return [{ ...base, control: "switch" }];
        case "string":
          return [
            {
              ...base,
              control: field.format === "url" ? "url" : "text",
              ...(field.placeholder ? { placeholder: field.placeholder } : {}),
            },
          ];
        case "number":
          return [{ ...base, control: "number" }];
        case "enum":
          return [
            {
              ...base,
              control: "select",
              options: field.options.map(({ value, label }) => ({
                value,
                label,
              })),
            },
          ];
        default:
          return [];
      }
    },
  );
}

export function initialAccountForm(
  kind: AccountKind,
  account?: Pick<AccountView, "name" | "fields">,
): AccountFormValues {
  const fields: AccountFormValues["fields"] = {};
  for (const input of accountFormInputs(kind)) {
    const value = account?.fields[input.key];
    fields[input.key] =
      input.control === "switch"
        ? value === true
        : value === undefined
          ? ""
          : String(value);
  }
  return { name: account?.name ?? "", fields, secret: "" };
}

export type AccountFormSubmission =
  | {
      ok: true;
      name: string;
      fields: Record<string, unknown>;
      /** The secret to store; absent keeps the stored one. */
      secret?: string;
    }
  | { ok: false; message: string };

/** `acme.atlassian.net` is accepted as `https://acme.atlassian.net`. */
function withScheme(value: string): string {
  const text = value.trim();
  return text && !/^[a-z][a-z0-9+.-]*:\/\//i.test(text)
    ? `https://${text}`
    : text;
}

/** Checks the form against its kind; `secretConfigured` says whether a secret is already stored. */
export function submitAccountForm(
  kind: AccountKind,
  form: AccountFormValues,
  secretConfigured: boolean,
): AccountFormSubmission {
  const fields: Record<string, unknown> = {};
  for (const input of accountFormInputs(kind)) {
    const value = form.fields[input.key];
    if (typeof value === "boolean") fields[input.key] = value;
    else if (input.control === "number")
      fields[input.key] = value?.trim() ? Number(value) : undefined;
    else if (input.control === "url")
      fields[input.key] = withScheme(value ?? "");
    else fields[input.key] = value;
  }
  const checked = validateAccountInput(kind, { name: form.name, fields });
  if (!checked.ok) return checked;
  const secret = form.secret.trim();
  if (!secret && !secretConfigured)
    return { ok: false, message: `Enter the ${kind.secret.label}.` };
  return {
    ok: true,
    name: checked.name,
    fields: checked.fields,
    ...(secret ? { secret } : {}),
  };
}

/** Testing needs a kind that defines a test and a stored secret to test with. */
export function accountCanTest(
  kind: Pick<AccountKind, "test">,
  account: Pick<AccountView, "secretConfigured">,
): boolean {
  return kind.test === true && account.secretConfigured;
}
