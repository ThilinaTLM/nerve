import type { McpServerEntry } from "@nervekit/contracts/mcp";

/** An env variable or header of the form; a secret one is stored in the vault. */
export type McpKeyValue = {
  key: string;
  value: string;
  secret: boolean;
  /** The vault name a stored secret is referenced by; kept so editing never renames it. */
  secretName?: string;
  /** A value is already stored; a blank field keeps it. */
  stored?: boolean;
};

export type McpFormValues = {
  name: string;
  transport: "stdio" | "http";
  command: string;
  /** One argument per line. */
  args: string;
  cwd: string;
  env: McpKeyValue[];
  url: string;
  headers: McpKeyValue[];
  /** Seconds. */
  timeout: string;
  description: string;
  /** The entry's own `enabled`, kept as written; Settings never writes it. */
  enabled?: boolean;
};

export const emptyMcpForm = (): McpFormValues => ({
  name: "",
  transport: "stdio",
  command: "",
  args: "",
  cwd: "",
  env: [],
  url: "",
  headers: [],
  timeout: "",
  description: "",
});

const SECRET_REFERENCE = /^\$\{secret:([A-Za-z0-9_-]+)\}$/;
const NAME = /^[A-Za-z0-9_-]+$/;

const rowsOf = (
  values: Record<string, string> | undefined,
  secrets: ReadonlyMap<string, boolean>,
): McpKeyValue[] =>
  Object.entries(values ?? {}).map(([key, value]) => {
    const secretName = SECRET_REFERENCE.exec(value)?.[1];
    return secretName
      ? {
          key,
          value: "",
          secret: true,
          secretName,
          stored: secrets.get(secretName) === true,
        }
      : { key, value, secret: false };
  });

/** The form for an entry as written. `secrets` says which referenced secrets have a value. */
export function formFromEntry(
  name: string,
  entry: McpServerEntry,
  secrets: readonly { name: string; set: boolean }[] = [],
): McpFormValues {
  const status = new Map(secrets.map((s) => [s.name, s.set]));
  const http = entry.type === "http" || (!entry.command && !!entry.url);
  return {
    name,
    transport: http ? "http" : "stdio",
    command: entry.command ?? "",
    args: (entry.args ?? []).join("\n"),
    cwd: entry.cwd ?? "",
    env: rowsOf(entry.env, status),
    url: entry.url ?? "",
    headers: rowsOf(entry.headers, status),
    timeout: entry.timeout === undefined ? "" : String(entry.timeout),
    description: entry.description ?? "",
    ...(entry.enabled === undefined ? {} : { enabled: entry.enabled }),
  };
}

/** `server_KEY` reduced to what a secret name allows. */
export function secretNameFor(server: string, key: string): string {
  const base = `${server}_${key}`.replace(/[^A-Za-z0-9_-]+/g, "_");
  return base.slice(0, 64) || "secret";
}

function recordOf(
  rows: McpKeyValue[],
  server: string,
  secrets: Record<string, string>,
): Record<string, string> | undefined {
  const record: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    if (row.secret) {
      const secretName = row.secretName ?? secretNameFor(server, key);
      record[key] = `\${secret:${secretName}}`;
      if (row.value !== "") secrets[secretName] = row.value;
    } else record[key] = row.value;
  }
  return Object.keys(record).length ? record : undefined;
}

export type McpFormSubmission = {
  name: string;
  entry: McpServerEntry;
  /** Secret values typed in the form, by vault name. */
  secrets: Record<string, string>;
};

/** The entry the form describes. Not validated: see `validateMcpForm`. */
export function entryFromForm(form: McpFormValues): McpFormSubmission {
  const name = form.name.trim();
  const secrets: Record<string, string> = {};
  const entry: McpServerEntry = {};
  if (form.transport === "http") {
    entry.type = "http";
    entry.url = form.url.trim();
    const headers = recordOf(form.headers, name, secrets);
    if (headers) entry.headers = headers;
  } else {
    entry.command = form.command.trim();
    const args = form.args.split("\n").filter((line) => line.trim() !== "");
    if (args.length) entry.args = args;
    if (form.cwd.trim()) entry.cwd = form.cwd.trim();
    const env = recordOf(form.env, name, secrets);
    if (env) entry.env = env;
  }
  const timeout = Number(form.timeout);
  if (form.timeout.trim() !== "" && Number.isFinite(timeout))
    entry.timeout = timeout;
  if (form.description.trim()) entry.description = form.description.trim();
  if (form.enabled !== undefined) entry.enabled = form.enabled;
  return { name, entry, secrets };
}

/** What blocks saving, in the user's words; the server validates the rest. */
export function validateMcpForm(form: McpFormValues): string | undefined {
  const name = form.name.trim();
  if (!name) return "Enter a name.";
  if (!NAME.test(name) || name.length > 64)
    return "Use letters, digits, - and _ in the name (up to 64).";
  if (form.transport === "stdio" && !form.command.trim())
    return "Enter the command to run.";
  if (form.transport === "http" && !form.url.trim()) return "Enter the URL.";
  const timeout = form.timeout.trim();
  if (timeout !== "" && !(Number(timeout) > 0))
    return "The timeout is a number of seconds.";
  const keys = (form.transport === "http" ? form.headers : form.env)
    .map((row) => row.key.trim())
    .filter(Boolean);
  if (new Set(keys).size !== keys.length)
    return `Each ${form.transport === "http" ? "header" : "variable"} can be set once.`;
  return undefined;
}

/** The entry as the file holds it, for JSON mode. */
export const entryJson = (entry: McpServerEntry): string =>
  JSON.stringify(entry, null, 2);

/** Puts values typed earlier back into the secret rows they belong to (after a trip through JSON). */
export function withSecretValues(
  form: McpFormValues,
  values: Record<string, string>,
): McpFormValues {
  const fill = (rows: McpKeyValue[]) =>
    rows.map((row) =>
      row.secret && row.secretName && values[row.secretName] !== undefined
        ? { ...row, value: values[row.secretName]! }
        : row,
    );
  return { ...form, env: fill(form.env), headers: fill(form.headers) };
}
