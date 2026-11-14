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
 * Output is JSON with names and expiry times only, never values.
 */
import { pathToFileURL } from "node:url";
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
  const copied = selectCopyable(await readAll(source));
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
    }),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
