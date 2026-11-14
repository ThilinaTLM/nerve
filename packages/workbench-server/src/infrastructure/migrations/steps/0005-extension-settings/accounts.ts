import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isRecord, type Json } from "./convert.js";

/**
 * Frozen conversion of the accounts store from per-product profile lists
 * (`{ profiles: { atlassian: [...], tavily: [...] } }`) to accounts by kind
 * (`{ accounts: { <kind>: [{ id, name, fields }] } }`), and of the account
 * secrets from the profile credential id (`atlassian:<id>`) to
 * `account:<kind>:<id>`. Plain-JSON shapes only: this step must not follow
 * later changes to the evolving contracts.
 */

export type SecretRename = { from: string; to: string };

const apiKeySecret = (credential: string) => `provider:${credential}:apiKey`;

/** The new accounts document and the secret renames it implies; undefined when already converted. */
export function reshapeAccounts(
  source: Json,
  loss: (reason: string) => void,
): { document: Json; renames: SecretRename[] } | undefined {
  if (!isRecord(source.profiles)) return undefined;
  const accounts: Record<string, Json[]> = {};
  const renames: SecretRename[] = [];
  for (const [kind, profiles] of Object.entries(source.profiles)) {
    accounts[kind] = [];
    if (!Array.isArray(profiles)) continue;
    for (const profile of profiles) {
      if (
        !isRecord(profile) ||
        typeof profile.id !== "string" ||
        typeof profile.name !== "string"
      ) {
        loss("An account entry was not valid and was dropped");
        continue;
      }
      const { id, name, credential, ...rest } = profile;
      const fields = Object.fromEntries(
        Object.entries(rest).filter(
          ([, value]) => value !== undefined && value !== null && value !== "",
        ),
      );
      accounts[kind].push({ id, name, fields });
      renames.push({
        from: apiKeySecret(
          typeof credential === "string" ? credential : `${kind}:${id}`,
        ),
        to: apiKeySecret(`account:${kind}:${id}`),
      });
    }
  }
  return { document: { version: 2, accounts }, renames };
}

type Envelope = {
  version: 1;
  algorithm: "A256GCM";
  iv: string;
  tag: string;
  data: string;
};

/** The secret store at `secrets/credentials.enc`, sealed with `secrets/master.key`. */
export function renameSecrets(
  credentialsPath: string,
  keyPath: string,
  renames: readonly SecretRename[],
): { content: string; renamed: number } | undefined {
  if (!renames.length || !existsSync(credentialsPath) || !existsSync(keyPath))
    return undefined;
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
  let renamed = 0;
  for (const { from, to } of renames) {
    if (typeof values[from] !== "string") continue;
    // A secret already saved under the new name wins.
    if (!(to in values)) values[to] = values[from];
    delete values[from];
    renamed++;
  }
  if (!renamed) return undefined;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ordered = Object.fromEntries(
    Object.entries(values).sort(([a], [b]) => a.localeCompare(b)),
  );
  const data = Buffer.concat([
    cipher.update(JSON.stringify(ordered), "utf8"),
    cipher.final(),
  ]);
  const sealed: Envelope = {
    version: 1,
    algorithm: "A256GCM",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
  return { content: `${JSON.stringify(sealed, null, 2)}\n`, renamed };
}
