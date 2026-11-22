/**
 * Builds a dev slot's credential store from a source home without ever giving
 * the slot a refresh token. Called by `qa_slot.py copy-secrets` in this folder.
 *
 *   tsx .nerve/skills/nerve-qa/scripts/copy-secrets.ts copy --source HOME --target HOME
 *   tsx .nerve/skills/nerve-qa/scripts/copy-secrets.ts oauth-status --home HOME
 *
 * `copy` decrypts the source read-only and keeps `provider:*:apiKey` entries
 * plus OAuth entries reduced to the access token and expiry. The refresh token
 * is replaced by a placeholder, so the slot cannot rotate the source's refresh
 * token. Copied entries are merged over the target's: entries only the slot has
 * (installation identity, test-site API keys) are kept.
 *
 * Accounts are rows of the slot's `account` table. Each source account is
 * opened with the source `master.key` and sealed again under the slot's own key
 * (the account id is the associated data). Typed-in secrets are kept; provider
 * state (OAuth tokens) is dropped and the account becomes `needs_sign_in`, so
 * no refresh token reaches the slot. Source rows replace slot rows with the
 * same id; slot-only accounts stay. A source from before migration 0006
 * (`config/accounts.json` plus `provider:account:*` secrets) is converted with
 * the migrations' own code. Project-level accounts are copied when the slot has
 * that project. Output is JSON with names and expiry times only, never values.
 */
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  migrate,
  openCoreDatabase,
} from "../../../../packages/conversation-core/dist/index.js";
import {
  openCredential,
  sealCredential,
} from "../../../../packages/workbench-server/src/domains/accounts/credential-blob.js";
import {
  reshapeAccounts,
  type SecretRename,
} from "../../../../packages/workbench-server/src/infrastructure/migrations/steps/0005-extension-settings/accounts.js";
import { accountRows } from "../../../../packages/workbench-server/src/infrastructure/migrations/steps/0006-agent-resource-layout/accounts.js";
import { EncryptedFileSecretProvider } from "../../../../packages/workbench-server/src/infrastructure/secrets/index.js";

const API_KEY_NAME = /^provider:(?!account:).+:apiKey$/;
const OAUTH_NAME = /^provider:(.+):oauth$/;

/**
 * pi-ai requires `refresh` to be a string and sends it to the provider's token
 * endpoint once the access token is within 5 minutes of expiry. The placeholder
 * is not a valid token for any provider, so that request fails with an
 * invalid-grant error instead of touching a real refresh token.
 */
export const NO_REFRESH_TOKEN = "nerve-qa-no-refresh-token-rerun-copy-secrets";

export interface OAuthSession {
  provider: string;
  expires: number;
}

export function selectApiKeys(
  entries: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(entries).filter(([name]) => API_KEY_NAME.test(name)),
  );
}

/** The OAuth entry without its refresh token, or undefined when unusable. */
export function withoutRefreshToken(value: string): string | undefined {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      parsed.type !== "oauth" ||
      typeof parsed.access !== "string" ||
      typeof parsed.expires !== "number"
    ) {
      return undefined;
    }
    return JSON.stringify({ ...parsed, refresh: NO_REFRESH_TOKEN });
  } catch {
    return undefined;
  }
}

export function oauthSessions(entries: Record<string, string>): OAuthSession[] {
  const sessions: OAuthSession[] = [];
  for (const [name, value] of Object.entries(entries)) {
    const provider = OAUTH_NAME.exec(name)?.[1];
    if (!provider || !withoutRefreshToken(value)) continue;
    sessions.push({
      provider,
      expires: (JSON.parse(value) as { expires: number }).expires,
    });
  }
  return sessions.sort((a, b) => a.provider.localeCompare(b.provider));
}

/** API keys plus refresh-free OAuth entries. */
export function selectCopyable(
  entries: Record<string, string>,
): Record<string, string> {
  const copy = selectApiKeys(entries);
  for (const [name, value] of Object.entries(entries)) {
    if (!OAUTH_NAME.test(name)) continue;
    const stripped = withoutRefreshToken(value);
    if (stripped) copy[name] = stripped;
  }
  return copy;
}

type Doc = Record<string, unknown>;

