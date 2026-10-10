import { nerveHomeManifestSchema } from "@nervekit/contracts/settings";
import { readHomeConfiguration } from "../configuration/home-configuration.js";
import { readJsonFile } from "./json.js";
import type { StoragePaths } from "./paths.js";
export async function assertCurrentStorage(paths: StoragePaths): Promise<void> {
  nerveHomeManifestSchema.parse(await readJsonFile(paths.manifestPath));
  await readHomeConfiguration(paths);
}
