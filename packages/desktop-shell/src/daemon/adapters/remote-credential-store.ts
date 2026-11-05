import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { DaemonLoggerPort, RemoteCredentialStorePort } from "../ports.js";

/** OS-keychain-backed encryption (Electron `safeStorage`). */
export interface CredentialCipher {
  isAvailable(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(encrypted: Buffer): string;
}

type StoredCredentials = Record<string, string>;

/**
 * Device credentials for remote daemons, one per origin, encrypted at rest
 * with the OS keychain. When the platform has no encryption backend the
 * credential is kept in memory only: it works for this run and the user pairs
 * again next time, rather than a bearer secret landing on disk in plain text.
 */
export function createRemoteCredentialStore(options: {
  filePath: string;
  cipher: CredentialCipher;
  logger: DaemonLoggerPort;
}): RemoteCredentialStorePort {
  const { filePath, cipher, logger } = options;
  const memory = new Map<string, string>();
  let writeChain: Promise<void> = Promise.resolve();

  async function readFileEntries(): Promise<StoredCredentials> {
    try {
      const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
      return parsed && typeof parsed === "object"
        ? (parsed as StoredCredentials)
        : {};
    } catch {
      return {};
    }
  }

  function persist(
    update: (entries: StoredCredentials) => void,
  ): Promise<void> {
    const next = writeChain.then(async () => {
      const entries = await readFileEntries();
      update(entries);
      await mkdir(dirname(filePath), { recursive: true });
      const temp = `${filePath}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify(entries), { mode: 0o600 });
      await rename(temp, filePath);
    });
    writeChain = next.catch(() => undefined);
    return next;
  }

  return {
    async load(origin) {
      const inMemory = memory.get(origin);
      if (inMemory) return inMemory;
      if (!cipher.isAvailable()) return undefined;
      const encrypted = (await readFileEntries())[origin];
      if (!encrypted) return undefined;
      try {
        return cipher.decrypt(Buffer.from(encrypted, "base64"));
      } catch (error) {
        logger.log("warn", "Stored remote credential could not be decrypted", {
          error,
          context: { origin },
        });
        return undefined;
      }
    },
    async save(origin, credential) {
      memory.set(origin, credential);
      if (!cipher.isAvailable()) {
        logger.log(
          "warn",
          "OS credential encryption is unavailable; the remote device credential is kept for this session only",
          { context: { origin } },
        );
        return;
      }
      const encrypted = cipher.encrypt(credential).toString("base64");
      await persist((entries) => {
        entries[origin] = encrypted;
      });
    },
    async forget(origin) {
      memory.delete(origin);
      await persist((entries) => {
        delete entries[origin];
      });
    },
  };
}
