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
 * It also merges production's accounts into the slot's accounts file in the
 * format the slot uses: old-format (`profiles`) for a slot that has not run
 * migration 0005 yet, accounts v2 for a migrated slot. Production's old-format
 * accounts are converted with the migration's own `reshapeAccounts`, and their
 * secrets are renamed to the migrated ids, so old-format data never reaches a
 * v2 slot. Output is JSON with names and expiry times only, never values.
 */
import {
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  reshapeAccounts,
  type SecretRename,
} from "../../../../packages/workbench-server/src/infrastructure/migrations/steps/0005-extension-settings/accounts.js";
import { EncryptedFileSecretProvider } from "../../../../packages/workbench-server/src/infrastructure/secrets/index.js";

const API_KEY_NAME = /^provider:.+:apiKey$/;
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
type Profiles = Record<string, Doc[]>;

const isDoc = (value: unknown): value is Doc =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `legacy` = per-product `profiles`; `v2` = `{ version: 2, accounts }`. */
export function accountsFormat(doc: Doc): "legacy" | "v2" | "unknown" {
  if (isDoc(doc.profiles)) return "legacy";
  if (isDoc(doc.accounts)) return "v2";
  return "unknown";
}

/** Merge account lists per kind: `over` wins by id, `base`-only entries stay. */
function mergeLists(over: Profiles, base: Profiles): Profiles {
  const merged: Profiles = {};
  for (const [kind, list] of Object.entries(over)) merged[kind] = [...list];
  for (const [kind, list] of Object.entries(base)) {
    const target = (merged[kind] ??= []);
    const ids = new Set(target.map((entry) => entry.id));
    target.push(...list.filter((entry) => !ids.has(entry.id)));
  }
  return merged;
}

export interface AccountsPlan {
  /** Target format actually written. */
  format: "legacy" | "v2";
  document: Doc;
  /** Secret renames to apply to the copied secrets (old ids to migrated ids). */
  renames: SecretRename[];
}

/**
 * The slot's next accounts document. `source` is production's document;
 * `slot` the slot's existing one, or undefined when it has none. A slot
 * document without `profiles` (or no document at all) is a migrated slot.
 */
export function planAccounts(source: Doc, slot: Doc | undefined): AccountsPlan {
  const from = accountsFormat(source);
  if (from === "unknown") throw new Error("Unrecognised source accounts file");
  const slotFormat = slot ? accountsFormat(slot) : "v2";
  if (slotFormat === "unknown")
    throw new Error("Unrecognised slot accounts file");
  if (slotFormat === "legacy") {
    if (from !== "legacy")
      throw new Error(
        "Source accounts are v2 but the slot has not run migration 0005; start the slot once with this branch, stop it, and rerun",
      );
    return {
      format: "legacy",
      renames: [],
      document: {
        ...source,
        profiles: mergeLists(
          source.profiles as Profiles,
          (slot?.profiles ?? {}) as Profiles,
        ),
      },
    };
  }
  const converted =
    from === "legacy"
      ? reshapeAccounts(source as never, () => {})
      : { document: source, renames: [] as SecretRename[] };
  if (!converted) throw new Error("Source accounts could not be converted");
  const own = (slot?.accounts ?? {}) as Profiles;
  return {
    format: "v2",
    renames: converted.renames,
    document: {
      ...converted.document,
      version: 2,
      accounts: mergeLists(converted.document.accounts as Profiles, own),
    },
  };
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

const readDoc = (path: string): Doc =>
  JSON.parse(readFileSync(path, "utf8")) as Doc;

/** `accounts.json`, or the pre-0005 name `integrations.json`; first that exists. */
function accountsFiles(home: string): string[] {
  return ["accounts.json", "integrations.json"]
    .map((name) => join(home, "config", name))
    .filter((path) => existsSync(path));
}

/** Backs up and writes the slot's accounts file(s); returns the plan. */
function copyAccounts(
  source: string,
  target: string,
): { plan: AccountsPlan; files: string[] } | undefined {
  const sourceFile = accountsFiles(source)[0];
  if (!sourceFile) return undefined;
  const targetFiles = accountsFiles(target);
  const slotDoc = targetFiles.length ? readDoc(targetFiles[0]!) : undefined;
  const plan = planAccounts(readDoc(sourceFile), slotDoc);
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const config = join(target, "config");
  mkdirSync(config, { recursive: true });
  // A migrated slot reads accounts.json only. An unmigrated slot with neither
  // file yet gets both names, as the version it will start with is unknown.
  const names =
    plan.format === "v2"
      ? ["accounts.json"]
      : targetFiles.length
        ? targetFiles.map((file) => file.slice(config.length + 1))
        : ["accounts.json", "integrations.json"];
  for (const name of names) {
    const path = join(config, name);
    if (existsSync(path)) copyFileSync(path, `${path}.bak-${stamp}`);
    writeFileSync(path, `${JSON.stringify(plan.document, null, 2)}\n`);
  }
  return { plan, files: names };
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
  // Accounts first: a v2 slot needs production's secrets under migrated ids.
  const accounts = copyAccounts(source, target);
  const copied = renameCopied(
    selectCopyable(await readAll(source)),
    accounts?.plan.renames ?? [],
  );
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
      accounts: accounts && {
        format: accounts.plan.format,
        files: accounts.files,
      },
    }),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
