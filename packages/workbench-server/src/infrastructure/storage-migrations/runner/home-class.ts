import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  nerveHomeManifestSchema,
  type NerveHomeClass,
} from "@nervekit/contracts/settings";
import { readJsonFile } from "../../storage-bootstrap/json.js";

export async function readStorageHomeClass(
  manifestPath: string,
): Promise<NerveHomeClass> {
  const manifest = nerveHomeManifestSchema.parse(
    await readJsonFile<unknown>(manifestPath),
  );
  return manifest.version === 2 ? manifest.homeClass : "standard";
}

export async function assertDisposableHomePath(home: string): Promise<void> {
  const [candidate, defaultHome] = await Promise.all([
    canonicalizePotentialPath(home),
    canonicalizePotentialPath(join(homedir(), ".nerve")),
  ]);
  if (candidate === defaultHome) {
    throw new Error("The default Nerve home cannot be marked disposable.");
  }
}

async function canonicalizePotentialPath(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch {
    const parent = await realpath(dirname(absolute)).catch(() =>
      resolve(dirname(absolute)),
    );
    return resolve(parent, absolute.slice(dirname(absolute).length + 1));
  }
}
