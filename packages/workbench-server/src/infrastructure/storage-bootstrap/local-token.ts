import { chmod, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathExists, writeTextFileIfMissing } from "./json.js";
import { storagePaths } from "./paths.js";
import { inspectNerveHome } from "./state-layout.js";

export type LocalTokenResult =
  | { ok: true; token: string }
  | { ok: false; code: "TOKEN_MISSING" | "TOKEN_EMPTY"; message: string }
  | { ok: false; code: "HOME_UNSUPPORTED"; message: string };

/**
 * Resolve the local API token before any migration runs, so the server can
 * authenticate lifecycle requests while storage upgrades.
 *
 * - Fresh (missing/empty) home: create the token with 0600 permissions.
 * - Existing home, including a legacy home not yet migrated: the token must
 *   exist. Every released layout keeps it at `secrets/daemon-token`, and
 *   migrations never move it, so a missing token is an error.
 * - Unsupported home: no file is written; the storage phase reports why.
 */
export async function ensureLocalToken(
  home: string,
): Promise<LocalTokenResult> {
  const paths = storagePaths(home);
  const inspection = await inspectNerveHome(home);
  if (inspection.kind === "unsupported") {
    return {
      ok: false,
      code: "HOME_UNSUPPORTED",
      message: inspection.reason,
    };
  }
  if (!(await pathExists(paths.localTokenPath))) {
    if (inspection.kind === "current") {
      return {
        ok: false,
        code: "TOKEN_MISSING",
        message: "Nerve daemon token is missing.",
      };
    }
    const token = `nt_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`;
    await mkdir(dirname(paths.localTokenPath), {
      recursive: true,
      mode: 0o700,
    });
    await writeTextFileIfMissing(paths.localTokenPath, `${token}\n`, 0o600);
  }
  await chmod(paths.localTokenPath, 0o600).catch(() => undefined);
  const token = (await readFile(paths.localTokenPath, "utf8")).trim();
  if (!token) {
    return {
      ok: false,
      code: "TOKEN_EMPTY",
      message: `The local authentication token at ${paths.localTokenPath} is empty.`,
    };
  }
  return { ok: true, token };
}
