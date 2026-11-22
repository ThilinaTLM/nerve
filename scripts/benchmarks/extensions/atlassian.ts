/**
 * Read-mostly Jira/Confluence access for task setup, verification and cleanup.
 *
 * Uses the product's own clients (`@nervekit/extensions` Atlassian clients,
 * loaded from the built package) with the slot's Atlassian account. The credential is
 * decrypted in memory from the slot's own store (read-only; nothing is ever
 * written back or printed). `ATLASSIAN_SITE_URL`, `ATLASSIAN_EMAIL` and
 * `ATLASSIAN_API_TOKEN` override the slot account.
 */
import type { Loose } from "./loose.ts";
import { createDecipheriv } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { CliError } from "../../cli/main.ts";
import type { SlotTarget } from "./daemon-client.ts";

export interface Sandbox {
  /** Jira project key every write task must stay inside. */
  readonly jiraProject: string;
  /** Confluence space key every write task must stay inside. */
  readonly confluenceSpace: string;
}

export const DEFAULT_SANDBOX: Sandbox = {
  jiraProject: "SCRUM",
  confluenceSpace: "SD",
};

interface Connection {
  siteUrl: string;
  email: string;
  token: string;
}

interface Integrations {
  jiraRequest(
    connection: Connection,
    options: RequestOptions & { api?: "platform" | "agile" },
  ): Promise<unknown>;
  confluenceRequest(
    connection: Connection,
    options: RequestOptions & { api?: "v1" | "v2" },
  ): Promise<unknown>;
}

export interface RequestOptions {
  method?: string;
  path: string;
  query?: Record<string, string | number | boolean | string[] | undefined>;
  body?: unknown;
}

/** Thin handle the verification code receives; every call is a REST request. */
export interface Atlassian {
  readonly siteUrl: string;
  readonly sandbox: Sandbox;
  jira<T = Loose>(
    options: RequestOptions & { api?: "platform" | "agile" },
  ): Promise<T>;
  confluence<T = Loose>(
    options: RequestOptions & { api?: "v1" | "v2" },
  ): Promise<T>;
  /** Runs `jql` against the site and returns the issues with the named fields. */
  searchJql(jql: string, fields?: string[]): Promise<Loose[]>;
  /** Confluence v1 CQL content search restricted to nothing else. */
  searchPages(title: string): Promise<Loose[]>;
}

async function selectedAtlassianAccount(
  home: string,
): Promise<string | undefined> {
  try {
    const file = JSON.parse(
      await readFile(join(home, "config", "extensions.json"), "utf8"),
    ) as { extensions?: { atlassian?: { settings?: { account?: unknown } } } };
    const account = file.extensions?.atlassian?.settings?.account;
    return typeof account === "string" ? account : undefined;
  } catch {
    return undefined;
  }
}

async function readSlotConnection(target: SlotTarget): Promise<Connection> {
  // The account the Atlassian extension selects, so checks and the agent use
  // the same site; never guess, since write tasks must stay in the sandbox.
  const selected = await selectedAtlassianAccount(target.home);
  const database = new DatabaseSync(join(target.home, "data", "nerve.sqlite"), {
    readOnly: true,
  });
  let row: { fields: string; credential: Uint8Array | null } | undefined;
  try {
    row = database
      .prepare(
        "SELECT fields, credential FROM account WHERE kind = 'atlassian' AND id = ?",
      )
      .get(selected ?? "") as typeof row;
  } finally {
    database.close();
  }
  if (!row)
    throw new CliError(
      `Slot ${target.slot} has no Atlassian account selected in Settings → Extensions → Atlassian (user scope); select the sandbox account, or set ATLASSIAN_SITE_URL, ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN.`,
    );
  const { siteUrl, email } = JSON.parse(row.fields) as {
    siteUrl?: string;
    email?: string;
  };
  const token = row.credential
    ? await openAccountSecret(target.home, selected!, row.credential)
    : undefined;
  if (!token || !siteUrl || !email)
    throw new CliError(
      `Slot ${target.slot}: the selected Atlassian account needs a site URL, an email and a saved API token.`,
    );
  return { siteUrl: siteUrl.replace(/\/+$/, ""), email, token };
}

