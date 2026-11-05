import { nerveHomeManifestSchema } from "@nervekit/contracts/settings";
import { readHomeConfiguration } from "../configuration/home-configuration.js";
import { readJsonFile } from "./json.js";
import type { StoragePaths } from "./paths.js";
export async function assertCurrentStorage(paths: StoragePaths): Promise<void> {
  await readJsonFile(paths.manifestPath, nerveHomeManifestSchema);
  await readHomeConfiguration(paths);
}
