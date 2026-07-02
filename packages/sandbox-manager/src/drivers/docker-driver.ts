import { CliContainerDriver } from "./cli-container-driver.js";
export class DockerDriver extends CliContainerDriver {
  constructor() {
    super("docker", "docker");
  }
}