/** The single secret of an account's credential: `version | iv(12) | tag(16) | ciphertext`, id as associated data. */
async function openAccountSecret(
  home: string,
  accountId: string,
  sealed: Uint8Array,
): Promise<string | undefined> {
  const key = Buffer.from(
    (await readFile(join(home, "secrets", "master.key"), "utf8")).trim(),
    "base64",
  );
  const bytes = Buffer.from(sealed);
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(1, 13));
  decipher.setAAD(Buffer.from(accountId, "utf8"));
  decipher.setAuthTag(bytes.subarray(13, 29));
  const blob = JSON.parse(
    Buffer.concat([
      decipher.update(bytes.subarray(29)),
      decipher.final(),
    ]).toString("utf8"),
  ) as { secrets?: Record<string, string> };
  return blob.secrets?.secret;
}

async function restRequest(
  connection: Connection,
  base: string,
  { method = "GET", path, query, body }: RequestOptions,
): Promise<unknown> {
  const url = new URL(`${connection.siteUrl}${base}${path}`);
  for (const [key, value] of Object.entries(query ?? {}))
    if (value !== undefined)
      url.searchParams.set(
        key,
        Array.isArray(value) ? value.join(",") : String(value),
      );
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Basic ${Buffer.from(`${connection.email}:${connection.token}`).toString("base64")}`,
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(
      `${method} ${path}: HTTP ${response.status} ${text.slice(0, 200)}`,
    );
  return text ? (JSON.parse(text) as unknown) : undefined;
}

export async function connectAtlassian(
  target: SlotTarget,
  sandbox: Sandbox,
): Promise<Atlassian> {
  const env = process.env;
  const connection: Connection =
    env.ATLASSIAN_SITE_URL && env.ATLASSIAN_EMAIL && env.ATLASSIAN_API_TOKEN
      ? {
          siteUrl: env.ATLASSIAN_SITE_URL.replace(/\/+$/, ""),
          email: env.ATLASSIAN_EMAIL,
          token: env.ATLASSIAN_API_TOKEN,
        }
      : await readSlotConnection(target);
  // Checks talk to the REST APIs directly, independent of the extension under test.
  const integrations: Integrations = {
    jiraRequest: (connection, { api, ...options }) =>
      restRequest(
        connection,
        api === "agile" ? "/rest/agile/1.0" : "/rest/api/3",
        options,
      ),
    confluenceRequest: (connection, { api, ...options }) =>
      restRequest(
        connection,
        api === "v2" ? "/wiki/api/v2" : "/wiki/rest/api",
        options,
      ),
  };
  const atlassian: Atlassian = {
    siteUrl: connection.siteUrl,
    sandbox,
    jira: (options) =>
      integrations.jiraRequest(connection, options) as Promise<never>,
    confluence: (options) =>
      integrations.confluenceRequest(connection, {
        api: "v1",
        ...options,
      }) as Promise<never>,
    async searchJql(jql, fields = ["summary", "status"]) {
      const result = (await atlassian.jira({
        path: "/search/jql",
        query: { jql, fields, maxResults: 100 },
      })) as { issues?: unknown[] };
      return result.issues ?? [];
    },
    async searchPages(title) {
      const result = (await atlassian.confluence({
        path: "/content",
        query: {
          spaceKey: sandbox.confluenceSpace,
          title,
          expand: "version,body.storage",
          limit: 25,
        },
      })) as { results?: unknown[] };
      return result.results ?? [];
    },
  };
  return atlassian;
}

/** Cheap read that proves the credential works and the sandbox exists. */
export async function checkSandbox(atlassian: Atlassian): Promise<string[]> {
  const problems: string[] = [];
  await atlassian
    .jira({
      path: `/project/${encodeURIComponent(atlassian.sandbox.jiraProject)}`,
    })
    .catch((error: unknown) =>
      problems.push(
        `Jira project ${atlassian.sandbox.jiraProject}: ${String((error as Error).message).slice(0, 160)}`,
      ),
    );
  await atlassian
    .confluence({
      path: "/space/" + encodeURIComponent(atlassian.sandbox.confluenceSpace),
    })
    .catch((error: unknown) =>
      problems.push(
        `Confluence space ${atlassian.sandbox.confluenceSpace}: ${String((error as Error).message).slice(0, 160)}`,
      ),
    );
  return problems;
}
