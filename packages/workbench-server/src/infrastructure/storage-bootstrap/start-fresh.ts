import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  nerveHomeManifestSchema,
  providersConfigSchema,
} from "@nervekit/contracts/settings";
import { EncryptedFileSecretProvider } from "../secrets/index.js";
import { atomicWriteJson } from "./json.js";
import { initializeHomeConfiguration } from "../configuration/home-configuration.js";
import { storagePaths } from "./paths.js";
import { ensureLocalToken } from "./local-token.js";
import { acquireStorageHomeLock } from "./home-lock.js";

const ARCHIVE_RECORD = "archived-home.json";

async function realDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function regularFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Read-only settings provenance; do not show an archive after it is deleted. */
export async function readArchivedHome(
  home: string,
): Promise<string | undefined> {
  try {
    const record: unknown = JSON.parse(
      await readFile(join(home, ARCHIVE_RECORD), "utf8"),
    );
    if (
      !record ||
      typeof record !== "object" ||
      !("path" in record) ||
      typeof record.path !== "string"
    )
      return undefined;
    return (await lstat(record.path)).isDirectory() ? record.path : undefined;
  } catch {
    return undefined;
  }
}

/** Caller obtains explicit user confirmation and stops its daemon first. Never deletes the old home. */
export async function startFreshHome(home: string): Promise<string> {
  home = resolve(home);
  const lock = await acquireStorageHomeLock(home, { timeoutMs: 0 });
  try {
    if (
      !(await lstat(home)).isDirectory() ||
      (await lstat(home)).isSymbolicLink()
    )
      throw new Error("The home must be a directory, not a symbolic link.");
    const archive = `${home}.archive-${new Date().toISOString().replaceAll(":", "-")}`;
    // Build beside the home, before moving any original bytes. A failed preparation
    // leaves the home untouched; a failed activation retains the archive and staging.
    const staging = await mkdtemp(`${home}.fresh-`);
    const { runMigrations } = await import("../migrations/framework/runner.js");
    const token = await ensureLocalToken(staging);
    if (!token.ok) throw new Error(token.message);
    await runMigrations(staging);
    let recognizable = false;
    try {
      const raw: unknown = JSON.parse(
        await readFile(join(home, "manifest.json"), "utf8"),
      );
      // A damaged ledger does not make the current physical layout unrecognizable.
      if (raw && typeof raw === "object") {
        const layout = { ...(raw as Record<string, unknown>) };
        delete layout.migrations;
        recognizable = nerveHomeManifestSchema.safeParse(layout).success;
      }
    } catch {
      /* Unknown layout: carry nothing. */
    }
    if (recognizable) {
      const providersPath = join(home, "config", "providers.json");
      if (
        (await realDirectory(join(home, "config"))) &&
        (await regularFile(providersPath))
      ) {
        let valid = false;
        try {
          valid = providersConfigSchema.safeParse(
            JSON.parse(await readFile(providersPath, "utf8")),
          ).success;
        } catch {
          /* Invalid configuration is not converted. */
        }
        if (valid) {
          await mkdir(join(staging, "config"), {
            recursive: true,
            mode: 0o700,
          });
          await copyFile(
            providersPath,
            join(staging, "config", "providers.json"),
          );
          await chmod(join(staging, "config", "providers.json"), 0o600);
        }
      }
      const pair = ["credentials.enc", "master.key"];
      let validPair =
        (await realDirectory(join(home, "secrets"))) &&
        (
          await Promise.all(
            pair.map((file) => regularFile(join(home, "secrets", file))),
          )
        ).every(Boolean);
      if (validPair) {
        try {
          await new EncryptedFileSecretProvider(home).validate();
        } catch {
          validPair = false;
        }
      }
      if (validPair) {
        await mkdir(join(staging, "secrets"), { recursive: true, mode: 0o700 });
        for (const file of pair) {
          await copyFile(
            join(home, "secrets", file),
            join(staging, "secrets", file),
          );
          await chmod(join(staging, "secrets", file), 0o600);
        }
      }
    }
    await initializeHomeConfiguration(storagePaths(staging));
    await new EncryptedFileSecretProvider(staging).initialize();
    await atomicWriteJson(
      join(staging, ARCHIVE_RECORD),
      { version: 1, path: archive },
      0o600,
    );
    // Do not replace an existing archive, even if the clock repeats.
    try {
      await lstat(archive);
      throw new Error(`Archive already exists: ${archive}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rename(home, archive);
    try {
      await rename(staging, home);
    } catch (error) {
      await rename(archive, home);
      throw error;
    }
    return archive;
  } finally {
    await lock.release();
  }
}
