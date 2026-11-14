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
import { join } from "node:path";
import { CliError } from "../../cli/main.ts";
import { importBuilt, type SlotTarget } from "./daemon-client.ts";

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
  const accounts = JSON.parse(
    await readFile(join(target.home, "config", "accounts.json"), "utf8"),
  ) as {
    accounts?: {
      atlassian?: {
        id: string;
        fields: { siteUrl?: string; email?: string };
      }[];
    };
  };
  // The account the Atlassian extension selects, so checks and the agent use
  // the same site; never guess, since write tasks must stay in the sandbox.
  const selected = await selectedAtlassianAccount(target.home);
  const profile = accounts.accounts?.atlassian?.find(
    (account) => account.id === selected,
  );
  if (!profile)
    throw new CliError(
      `Slot ${target.slot} has no Atlassian account selected in Settings → Extensions → Atlassian (user scope); select the sandbox account, or set ATLASSIAN_SITE_URL, ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN.`,
    );
  const envelope = JSON.parse(
    await readFile(join(target.home, "secrets", "credentials.enc"), "utf8"),
  ) as { iv: string; tag: string; data: string };
  const key = Buffer.from(
    (await readFile(join(target.home, "secrets", "master.key"), "utf8")).trim(),
    "base64",
  );
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const values = JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(envelope.data, "base64")),
      decipher.final(),
    ]).toString("utf8"),
  ) as Record<string, string>;
  const credential = `account:atlassian:${profile.id}`;
  const token = values[`provider:${credential}:apiKey`];
  const { siteUrl, email } = profile.fields;
  if (!token || !siteUrl || !email)
    throw new CliError(
      `Slot ${target.slot}: the selected Atlassian account needs a site URL, an email and a saved API token (${credential}).`,
    );
  return { siteUrl: siteUrl.replace(/\/+$/, ""), email, token };
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
  const integrations: Integrations = {
    ...(await importBuilt<Pick<Integrations, "jiraRequest">>(
      "extensions",
      "atlassian/jira/client.js",
    )),
    ...(await importBuilt<Pick<Integrations, "confluenceRequest">>(
      "extensions",
      "atlassian/confluence/client.js",
    )),
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
