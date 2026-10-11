import { join } from "node:path";
import type { InitializedStorage } from "../../../infrastructure/storage-bootstrap/index.js";
import { LaunchLogBundleStore } from "./launch-log-bundle.store.js";
export class LaunchRepository {
  readonly bundles: LaunchLogBundleStore;
  constructor(private readonly storage: InitializedStorage) {
    this.bundles = new LaunchLogBundleStore(
      join(storage.paths.dataPath, "launches"),
    );
  }
  get storageHome() {
    return this.storage.paths.home;
  }
  logsPath(id: string) {
    return this.bundles.paths(id).eventsPath;
  }
  paths(id: string) {
    return this.bundles.paths(id);
  }
}
