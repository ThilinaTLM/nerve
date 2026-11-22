import {
  accountSecretFields,
  type AccountKind,
} from "@nervekit/contracts/extensions";
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
  /** Typed-in secrets by name; never filled from a stored account. */
  secrets: Record<string, string>;
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
  const declared = accountKindFields(kind);
  for (const input of accountFormInputs(kind)) {
    // A new account starts from the kind's defaults (a shipped client id, a region).
    const field = declared[input.key];
    const value = account
      ? account.fields[input.key]
      : field && "default" in field
        ? field.default
        : undefined;
    fields[input.key] =
      input.control === "switch"
        ? value === true
        : value === undefined
          ? ""
          : String(value);
  }
  return {
    name: account?.name ?? "",
    fields,
    secrets: Object.fromEntries(
      Object.keys(accountSecretFields(kind)).map((name) => [name, ""]),
    ),
  };
}

export type AccountFormSubmission =
  | {
      ok: true;
      name: string;
      fields: Record<string, unknown>;
      /** The secrets to store by name; a name left out keeps the stored one. */
      secrets?: Record<string, string>;
    }
  | { ok: false; message: string };

/** `acme.atlassian.net` is accepted as `https://acme.atlassian.net`. */
function withScheme(value: string): string {
  const text = value.trim();
  return text && !/^[a-z][a-z0-9+.-]*:\/\//i.test(text)
    ? `https://${text}`
    : text;
}

/** Checks the form against its kind; `credentialStored` says whether the account already has its secrets. */
export function submitAccountForm(
  kind: AccountKind,
  form: AccountFormValues,
  credentialStored: boolean,
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
  const secrets: Record<string, string> = {};
  for (const [name, field] of Object.entries(accountSecretFields(kind))) {
    const value = (form.secrets[name] ?? "").trim();
    if (value) secrets[name] = value;
    else if (!credentialStored)
      return { ok: false, message: `Enter the ${field.label}.` };
  }
  return {
    ok: true,
    name: checked.name,
    fields: checked.fields,
    ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
  };
}

/** Testing needs a kind that defines a test and an account that is ready to use. */
export function accountCanTest(
  kind: Pick<AccountKind, "test">,
  account: Pick<AccountView, "state">,
): boolean {
  return kind.test === true && account.state === "ready";
}

export type HelpPart = { text: string; href?: string };

/** Splits help text so `http(s)` URLs can render as links; trailing punctuation stays text. */
export function helpParts(help: string): HelpPart[] {
  const parts: HelpPart[] = [];
  let last = 0;
  for (const match of help.matchAll(/https?:\/\/[^\s<>"]+/g)) {
    const url = match[0].replace(/[.,;:!?)]+$/, "");
    if (match.index > last) parts.push({ text: help.slice(last, match.index) });
    parts.push({ text: url, href: url });
    last = match.index + url.length;
  }
  if (last < help.length) parts.push({ text: help.slice(last) });
  return parts;
}
