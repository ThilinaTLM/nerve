import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

/**
 * Frozen conversion of the accounts store (`config/accounts.json`, version 2:
 * `{ accounts: { <kind>: [{ id, name, fields }] } }`) and the account secrets in
 * `secrets/credentials.enc` (`provider:account:<kind>:<id>:apiKey`) to rows of the `account`
 * table (core schema v5): user-level accounts whose single secret is sealed into `credential`
 * the way the credential vault seals it. Plain shapes only: this step must not follow later
 * changes to the evolving contracts or the vault.
 */

export type AccountRow = {
  id: string;
  kind: string;
  name: string;
  fields: string;
  credential: Buffer | null;
  status: "ready" | "needs_sign_in";
};

const SECRET_PREFIX = "provider:account:";
const secretKey = (kind: string, id: string) =>
  `${SECRET_PREFIX}${kind}:${id}:apiKey`;

type Envelope = {
  version: 1;
  algorithm: "A256GCM";
  iv: string;
  tag: string;
  data: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export type SecretStore = {
  key: Buffer;
  values: Record<string, string>;
};

/** The secret store at `secrets/credentials.enc`, sealed with `secrets/master.key`; undefined when there is none. */
export function readSecretStore(
  credentialsPath: string,
  keyPath: string,
): SecretStore | undefined {
  if (!existsSync(credentialsPath) || !existsSync(keyPath)) return undefined;
  const key = Buffer.from(readFileSync(keyPath, "utf8").trim(), "base64");
  if (key.byteLength !== 32) throw new Error("Invalid Nerve master key.");
  const envelope = JSON.parse(
    readFileSync(credentialsPath, "utf8"),
  ) as Envelope;
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
  return { key, values };
}

/** `credentials.enc` without the account secrets; undefined when it held none. */
export function withoutAccountSecrets(store: SecretStore): string | undefined {
  const kept = Object.entries(store.values).filter(
    ([name]) => !name.startsWith(SECRET_PREFIX),
  );
  if (kept.length === Object.keys(store.values).length) return undefined;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", store.key, iv);
  const data = Buffer.concat([
    cipher.update(
      JSON.stringify(
        Object.fromEntries(kept.sort(([a], [b]) => a.localeCompare(b))),
      ),
      "utf8",
    ),
    cipher.final(),
  ]);
  const sealed: Envelope = {
    version: 1,
    algorithm: "A256GCM",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
  return `${JSON.stringify(sealed, null, 2)}\n`;
}

/** `version(1) | iv(12) | tag(16) | ciphertext`, AES-256-GCM with the account id as associated data. */
function sealSecret(key: Buffer, id: string, secret: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(id, "utf8"));
  const data = Buffer.concat([
    cipher.update(JSON.stringify({ v: 1, secrets: { secret } }), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), data]);
}

/**
 * The account rows of an accounts document. An id already taken (accounts were unique per kind
 * only) gets a new one, reported through `loss`; an entry that is not valid is dropped likewise.
 */
export function accountRows(
  document: unknown,
  store: SecretStore | undefined,
  loss: (reason: string) => void,
): AccountRow[] {
  if (!isRecord(document) || !isRecord(document.accounts))
    throw new Error("config/accounts.json is not an accounts document");
  const rows: AccountRow[] = [];
  const taken = new Set<string>();
  for (const [kind, entries] of Object.entries(document.accounts)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (
        !isRecord(entry) ||
        typeof entry.id !== "string" ||
        typeof entry.name !== "string"
      ) {
        loss("An account entry was not valid and was dropped");
        continue;
      }
      const secret = store?.values[secretKey(kind, entry.id)];
      let id = entry.id;
      if (taken.has(id)) {
        id = randomUUID();
        loss(
          `Account '${entry.name}' shared its id with another account and got a new one`,
        );
      }
      taken.add(id);
      rows.push({
        id,
        kind,
        name: entry.name,
        fields: JSON.stringify(isRecord(entry.fields) ? entry.fields : {}),
        credential: secret && store ? sealSecret(store.key, id, secret) : null,
        status: secret ? "ready" : "needs_sign_in",
      });
    }
  }
  return rows;
}
