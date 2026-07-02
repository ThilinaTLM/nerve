import { CliContainerDriver } from "./cli-container-driver.js";
export class PodmanDriver extends CliContainerDriver {
  constructor() {
    super("podman", "podman");
  }
}
