import { join } from "node:path";
import type { InitializedStorage } from "../../../infrastructure/storage-bootstrap/index.js";
import { TaskLogBundleStore } from "./task-log-bundle.store.js";
export class TaskRepository {
  readonly bundles: TaskLogBundleStore;
  constructor(private readonly storage: InitializedStorage) {
    this.bundles = new TaskLogBundleStore(
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
