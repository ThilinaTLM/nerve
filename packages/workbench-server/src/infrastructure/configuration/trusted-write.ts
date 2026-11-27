import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { createId } from "@nervekit/contracts";
import type { TrustedResourceKind } from "@nervekit/contracts/core";
import type { CoreStorage } from "@nervekit/conversation-core";

/** The storage a trust capture needs; the core's storage is created after its readers. */
export type TrustStorage = () => Pick<
  CoreStorage,
  "trustedResources" | "transaction"
>;

/** Commits the carried approval once the written file is confirmed to hold exactly `output`. */
export type TrustCommit = (path: string, output: Buffer) => Promise<void>;

/** The digest an approval of exactly these bytes records. */
export const bytesDigest = (bytes: Buffer | string): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/**
 * The one capture of an edit Nerve makes on the user's behalf, for both scopes (`projectId` null is
 * the user's). It returns a commit only when the edit may keep trust: the original bytes were
 * trusted (`source` matches the approved digest), or Nerve creates the file (`source` undefined)
 * and no decision about the path exists. A file that needs review or was declined stays so, and so
 * does one that changed since `source` was read. The commit records the digest of the bytes the
 * caller wrote, never a re-read, and only if the file still holds exactly them.
 */
export async function captureTrust(
  getStorage: TrustStorage,
  input: {
    kind: TrustedResourceKind;
    projectId: string | null;
    path: string;
    source: Buffer | undefined;
  },
): Promise<TrustCommit | undefined> {
  const { kind, projectId, path, source } = input;
  const storage = getStorage();
  const before = storage.trustedResources.find(kind, projectId, path);
  if (source === undefined && before) return undefined;
  if (
    source !== undefined &&
    (before?.status !== "trusted" ||
      before.contentDigest !== bytesDigest(source))
  )
    return undefined;
  return async (targetPath, output) => {
    if (targetPath !== path || !(await readFile(path)).equals(output)) return;
    storage.transaction(() => {
      if (
        !isDeepStrictEqual(
          storage.trustedResources.find(kind, projectId, path),
          before,
        )
      )
        return;
      const now = new Date().toISOString();
      if (before)
        storage.trustedResources.update(before.id, {
          contentDigest: bytesDigest(output),
          status: "trusted",
          updatedAt: now,
        });
      else
        storage.trustedResources.insert({
          id: createId("trust"),
          kind,
          projectId,
          resourceKey: path,
          name: null,
          grants: null,
          contentDigest: bytesDigest(output),
          status: "trusted",
          createdAt: now,
          updatedAt: now,
        });
    });
  };
}

/** Forgets the decisions about files Nerve removed on the user's behalf. */
export function revokeTrust(
  getStorage: TrustStorage,
  input: {
    kind: TrustedResourceKind;
    projectId: string | null;
    paths: readonly string[];
  },
): void {
  const storage = getStorage();
  storage.transaction(() => {
    for (const path of input.paths) {
      const record = storage.trustedResources.find(
        input.kind,
        input.projectId,
        path,
      );
      if (record) storage.trustedResources.delete(record.id);
    }
  });
}

/**
 * Runs a write of `path` that Nerve makes for the user: reads the original bytes, lets `write`
 * produce the new ones and carries trust to them when `captureTrust` allows. `write` returns the
 * bytes it wrote, or undefined when it wrote nothing.
 */
export async function trustedWrite(
  getStorage: TrustStorage | undefined,
  input: { kind: TrustedResourceKind; projectId: string | null; path: string },
  write: () => Promise<Buffer | string | undefined>,
): Promise<void> {
  const source = await readFile(input.path).catch(() => undefined);
  const commit = getStorage
    ? await captureTrust(getStorage, { ...input, source })
    : undefined;
  const output = await write();
  if (commit && output !== undefined)
    await commit(input.path, Buffer.from(output));
}

/** The user-scope capture and revoke of Nerve's own writes, in the shape the agent configuration takes. */
export function userTrustWrites(getStorage: TrustStorage) {
  return {
    capture: (
      kind: "agent_profile" | "capabilities",
      path: string,
      source: Buffer | undefined,
    ) => captureTrust(getStorage, { kind, projectId: null, path, source }),
    revoke: (kind: "agent_profile" | "capabilities", path: string) =>
      revokeTrust(getStorage, { kind, projectId: null, paths: [path] }),
  };
}