const isDoc = (value: unknown): value is Doc =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** One `account` table row, `credential` still sealed under the key it came with. */
export interface AccountRecord {
  id: string;
  kind: string;
  projectId: string | null;
  name: string;
  fields: string;
  credential: Buffer | null;
  status: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The row sealed under `to`. Provider state (OAuth tokens) is dropped, and the
 * account then needs sign-in, so the slot never holds a refresh token. A row
 * whose credential cannot be opened with `from` becomes needs-sign-in without
 * one.
 */
export function resealAccount(
  row: AccountRecord,
  from: Buffer,
  to: Buffer,
): AccountRecord & { droppedState: boolean } {
  if (!row.credential) return { ...row, droppedState: false };
  try {
    const blob = openCredential(from, row.id, row.credential);
    const droppedState = blob.state !== undefined;
    delete blob.state;
    delete blob.error;
    return {
      ...row,
      credential: Buffer.from(sealCredential(to, row.id, blob)),
      status: droppedState ? "needs_sign_in" : row.status,
      expiresAt: droppedState ? null : row.expiresAt,
      droppedState,
    };
  } catch {
    return {
      ...row,
      credential: null,
      status: "needs_sign_in",
      expiresAt: null,
      droppedState: false,
    };
  }
}

const readKey = (home: string): Buffer =>
  Buffer.from(
    readFileSync(join(home, "secrets", "master.key"), "utf8").trim(),
    "base64",
  );

/**
 * The accounts of a source home: the `account` table, or for a home from before
 * migration 0006 `config/accounts.json` with its `provider:account:*` secrets.
 * Credentials are sealed under `key`, the source's master key.
 */
export function readSourceAccounts(
  home: string,
  key: Buffer,
  secrets: Record<string, string>,
): AccountRecord[] {
  const file = join(home, "config", "accounts.json");
  if (existsSync(file)) {
    let document = JSON.parse(readFileSync(file, "utf8")) as Doc;
    let values = secrets;
    if (isDoc(document.profiles)) {
      const converted = reshapeAccounts(document as never, () => {});
      if (!converted) throw new Error("Source accounts could not be converted");
      document = converted.document as Doc;
      values = renameCopied(secrets, converted.renames);
    }
    const now = new Date().toISOString();
    return accountRows(document, { key, values }, () => {}).map((row) => ({
      id: row.id,
      kind: row.kind,
      projectId: null,
      name: row.name,
      fields: row.fields,
      credential: row.credential,
      status: row.status,
      expiresAt: null,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
    }));
  }
  const sqlite = join(home, "data", "nerve.sqlite");
  if (!existsSync(sqlite)) return [];
  const db = new DatabaseSync(sqlite, { readOnly: true });
  try {
    const rows = db
      .prepare(
        "SELECT id, kind, project_id, name, fields, credential, status, expires_at, last_used_at, created_at, updated_at FROM account ORDER BY created_at, id",
      )
      .all() as Record<string, string | Uint8Array | null>[];
    return rows.map((r) => ({
      id: r.id as string,
      kind: r.kind as string,
      projectId: r.project_id as string | null,
      name: r.name as string,
      fields: r.fields as string,
      credential: r.credential ? Buffer.from(r.credential as Uint8Array) : null,
      status: r.status as string,
      expiresAt: r.expires_at as string | null,
      lastUsedAt: r.last_used_at as string | null,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    }));
  } finally {
    db.close();
  }
}

export interface AccountsSummary {
  copied: number;
  /** Sealed again without provider state: the account needs sign-in. */
  needSignIn: number;
  /** Project-level accounts whose project the slot does not have. */
  skippedProject: number;
}

/** Writes the source accounts into the slot's `account` table, resealed under the slot's key. */
export function copyAccounts(
  source: string,
  target: string,
  secrets: Record<string, string>,
): AccountsSummary {
  const summary = { copied: 0, needSignIn: 0, skippedProject: 0 };
  if (existsSync(join(target, "config", "accounts.json")))
    throw new Error(
      "The slot still has config/accounts.json: start it once with this branch (migration 0006), stop it, and rerun",
    );
  const rows = readSourceAccounts(source, readKey(source), secrets);
  if (!rows.length) return summary;
  const sourceKey = readKey(source);
  const targetKey = readKey(target);
  const db = openCoreDatabase(join(target, "data", "nerve.sqlite"));
  try {
    migrate(db);
    const hasProject = db.sqlite.prepare("SELECT 1 FROM project WHERE id = ?");
    const insert = db.sqlite.prepare(
      "INSERT OR REPLACE INTO account (id, kind, project_id, name, fields, credential, status, expires_at, last_used_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    db.transaction(() => {
      for (const row of rows) {
        if (row.projectId && !hasProject.get(row.projectId)) {
          summary.skippedProject++;
          continue;
        }
        const next = resealAccount(row, sourceKey, targetKey);
        insert.run(
          next.id,
          next.kind,
          next.projectId,
          next.name,
          next.fields,
          next.credential,
          next.status,
          next.expiresAt,
          next.lastUsedAt,
          next.createdAt,
          next.updatedAt,
        );
        summary.copied++;
        if (next.droppedState) summary.needSignIn++;
      }
    });
  } finally {
    db.close();
  }
  return summary;
}

/** Applies renames: the old id is dropped, an existing new id wins. */
export function renameCopied(
  copied: Record<string, string>,
  renames: readonly SecretRename[],
): Record<string, string> {
  const next = { ...copied };
  for (const { from, to } of renames) {
    if (typeof next[from] !== "string") continue;
    if (!(to in next)) next[to] = next[from];
    delete next[from];
  }
  return next;
}

async function readAll(home: string): Promise<Record<string, string>> {
  const provider = new EncryptedFileSecretProvider(home);
  const entries: Record<string, string> = {};
  for (const name of await provider.list()) {
    const value = await provider.get(name);
    if (value !== undefined) entries[name] = value;
  }
  return entries;
}

function option(argv: string[], name: string): string {
  const value = argv[argv.indexOf(name) + 1];
  if (argv.indexOf(name) < 0 || !value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "oauth-status") {
    const entries = await readAll(option(rest, "--home"));
    console.log(JSON.stringify({ oauth: oauthSessions(entries) }));
    return;
  }
  if (command !== "copy") throw new Error("Usage: copy | oauth-status");
  const source = option(rest, "--source");
  const target = option(rest, "--target");
  // The source is only decrypted; its master.key must already exist.
  const sourceSecrets = await readAll(source);
  const accounts = copyAccounts(source, target, sourceSecrets);
  const copied = selectCopyable(sourceSecrets);
  // Merge: the slot keeps credentials production does not have.
  const next = { ...(await readAll(target)), ...copied };
  const out = new EncryptedFileSecretProvider(target);
  await out.initialize(); // creates the slot's own master.key if missing
  for (const name of await out.list()) await out.delete(name);
  for (const [name, value] of Object.entries(next)) await out.set(name, value);
  console.log(
    JSON.stringify({
      apiKeys: Object.keys(selectApiKeys(copied)),
      oauth: oauthSessions(copied),
      accounts,
    }),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
