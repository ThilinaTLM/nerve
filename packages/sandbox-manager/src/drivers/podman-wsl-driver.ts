import type { ManagerConfig } from "../config/manager-config.js";
import { CliContainerDriver } from "./cli-container-driver.js";

export class PodmanWslDriver extends CliContainerDriver {
  constructor(
    config?: Pick<ManagerConfig, "podmanWslExe" | "podmanWslDistribution">,
  ) {
    const exe = config?.podmanWslExe || "wsl.exe";
    const distribution = config?.podmanWslDistribution;
    super("podman-wsl", [
      exe,
      ...(distribution ? ["-d", distribution] : []),
      "--",
      "podman",
    ]);
  }
}
